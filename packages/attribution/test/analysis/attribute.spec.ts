import path from 'node:path';
import {
  attributeToHunks,
} from '../../src/analysis/attribute.js';
import {
  heapGrowth,
  parseTopClasses,
} from '../../src/analysis/heap.js';
import {
  traceSelfTime,
} from '../../src/analysis/trace.js';
import type {
  BundleRegression,
  ChangedFile,
} from '../../src/types.js';
import {
  change,
  temporaryDirectory,
} from '../helpers.js';
import {
  leakyAppLine,
  writeLeakSnapshot,
} from '../fixtures/heap.js';
import {
  writeTrace,
} from '../fixtures/trace.js';

const app = 'http://localhost:4321/app/server.mjs';
const appFile = 'example/seeded-regressions/app/server.mjs';
const leakyAppFile = 'packages/attribution/test/fixtures/leaky-app.mjs';
const topClasses = JSON.stringify([{name: 'LeakedRecord', count: 2000, selfSize: 40_000}]);

const regression = (metrics: string[], status: BundleRegression['status'] = 'regressed'): BundleRegression => ({
  entityKey: 'case1|Run|0', kind: 'step', name: 'Run', testName: 'test', stepName: 'Run', status, duration: {status: 'increased'}, changes: metrics.map(metric => change(metric)),
});

describe('attribution to changed hunks', () => {
  const dir = temporaryDirectory('attribution-candidates-');
  const traceFile = path.join(dir, 'trace.json.gz');
  const closureSnapshot = path.join(dir, 'closure.heapsnapshot');
  const cacheSnapshot = path.join(dir, 'cache.heapsnapshot');

  beforeAll(() => {
    writeTrace(traceFile, [
      // 30 ms on the changed line 55, 5 ms on the unchanged line 52 of the same function
      {
        functionName: 'heavyRender', url: app, lineNumber: 46, samples: [[55, 30], [52, 5]],
      },
      // Hot, but in a file without changes
      {
        functionName: 'vendor', url: 'http://localhost:4321/vendor/lib.js', lineNumber: 0, samples: [[3, 50]],
      },
      // Changed line, but only 1 ms of 86 ms
      {
        functionName: 'tiny', url: app, lineNumber: 69, samples: [[70, 1]],
      },
    ]);
    writeLeakSnapshot(closureSnapshot, 'closure');
    writeLeakSnapshot(cacheSnapshot, 'cache');
  });

  const changedFiles: ChangedFile[] = [
    {file: appFile, addedRanges: [{start: 54, end: 56}, {start: 70, end: 70}]},
    {file: leakyAppFile, addedRanges: [{start: leakyAppLine('cache.push(() => record.payload[0]);'), end: leakyAppLine('cache.push(record);')}]},
  ];

  it('attributes cpu time to the sampled lines inside a changed hunk, with a deterministic confidence', async () => {
    const trace = await traceSelfTime(traceFile);

    const {candidates, outside} = attributeToHunks(regression(['TaskDuration']), {trace}, changedFiles, 'ok');

    expect(candidates.map(candidate => [candidate.file, candidate.line, candidate.basis, candidate.symbol, candidate.metric, candidate.confidence])).toEqual([
      [appFile, 55, 'cpu', 'heavyRender', 'TaskDuration', 'high'],
      [appFile, 70, 'cpu', 'tiny', 'TaskDuration', 'low'],
    ]);
    expect(candidates[0].hunk).toEqual({start: 54, end: 56});
    // Hot code outside of the changed hunks is evidence only, never a candidate
    expect(outside.map(entry => entry.symbol)).toContain('vendor');
  });

  it('attributes heap growth to the deepest retainer frame inside a changed hunk', async () => {
    const heap = await heapGrowth(closureSnapshot, parseTopClasses(topClasses), {samplesPerClass: 10});

    const {candidates} = attributeToHunks(regression(['heapDiffAddedBytes', 'TaskDuration']), {heap}, changedFiles, 'ok');

    expect(candidates.map(candidate => [candidate.file, candidate.line, candidate.basis, candidate.symbol, candidate.metric, candidate.confidence])).toEqual([
      [leakyAppFile, leakyAppLine('cache.push(() => record.payload[0]);'), 'heap', 'LeakedRecord', 'heapDiffAddedBytes', 'high'],
    ]);
  });

  it('keeps the heap share a fraction when several grown classes have the same retainer frame', async () => {
    const heap = await heapGrowth(closureSnapshot, parseTopClasses(JSON.stringify([
      {name: 'LeakedRecord', count: 2000, selfSize: 40_000},
      {name: 'Array', count: 2000, selfSize: 30_000},
    ])), {samplesPerClass: 10});

    const {candidates} = attributeToHunks(regression(['heapDiffAddedBytes']), {heap}, changedFiles, 'ok');

    expect(candidates.map(candidate => [candidate.line, candidate.share])).toEqual([[leakyAppLine('cache.push(() => record.payload[0]);'), 1]]);
  });

  it('finds no culprit if no retainer frame lies inside a changed hunk, instead of guessing the line', async () => {
    const heap = await heapGrowth(cacheSnapshot, parseTopClasses(topClasses), {samplesPerClass: 10});

    const {candidates} = attributeToHunks(regression(['heapDiffAddedBytes']), {heap}, changedFiles, 'ok');

    expect(candidates).toEqual([]);
  });

  it.each([
    ['a mixed regression', regression(['TaskDuration'], 'mixed'), 'ok'],
    ['a low-confidence comparison', regression(['TaskDuration']), 'low-confidence'],
    ['a regression without a cpu metric', regression(['heapDiffAddedBytes']), 'ok'],
  ] as const)('lowers the confidence for %s', async (_, entity, comparisonStatus) => {
    const trace = await traceSelfTime(traceFile);

    const {candidates} = attributeToHunks(entity, {trace}, changedFiles, comparisonStatus);

    expect(candidates[0]).toMatchObject({line: 55, confidence: 'low'});
  });

  it('finds nothing without changed files', async () => {
    const trace = await traceSelfTime(traceFile);

    expect(attributeToHunks(regression(['TaskDuration']), {trace}, [], 'ok').candidates).toEqual([]);
  });
});
