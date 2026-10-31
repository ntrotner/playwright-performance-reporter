import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  jest,
} from '@jest/globals';
import {
  type ResultAccumulator,
  type TargetMetric,
  testCaseParent,
} from 'playwright-performance-reporter';
import {
  AttributionPresenter,
} from '../src/index.js';
import type {
  AttributionBundle,
  ComparisonReport,
  SourceRoot,
} from '../src/types.js';
import {
  createHistory,
  createReport,
  createRepository,
  createStep,
  temporaryDirectory,
} from './helpers.js';

/**
 * Chunk of a test with one step, as the reporter writes it
 *
 * @param caseId id of the test
 * @param steps step id, name, start and stop metrics of every step
 * @param commit commit recorded in the metadata of the test
 */
function chunk(caseId: string, steps: Array<{id: string; name: string; start: number; metrics: TargetMetric['metric']}>, commit?: string): ResultAccumulator {
  return {
    [caseId]: {
      [testCaseParent]: {
        name: 'test', startMeasurement: 0, endMeasurement: 100, startMetrics: [{metric: {}}], stopMetrics: [{metric: {usedJsHeapSize: 1}}], samplingMetrics: [], metadata: commit ? {commit, branch: 'feature'} : {},
      },
      ...Object.fromEntries(steps.map(step => [step.id, {
        name: step.name, startMeasurement: step.start, endMeasurement: step.start + 10, startMetrics: [{metric: {}}], stopMetrics: [{type: 'page', metric: step.metrics}], samplingMetrics: [],
      }])),
    },
  };
}

/**
 * Write the chunks through the presenter and read the bundle it wrote
 *
 * @param options report, chunks, history and repository of the run
 */
async function writeBundle(options: {report: ComparisonReport | undefined | Error; chunks: ResultAccumulator[]; historyDir: string; repoDir: string; sourceRoots?: SourceRoot[]}): Promise<{bundle: AttributionBundle; text: string; outputDir: string}> {
  const outputDir = temporaryDirectory('attribution-output-');
  const presenter = new AttributionPresenter({
    outputDir,
    historyDir: options.historyDir,
    repoDir: options.repoDir,
    sourceRoots: options.sourceRoots,
    comparison: {
      async getReport() {
        if (options.report instanceof Error) {
          throw options.report;
        }

        return options.report;
      },
    },
  });
  for (const content of options.chunks) {
    // Chunks are written in order, like the reporter does
    // eslint-disable-next-line no-await-in-loop
    await presenter.write(content);
  }

  expect(await presenter.close()).toBe(true);
  const text = fs.readFileSync(path.join(outputDir, 'performance-attribution.json'), 'utf8');
  return {bundle: JSON.parse(text) as AttributionBundle, text, outputDir};
}

describe('AttributionPresenter', () => {
  const repository = createRepository();

  it('hands off the regressions with their artifacts and the changed lines since the baseline commit', async () => {
    const report = createReport([
      createStep('case1', 'regressed', [{metric: 'JSHeapUsedSize', status: 'increased'}]),
      createStep('case1|Render|0', 'mixed', [{metric: 'TaskDuration', status: 'increased'}, {metric: 'LayoutCount', status: 'decreased'}]),
      createStep('case1|Idle|0', 'improved', [{metric: 'TaskDuration', status: 'decreased'}]),
    ]);
    const {bundle} = await writeBundle({
      report,
      historyDir: createHistory(repository.base),
      repoDir: repository.dir,
      chunks: [chunk('case1', [
        {
          id: 's1', name: 'Render', start: 10, metrics: {
            // Metric names of the reporter
            // eslint-disable-next-line @typescript-eslint/naming-convention
            TaskDuration: 1, traceFile: 'traces/trace-1.json.gz', heapDiffFile: 'heap/heap-1.heapsnapshot', heapDiffTopClasses: '[{"name":"Leak","count":2,"selfSize":64}]',
          },
        },
        {
          id: 's2', name: 'Idle', start: 30, metrics: {longTaskCount: 1},
        },
      ], repository.head)],
    });

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.run).toMatchObject({commit: repository.head, branch: 'feature', baselineCommit: repository.base});
    expect(bundle.unresolved).toBeUndefined();
    expect(bundle.hunks).toEqual([
      {
        file: 'app/app.mjs', absoluteFile: path.join(repository.dir, 'app/app.mjs'), addedRanges: [{start: 3, end: 4}], addedLines: [{line: 3, text: 'changed 3'}, {line: 4, text: 'changed 4'}],
      },
      {
        file: 'app/new.mjs', absoluteFile: path.join(repository.dir, 'app/new.mjs'), addedRanges: [{start: 1, end: 2}], addedLines: [{line: 1, text: 'new 1'}, {line: 2, text: 'new 2'}],
      },
    ]);
    expect(bundle.regressions.map(regression => [regression.entityKey, regression.status, regression.changes.map(change => change.metric)])).toEqual([
      ['case1', 'regressed', ['JSHeapUsedSize']],
      ['case1|Render|0', 'mixed', ['TaskDuration']],
    ]);
    expect(bundle.regressions[1]).toMatchObject({
      basis: ['cpu'],
      artifacts: {
        traceFile: {file: 'traces/trace-1.json.gz', absoluteFile: path.resolve(process.cwd(), 'traces/trace-1.json.gz')},
        heapDiffFile: {file: 'heap/heap-1.heapsnapshot', absoluteFile: path.resolve(process.cwd(), 'heap/heap-1.heapsnapshot')},
      },
      heapDiffTopClasses: '[{"name":"Leak","count":2,"selfSize":64}]',
    });
    expect(bundle.regressions[0]).toMatchObject({basis: ['heap'], artifacts: {}, reason: 'no-artifact'});
    expect(bundle.caps).toEqual({maxRegressions: 25, maxChangedFiles: 200, maxPromptBytes: 200_000});
    expect(bundle.comparison).toMatchObject({status: 'ok', settings: {zScoreThreshold: 2}});
  });

  it('records where the app serves the repository, relative to the repository root', async () => {
    const {bundle} = await writeBundle({
      report: createReport([createStep('case1', 'regressed', [{metric: 'TaskDuration', status: 'increased'}])]),
      historyDir: createHistory(repository.base),
      repoDir: repository.dir,
      sourceRoots: [{url: 'http://localhost:4321/', path: path.join(repository.dir, 'app')}, {url: 'http://localhost:4321/static/', path: 'app/static'}],
      chunks: [chunk('case1', [], repository.head)],
    });

    expect(bundle.sourceRoots).toEqual([{url: 'http://localhost:4321/', path: 'app'}, {url: 'http://localhost:4321/static/', path: 'app/static'}]);
  });

  it('maps a step that occurs twice in a test to the artifacts of each occurrence', async () => {
    const report = createReport([
      createStep('case1|Click|0', 'regressed', [{metric: 'TaskDuration', status: 'increased'}]),
      createStep('case1|Click|1', 'regressed', [{metric: 'TaskDuration', status: 'increased'}]),
    ]);
    const {bundle} = await writeBundle({
      report,
      historyDir: createHistory(repository.base),
      repoDir: repository.dir,
      // The second occurrence is written first, but started later
      chunks: [
        chunk('case1', [{
          id: 'b', name: 'Click', start: 50, metrics: {traceFile: 'traces/second.json.gz'},
        }], repository.head),
        chunk('case1', [{
          id: 'a', name: 'Click', start: 20, metrics: {traceFile: 'traces/first.json.gz'},
        }], repository.head),
      ],
    });

    expect(bundle.regressions.map(regression => [regression.entityKey, regression.artifacts.traceFile?.file])).toEqual([
      ['case1|Click|0', 'traces/first.json.gz'],
      ['case1|Click|1', 'traces/second.json.gz'],
    ]);
  });

  it('never opens an artifact, so its content never reaches the bundle', async () => {
    const artifactDir = temporaryDirectory('attribution-artifacts-');
    const traceFile = path.join(artifactDir, 'trace.json.gz');
    fs.writeFileSync(traceFile, 'secret-session-token');
    const {text, bundle} = await writeBundle({
      report: createReport([createStep('case1|Render|0', 'regressed', [{metric: 'TaskDuration', status: 'increased'}])]),
      historyDir: createHistory(repository.base),
      repoDir: repository.dir,
      chunks: [chunk('case1', [{
        id: 's1', name: 'Render', start: 10, metrics: {traceFile},
      }], repository.head)],
    });

    expect(bundle.regressions[0].artifacts.traceFile).toEqual({file: traceFile, absoluteFile: traceFile});
    expect(text).not.toContain('secret-session-token');
  });

  it('writes the bundle with a note if nothing regressed', async () => {
    const {bundle} = await writeBundle({
      report: createReport([createStep('case1', 'unchanged', [])]),
      historyDir: createHistory(repository.base),
      repoDir: repository.dir,
      chunks: [chunk('case1', [], repository.head)],
    });

    expect(bundle.note).toBe('no-regressions');
    expect(bundle.regressions).toEqual([]);
  });

  it('says the comparison is unavailable, not that nothing regressed, if the comparison has no report', async () => {
    const {bundle} = await writeBundle({
      report: undefined, historyDir: createHistory(repository.base), repoDir: repository.dir, chunks: [],
    });

    expect(bundle).toMatchObject({
      schemaVersion: 1, note: 'comparison-unavailable', noteDetail: 'the comparison presenter has no report: nothing was measured, or its comparison failed', regressions: [],
    });
  });

  it('says the comparison is unavailable if the comparison presenter fails', async () => {
    const {bundle} = await writeBundle({
      report: new Error('history is corrupt'), historyDir: createHistory(repository.base), repoDir: repository.dir, chunks: [chunk('case1', [], repository.head)],
    });

    expect(bundle).toMatchObject({note: 'comparison-unavailable', noteDetail: 'comparison report unavailable: history is corrupt', regressions: []});
  });

  it('says the comparison is unavailable if the run has no baseline to compare against', async () => {
    const report = {
      ...createReport([createStep('case1', 'new', [])]), status: 'no-baseline' as const, message: 'No previous runs with the required metrics.', baselineRuns: [],
    };

    const {bundle} = await writeBundle({
      report, historyDir: createHistory(repository.base), repoDir: repository.dir, chunks: [chunk('case1', [], repository.head)],
    });

    expect(bundle).toMatchObject({note: 'comparison-unavailable', noteDetail: 'comparison status no-baseline: No previous runs with the required metrics.'});
  });

  it('diffs against the newest baseline commit that differs from the current commit', async () => {
    // The newest baseline run is an earlier run of the current commit, e.g. a re-run
    const report = createReport([createStep('case1', 'regressed', [{metric: 'TaskDuration', status: 'increased'}])], 2);

    const {bundle} = await writeBundle({
      report, historyDir: createHistory(repository.base, repository.head), repoDir: repository.dir, chunks: [chunk('case1', [], repository.head)],
    });

    expect(bundle.run.baselineCommit).toBe(repository.base);
    expect(bundle.unresolved).toBeUndefined();
    expect(bundle.hunks.map(hunk => hunk.file)).toEqual(['app/app.mjs', 'app/new.mjs']);
  });

  describe('states why the changed lines are unknown', () => {
    const report = createReport([createStep('case1', 'regressed', [{metric: 'TaskDuration', status: 'increased'}])]);

    it('if every baseline run is of the current commit', async () => {
      const {bundle} = await writeBundle({
        report, historyDir: createHistory(repository.head), repoDir: repository.dir, chunks: [chunk('case1', [], repository.head)],
      });

      expect(bundle).toMatchObject({unresolved: 'no changes since the baseline commit', hunks: []});
      expect(bundle.unresolvedDetail).toBe(`every baseline run is of the current commit ${repository.head.slice(0, 7)}`);
    });

    it('if the history dir is not the one of the comparison presenter', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const {bundle} = await writeBundle({
        report, historyDir: temporaryDirectory(), repoDir: repository.dir, chunks: [chunk('case1', [], repository.head)],
      });

      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
      expect(bundle).toMatchObject({unresolved: 'no revision metadata'});
      expect(bundle.unresolvedDetail).toMatch(/^the history dir .* contains none of the 1 baseline run\(s\) of the comparison, pass the historyDir of the comparison presenter$/);
    });

    it('naming the current commit if it is not in the checkout, e.g. in a shallow clone', async () => {
      const {bundle} = await writeBundle({
        report, historyDir: createHistory(repository.base), repoDir: repository.dir, chunks: [chunk('case1', [], 'feedfeedfeedfeedfeedfeedfeedfeedfeedfeed')],
      });

      expect(bundle).toMatchObject({unresolved: 'git unavailable', hunks: []});
      expect(bundle.unresolvedDetail).toMatch(/^the current commit feedfeedfeed.* is not in the checkout/);
    });

    it('without a commit of the baseline run', async () => {
      const {bundle} = await writeBundle({
        report, historyDir: createHistory(undefined), repoDir: repository.dir, chunks: [chunk('case1', [], repository.head)],
      });

      expect(bundle).toMatchObject({unresolved: 'no revision metadata', hunks: []});
      expect(bundle.regressions).toHaveLength(1);
    });

    it('with the history file that could not be read', async () => {
      const historyDir = createHistory(repository.base);
      fs.writeFileSync(path.join(historyDir, 'performance-run-1.json'), '[{"truncated');
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const {bundle} = await writeBundle({
        report, historyDir, repoDir: repository.dir, chunks: [chunk('case1', [], repository.head)],
      });

      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
      expect(bundle).toMatchObject({unresolved: 'no revision metadata', hunks: []});
      expect(bundle.unresolvedDetail).toMatch(/^1 of 1 baseline run\(s\) could not be read, e\.g\. baseline history .*performance-run-1\.json is unreadable/);
    });

    it('with baseline runs that recorded no commit', async () => {
      const {bundle} = await writeBundle({
        report, historyDir: createHistory(undefined), repoDir: repository.dir, chunks: [chunk('case1', [], repository.head)],
      });

      expect(bundle.unresolvedDetail).toBe('none of the 1 baseline run(s) recorded a commit (metadata.commit)');
    });

    it('outside of a git repository', async () => {
      const {bundle} = await writeBundle({
        report, historyDir: createHistory(repository.base), repoDir: temporaryDirectory(), chunks: [chunk('case1', [], repository.head)],
      });

      expect(bundle).toMatchObject({unresolved: 'git unavailable', hunks: []});
    });

    it('if the baseline commit is unknown, e.g. in a shallow checkout', async () => {
      const {bundle} = await writeBundle({
        report, historyDir: createHistory('0123456789abcdef0123456789abcdef01234567'), repoDir: repository.dir, chunks: [chunk('case1', [], repository.head)],
      });

      expect(bundle).toMatchObject({unresolved: 'baseline commit is not an ancestor', hunks: []});
      expect(bundle.unresolvedDetail).toContain('0123456789abcdef');
    });

    it('if the baseline commit is newer than the current commit', async () => {
      const {bundle} = await writeBundle({
        report, historyDir: createHistory(repository.head), repoDir: repository.dir, chunks: [chunk('case1', [], repository.base)],
      });

      expect(bundle).toMatchObject({unresolved: 'baseline commit is not an ancestor', hunks: []});
    });
  });
});
