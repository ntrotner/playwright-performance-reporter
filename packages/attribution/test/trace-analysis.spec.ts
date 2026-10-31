import fs from 'node:fs';
import path from 'node:path';
import {
  attributeToHunks,
  matchHunkFile,
  traceSelfTime,
} from '../src/analysis/index.js';
import type {
  BundleRegression,
  ChangedHunk,
  SourceRoot,
} from '../src/types.js';
import {
  createStep,
  temporaryDirectory,
  writeTrace,
} from './helpers.js';

const appUrl = 'http://localhost:4321/server.mjs';

/**
 * Changed lines 50-60 of the served app
 */
const hunks: ChangedHunk[] = [{file: 'example/app/server.mjs', absoluteFile: '/repo/example/app/server.mjs', addedRanges: [{start: 50, end: 60}]}];

/**
 * The app serves example/app/ at its root
 */
const sourceRoots: SourceRoot[] = [{url: 'http://localhost:4321/', path: 'example/app'}];

/**
 * Regression of a step whose task duration doubled
 */
function regression(): BundleRegression {
  const step = createStep('case1|Render|0', 'regressed', [{metric: 'TaskDuration', status: 'increased'}]);
  return {
    entityKey: step.key, name: step.name, kind: step.kind, testId: step.testId, testName: step.testName, stepName: step.stepName, status: 'regressed', duration: step.duration, changes: step.changes, basis: ['cpu'], artifacts: {},
  };
}

describe('traceSelfTime', () => {
  const dir = temporaryDirectory();

  it('sums the self time of every function and of the lines its samples hit', async () => {
    const file = path.join(dir, 'trace.json.gz');
    writeTrace(file, [
      {
        functionName: 'render', url: appUrl, lineNumber: 44, samples: [[59, 30], [46, 10]],
      },
      {
        functionName: 'parse', url: 'http://localhost:4321/vendor.js', lineNumber: 0, samples: [[3, 20]],
      },
    ]);

    const result = await traceSelfTime(file);

    expect(result.totalSelfTime).toBeCloseTo(60);
    expect(result.pageOrigins).toEqual(['http://localhost:4321']);
    expect(result.functions.map(fn => [fn.functionName, fn.url, fn.line, Math.round(fn.selfTime)])).toEqual([
      ['render', appUrl, 45, 40],
      ['parse', 'http://localhost:4321/vendor.js', 1, 20],
    ]);
    expect(result.functions[0].lines.map(line => [line.line, Math.round(line.selfTime)])).toEqual([[59, 30], [46, 10]]);
  });

  it('rejects a file that is not a trace', async () => {
    const file = path.join(dir, 'broken.json.gz');
    fs.writeFileSync(file, 'not a trace');

    await expect(traceSelfTime(file)).rejects.toThrow();
  });
});

describe('matchHunkFile', () => {
  const file = (name: string): ChangedHunk => ({file: name, absoluteFile: `/repo/${name}`, addedRanges: [{start: 1, end: 1}]});
  const pageOrigins = ['http://localhost:4321'];

  it('never matches a third-party index.js to a changed src/index.js', () => {
    const changed = [file('src/index.js')];

    expect(matchHunkFile('https://cdn.example.com/lib/index.js', changed, {pageOrigins})).toBeUndefined();
    // Same path, but another origin
    expect(matchHunkFile('https://cdn.example.com/src/index.js', changed, {pageOrigins})).toBeUndefined();
    // Same origin, but only the file name is shared
    expect(matchHunkFile('http://localhost:4321/lib/index.js', changed, {pageOrigins})).toBeUndefined();
  });

  it('matches a script of the page origin by two or more trailing path segments', () => {
    const changed = [file('packages/a/src/index.js'), file('packages/b/src/index.js')];

    expect(matchHunkFile('http://localhost:4321/b/src/index.js?v=2', changed, {pageOrigins})?.file).toBe('packages/b/src/index.js');
    // Both fit equally well
    expect(matchHunkFile('http://localhost:4321/src/index.js', changed, {pageOrigins})).toBeUndefined();
  });

  it('matches a local file by two or more trailing path segments', () => {
    expect(matchHunkFile('file:///repo/test/fixtures/app.mjs', [file('test/fixtures/app.mjs')])?.file).toBe('test/fixtures/app.mjs');
    expect(matchHunkFile('file:///elsewhere/app.mjs', [file('test/fixtures/app.mjs')])).toBeUndefined();
  });

  it('maps a script below a source root to exactly one file', () => {
    const changed = [file('example/app/server.mjs'), file('other/server.mjs')];

    expect(matchHunkFile('http://localhost:4321/server.mjs', changed, {sourceRoots})?.file).toBe('example/app/server.mjs');
    // Below the root, but not a changed file: no fallback to a guess
    expect(matchHunkFile('http://localhost:4321/vendor/other/server.mjs', changed, {sourceRoots, pageOrigins})).toBeUndefined();
  });
});

describe('attributeToHunks for the CPU', () => {
  const dir = temporaryDirectory();

  it('reports a function whose own self time is on changed lines, at its hottest changed line', async () => {
    const file = path.join(dir, 'cpu.json.gz');
    writeTrace(file, [
      // Declared before the hunk, but its samples hit the changed lines 55 and 59
      {
        functionName: 'heavyRender', url: appUrl, lineNumber: 44, samples: [[59, 60], [55, 20], [46, 20]],
      },
    ]);

    const {culprits} = attributeToHunks(regression(), {trace: await traceSelfTime(file)}, hunks, {sourceRoots});

    expect(culprits).toHaveLength(1);
    expect(culprits[0]).toMatchObject({
      file: 'example/app/server.mjs', startLine: 59, endLine: 59, symbol: 'heavyRender', basis: 'cpu', metric: 'TaskDuration', confidence: 0.84,
    });
  });

  it('never reports a function that is hot only outside of the changed lines, but keeps it as evidence', async () => {
    const file = path.join(dir, 'outside.json.gz');
    writeTrace(file, [
      {
        functionName: 'parse', url: appUrl, lineNumber: 0, samples: [[5, 80]],
      },
      {
        functionName: 'caller', url: appUrl, lineNumber: 51, samples: [[70, 20]],
      },
    ]);

    const {culprits, evidence} = attributeToHunks(regression(), {trace: await traceSelfTime(file)}, hunks, {sourceRoots});

    expect(culprits).toEqual([]);
    expect(evidence.join('\n')).toContain('parse');
  });

  it('falls back to the line of the function if the trace has no sampled lines', async () => {
    const file = path.join(dir, 'no-lines.json.gz');
    writeTrace(file, [{
      functionName: 'query', url: appUrl, lineNumber: 51, samples: [[0, 50]],
    }], {withLines: false});

    const {culprits} = attributeToHunks(regression(), {trace: await traceSelfTime(file)}, hunks, {sourceRoots});

    expect(culprits.map(culprit => [culprit.symbol, culprit.startLine])).toEqual([['query', 52]]);
  });

  it('checks every sampled line of a function, not only its hottest ones', async () => {
    const file = path.join(dir, 'many-lines.json.gz');
    // Six hotter lines before the changed line 55, all outside the hunk
    writeTrace(file, [{
      functionName: 'render', url: appUrl, lineNumber: 0, samples: [[10, 30], [11, 30], [12, 30], [13, 30], [14, 30], [15, 30], [55, 10]],
    }]);

    const {culprits} = attributeToHunks(regression(), {trace: await traceSelfTime(file)}, hunks, {sourceRoots});

    expect(culprits.map(culprit => [culprit.symbol, culprit.startLine])).toEqual([['render', 55]]);
  });

  it('names no metric for a CPU culprit of a regression whose increased metrics are all of the heap', async () => {
    const file = path.join(dir, 'heap-only.json.gz');
    writeTrace(file, [{
      functionName: 'heavyRender', url: appUrl, lineNumber: 44, samples: [[59, 60]],
    }]);
    const step = createStep('case1|Render|0', 'regressed', [{metric: 'JSHeapUsedSize', status: 'increased'}]);
    const heapOnly: BundleRegression = {...regression(), changes: step.changes, basis: ['heap']};

    const {culprits} = attributeToHunks(heapOnly, {trace: await traceSelfTime(file)}, hunks, {sourceRoots});

    expect(culprits).toHaveLength(1);
    expect(culprits[0].metric).toBeUndefined();
  });

  it('never matches the lines of a source-mapped or transpiled script', async () => {
    const file = path.join(dir, 'source-mapped.json.gz');
    writeTrace(file, [
      {
        functionName: 'bundled', url: appUrl, lineNumber: 44, samples: [[55, 50]],
      },
      {
        functionName: 'transpiled', url: 'http://localhost:4321/main.ts', lineNumber: 44, samples: [[55, 50]],
      },
    ], {sourceMappedUrls: [appUrl]});
    const changed: ChangedHunk[] = [...hunks, {file: 'example/app/main.ts', absoluteFile: '/repo/example/app/main.ts', addedRanges: [{start: 50, end: 60}]}];

    const {culprits, evidence} = attributeToHunks(regression(), {trace: await traceSelfTime(file)}, changed, {sourceRoots});

    expect(culprits).toEqual([]);
    expect(evidence.filter(item => item.includes('source-mapped or transpiled'))).toHaveLength(2);
  });

  it('never attributes self time of a third-party script, even if its path matches a changed file', async () => {
    const file = path.join(dir, 'third-party.json.gz');
    writeTrace(file, [{
      functionName: 'render', url: 'https://cdn.example.com/src/render.js', lineNumber: 0, samples: [[3, 50]],
    }]);
    const changed: ChangedHunk[] = [{file: 'src/render.js', absoluteFile: '/repo/src/render.js', addedRanges: [{start: 1, end: 10}]}];

    const {culprits} = attributeToHunks(regression(), {trace: await traceSelfTime(file)}, changed);

    expect(culprits).toEqual([]);
  });

  it('attributes self time of a same-origin script by its path without a source root', async () => {
    const file = path.join(dir, 'same-origin.json.gz');
    writeTrace(file, [{
      functionName: 'render', url: 'http://localhost:4321/src/render.js', lineNumber: 0, samples: [[3, 50]],
    }]);
    const changed: ChangedHunk[] = [{file: 'web/src/render.js', absoluteFile: '/repo/web/src/render.js', addedRanges: [{start: 1, end: 10}]}];

    const {culprits} = attributeToHunks(regression(), {trace: await traceSelfTime(file)}, changed);

    expect(culprits.map(culprit => `${culprit.file}:${culprit.startLine}`)).toEqual(['web/src/render.js:3']);
  });
});
