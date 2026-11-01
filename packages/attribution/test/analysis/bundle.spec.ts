import {
  BundleError,
  capBundle,
  defaultCaps,
  fitWithinBytes,
  parseBundle,
  promptBytes,
} from '../../src/analysis/bundle.js';
import type {
  AttributionBundle,
  BundleRegression,
} from '../../src/types.js';
import {
  change,
} from '../helpers.js';

const regression = (index: number, withArtifact: boolean): BundleRegression => ({
  entityKey: `case${index}`,
  kind: 'test',
  name: `test ${index}`,
  testName: `test ${index}`,
  status: 'regressed',
  duration: {status: 'increased'},
  changes: [{...change('TaskDuration'), relativeChange: index}],
  ...(withArtifact ? {traceFile: {file: 'trace.json.gz', absoluteFile: '/trace.json.gz'}} : {artifactReason: 'no-artifact' as const}),
});

const bundle = (regressions: BundleRegression[], files: string[]): AttributionBundle => ({
  schemaVersion: 1,
  generatedAt: '2026-11-01T00:00:00.000Z',
  status: 'ok',
  message: '',
  run: {commit: 'b', baselineCommit: 'a'},
  regressions,
  changedFiles: files.map(file => ({file, addedRanges: [{start: 1, end: 2}]})),
});

describe('bundle', () => {
  it('parses a bundle of the presenter', () => {
    const parsed = parseBundle(JSON.stringify(bundle([regression(1, true)], ['app.mjs'])));

    expect(parsed.regressions[0].entityKey).toBe('case1');
  });

  it.each([
    ['no json', '{'],
    ['no object', '[]'],
    ['an unknown schema version', JSON.stringify({...bundle([], []), schemaVersion: 2})],
    ['no list of regressions', JSON.stringify({...bundle([], []), regressions: {}})],
    ['a regression without changes', JSON.stringify({...bundle([], []), regressions: [{entityKey: 'a'}]})],
    ['a regression without a name', JSON.stringify({...bundle([{...regression(1, true), name: undefined} as unknown as BundleRegression], [])})],
    ['a regression without a status', JSON.stringify({...bundle([{...regression(1, true), status: 3} as unknown as BundleRegression], [])})],
    ['a change without a metric', JSON.stringify({...bundle([{...regression(1, true), changes: [{status: 'increased'}]} as unknown as BundleRegression], [])})],
    ['a changed file with a broken range', JSON.stringify({...bundle([], []), changedFiles: [{file: 'a', addedRanges: [{start: 3, end: 1}]}]})],
  ])('rejects %s as malformed', (_, text) => {
    expect(() => parseBundle(text)).toThrow(BundleError);
  });

  it('caps regressions and changed files deterministically and counts what was dropped', () => {
    const regressions = Array.from({length: 30}, (_, index) => regression(index, index % 2 === 0));
    const files = Array.from({length: 210}, (_, index) => `docs/${String(index).padStart(3, '0')}.md`);
    files.push('src/app.mjs');

    const capped = capBundle(bundle(regressions, files), defaultCaps);

    expect(defaultCaps).toEqual({maxRegressions: 25, maxChangedFiles: 200, maxPromptBytes: 200_000});
    expect(capped.truncated).toEqual({regressions: 5, changedFiles: 11});
    // Regressions with an artifact first, the largest change first
    expect(capped.bundle.regressions.slice(0, 2).map(entry => entry.entityKey)).toEqual(['case28', 'case26']);
    expect(capped.bundle.regressions.filter(entry => entry.artifactReason === 'no-artifact')).toHaveLength(10);
    // Scripts first, then in order of the diff
    expect(capped.bundle.changedFiles.slice(0, 2).map(file => file.file)).toEqual(['src/app.mjs', 'docs/000.md']);
    expect(capBundle(bundle(regressions, files), defaultCaps)).toEqual(capped);
  });

  it('drops the least important entries until a list fits into a byte budget', () => {
    const functions = Array.from({length: 50}, (_, index) => ({functionName: `fn${index}`, selfTime: index}));

    const fitted = fitWithinBytes(functions, entries => ({functions: entries}), 400, (a, b) => b.selfTime - a.selfTime);

    expect(promptBytes(fitted.value)).toBeLessThanOrEqual(400);
    expect(fitted.value.functions[0]).toEqual({functionName: 'fn49', selfTime: 49});
    expect(fitted.dropped).toBe(50 - fitted.value.functions.length);
    expect(fitted.value.functions.map(fn => fn.selfTime)).toEqual(fitted.value.functions.map(fn => fn.selfTime).sort((a, b) => b - a));
  });
});
