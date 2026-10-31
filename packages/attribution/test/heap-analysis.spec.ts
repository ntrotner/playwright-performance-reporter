import {
  execFileSync,
} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  attributeToHunks,
  type HeapGrowth,
  heapGrowth,
  type TraceSelfTime,
} from '../src/analysis/index.js';
import type {
  BundleRegression,
} from '../src/types.js';
import {
  createStep,
  leakyApp,
  leakyAppHunk,
  leakyAppLine,
  temporaryDirectory,
} from './helpers.js';

/**
 * Lines of the leak: the cache, the push of a record, and the push of a closure that keeps a record
 */
const cacheLine = leakyAppLine('const cache = [];');
const pushLine = leakyAppLine('cache.push(record);');
const closureLine = leakyAppLine('cache.push(() => record.payload[0]);');

/**
 * Classes `heapDiff` would record for the leak
 */
const topClasses = [
  {name: '(code)', count: 10, selfSize: 900_000},
  {name: 'LeakedRecord', count: 2000, selfSize: 40_000},
];

/**
 * Regression of a step whose added heap bytes grew
 */
function regression(): BundleRegression {
  const step = createStep('case1|Leak|0', 'regressed', [{metric: 'heapDiffAddedBytes', status: 'increased'}]);
  return {
    entityKey: step.key, name: step.name, kind: step.kind, testId: step.testId, testName: step.testName, stepName: step.stepName, status: 'regressed', duration: step.duration, changes: step.changes, basis: ['heap'], artifacts: {},
  };
}

describe('heap analysis', () => {
  const dir = temporaryDirectory();
  const snapshot = path.join(dir, 'leak.heapsnapshot');
  const closureSnapshot = path.join(dir, 'closure-leak.heapsnapshot');
  const propertySnapshot = path.join(dir, 'property-leak.heapsnapshot');

  beforeAll(() => {
    execFileSync(process.execPath, [leakyApp, snapshot]);
    execFileSync(process.execPath, [leakyApp, closureSnapshot, 'closure']);
    execFileSync(process.execPath, [leakyApp, propertySnapshot, 'property']);
  });

  it('follows the retainer paths of the grown classes to the variables that hold them', async () => {
    const growth = await heapGrowth(snapshot, topClasses, {samplesPerClass: 10});

    // Engine internals like (code) are skipped
    expect(growth.classes.map(entry => [entry.name, entry.sampled])).toEqual([['LeakedRecord', 10]]);
    // The module variable `cache`, in the scope of the leaky app, holds the array that holds the records
    expect(growth.classes[0].variables[0]).toMatchObject({
      name: 'cache', url: `file://${leakyApp}`, distance: 1, hits: 10,
    });
    expect(growth.classes[0].retainerPath.slice(0, 2).map(step => step.replace(/ <-\[.*]$/, ''))).toEqual(['object:LeakedRecord', 'object:Array']);
  });

  it('attributes a leak into a module-level cache to the changed line that fills the cache', async () => {
    const hunks = [leakyAppHunk([cacheLine, pushLine])];

    const {culprits} = attributeToHunks(regression(), {heap: await heapGrowth(snapshot, topClasses, {samplesPerClass: 10})}, hunks);

    expect(culprits.map(culprit => [culprit.file, culprit.startLine, culprit.symbol, culprit.basis, culprit.metric, culprit.confidence])).toEqual([
      ['test/fixtures/leaky-app.mjs', pushLine, 'cache', 'heap', 'heapDiffAddedBytes', 0.96],
    ]);
  });

  it('attributes the leak to the declaration of the cache if only the declaration changed', async () => {
    const {culprits} = attributeToHunks(regression(), {heap: await heapGrowth(snapshot, topClasses)}, [leakyAppHunk([cacheLine])]);

    expect(culprits.map(culprit => culprit.startLine)).toEqual([cacheLine]);
  });

  it('attributes a leak through closures to the changed line that defines the closure', async () => {
    const {culprits} = attributeToHunks(regression(), {heap: await heapGrowth(closureSnapshot, topClasses, {samplesPerClass: 10})}, [leakyAppHunk([closureLine])]);

    expect(culprits.map(culprit => [culprit.startLine, culprit.symbol, culprit.confidence])).toEqual([[closureLine, '(anonymous)', 0.96]]);
  });

  it('never attributes a leak to a changed line that only shares a name with a property on the retainer path', async () => {
    // The records are held by `store.items`; the change added an unrelated `items` and read `store` in a ternary
    const hunk = leakyAppHunk([2, 3]);
    hunk.addedLines = [{line: 2, text: 'const items = [];'}, {line: 3, text: 'const current = ok ? store : fallback;'}];

    const {culprits, evidence} = attributeToHunks(regression(), {heap: await heapGrowth(propertySnapshot, topClasses)}, [hunk]);

    expect(culprits).toEqual([]);
    expect(evidence[0]).toContain('2000 added LeakedRecord');
  });

  it('attributes a leak through a property to the changed declaration of the variable of its scope', async () => {
    const {culprits} = attributeToHunks(regression(), {heap: await heapGrowth(propertySnapshot, topClasses)}, [leakyAppHunk([leakyAppLine('const store = {items: []};')])]);

    expect(culprits.map(culprit => [culprit.startLine, culprit.symbol])).toEqual([[leakyAppLine('const store = {items: []};'), 'store']]);
  });

  it('attributes nothing if no retainer of the grown classes is on a changed line', async () => {
    // The constructor of the records changed, but the cache that keeps them didn't
    const {culprits, evidence} = attributeToHunks(regression(), {heap: await heapGrowth(snapshot, topClasses)}, [leakyAppHunk([7, 8, 9])]);

    expect(culprits).toEqual([]);
    expect(evidence[0]).toContain('2000 added LeakedRecord');
  });

  it('reports a closure located in the snapshot ahead of a variable whose line is only found by its name', () => {
    // The variable is closer to the objects, but its line comes from the changed text, not from the snapshot
    const growth: HeapGrowth = {
      classes: [{
        name: 'LeakedRecord',
        count: 2000,
        selfSize: 40_000,
        sampled: 10,
        retainerPath: [],
        frames: [{
          functionName: 'leak', url: `file://${leakyApp}`, line: closureLine, column: 7, distance: 3, hits: 10,
        }],
        variables: [{
          name: 'cache', url: `file://${leakyApp}`, distance: 1, hits: 10,
        }],
      }],
    };

    const located = attributeToHunks(regression(), {heap: growth}, [leakyAppHunk([closureLine, pushLine])]);
    const byName = attributeToHunks(regression(), {heap: growth}, [leakyAppHunk([pushLine])]);

    expect(located.culprits.map(culprit => [culprit.startLine, culprit.symbol])).toEqual([[closureLine, 'leak']]);
    expect(byName.culprits.map(culprit => [culprit.startLine, culprit.symbol])).toEqual([[pushLine, 'cache']]);
    expect(byName.culprits[0].evidence[0]).toContain('found by its name in the changed lines, not located in the snapshot');
  });

  it('keeps a CPU and a heap candidate on the same changed line apart', async () => {
    // The changed push both burns CPU and keeps the records alive
    const trace: TraceSelfTime = {
      totalSelfTime: 100,
      pageOrigins: [],
      functions: [{
        functionName: 'leak', url: `file://${leakyApp}`, line: 16, column: 1, selfTime: 80, lines: [{line: pushLine, selfTime: 80}],
      }],
    };
    const step = createStep('case1|Leak|0', 'regressed', [{metric: 'TaskDuration', status: 'increased'}, {metric: 'heapDiffAddedBytes', status: 'increased'}]);

    const {culprits} = attributeToHunks({...regression(), changes: step.changes}, {trace, heap: await heapGrowth(snapshot, topClasses)}, [leakyAppHunk([pushLine])]);

    expect(culprits.map(culprit => [culprit.basis, culprit.startLine, culprit.metric]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ['cpu', pushLine, 'TaskDuration'],
      ['heap', pushLine, 'heapDiffAddedBytes'],
    ]);
  });

  it('rejects a file that is not a heap snapshot', async () => {
    const broken = path.join(temporaryDirectory(), 'broken.heapsnapshot');
    fs.writeFileSync(broken, '{"nodes": [');

    await expect(heapGrowth(broken, topClasses)).rejects.toThrow();
  });
});
