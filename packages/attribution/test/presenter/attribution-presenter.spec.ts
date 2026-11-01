import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type {
  PresenterWriter,
} from 'playwright-performance-reporter';
import {
  attributionPresenter,
} from '../../src/index.js';
import type {
  AttributionBundle,
  ComparisonReport,
} from '../../src/types.js';
import {
  change,
  createHistory,
  createReport,
  createRepository,
  createRun,
  git,
  step,
  temporaryDirectory,
} from '../helpers.js';

describe('attribution presenter', () => {
  const repository = createRepository();
  let outputDir: string;

  beforeEach(() => {
    outputDir = temporaryDirectory('attribution-output-');
  });

  const regressedReport = (baselineRunCount = 1) => createReport([
    step('case1', 'mixed', [change('TaskDuration'), change('ScriptDuration', 'decreased')]),
    step('case1|Open|0', 'regressed', [change('heapDiffAddedBytes')]),
    step('case1|Idle|0', 'improved', [change('TaskDuration', 'decreased')]),
  ], baselineRunCount);

  /**
   * Run the presenter like the reporter does: write every chunk, then close
   */
  const run = async (options: {
    report?: ComparisonReport | (() => Promise<ComparisonReport | undefined>);
    metadata?: Record<string, string>;
    historyDir?: string;
    repoDir?: string;
    stopMetrics?: Array<Record<string, string | number>>;
  }) => {
    const {report} = options;
    const presenter: PresenterWriter = new attributionPresenter({
      outputDir,
      comparison: {getReport: typeof report === 'function' ? report : async () => report},
      historyDir: options.historyDir,
      repoDir: options.repoDir ?? repository.dir,
    });
    for (const chunk of createRun(options.metadata, options.stopMetrics)) {
      // eslint-disable-next-line no-await-in-loop
      await presenter.write(chunk);
    }

    const filePath = path.join(outputDir, 'attribution-bundle.json');
    const writtenBeforeClose = fs.existsSync(filePath);
    const closed = await presenter.close();
    const bundle = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AttributionBundle;
    return {
      presenter, bundle, closed, writtenBeforeClose, filePath,
    };
  };

  it('hands off the regressions with their artifacts and the changed hunks since the baseline commit', async () => {
    const {bundle, closed, writtenBeforeClose} = await run({
      report: regressedReport(),
      metadata: {commit: repository.head, branch: 'feature'},
      historyDir: createHistory(repository.base),
      stopMetrics: [{traceFile: 'traces/trace-1.json.gz', heapDiffFile: ''}, {heapDiffFile: 'heap/heap-1.heapsnapshot', heapDiffTopClasses: '[{"name":"Array","count":2,"selfSize":64}]'}],
    });

    expect(writtenBeforeClose).toBe(false);
    expect(closed).toBe(true);
    expect(bundle.status).toBe('ok');
    expect(bundle.run).toEqual({
      commit: repository.head, branch: 'feature', baselineCommit: repository.base, startedAt: '2026-10-31T00:00:00.000Z',
    });
    expect(bundle.settings).toMatchObject({recentRuns: 3, zScoreThreshold: 2, minBaselineRuns: 3});
    expect(bundle.regressions.map(regression => [regression.entityKey, regression.status, regression.changes.map(item => item.metric)])).toEqual([
      ['case1', 'mixed', ['TaskDuration']],
      ['case1|Open|0', 'regressed', ['heapDiffAddedBytes']],
    ]);
    expect(bundle.regressions[0]).toMatchObject({artifactReason: 'no-artifact'});
    expect(bundle.regressions[1]).toMatchObject({
      traceFile: {file: 'traces/trace-1.json.gz', absoluteFile: path.resolve(process.cwd(), 'traces/trace-1.json.gz')},
      heapDiffFile: {file: 'heap/heap-1.heapsnapshot', absoluteFile: path.resolve(process.cwd(), 'heap/heap-1.heapsnapshot')},
      heapDiffTopClasses: '[{"name":"Array","count":2,"selfSize":64}]',
    });
    expect(bundle.regressions[1].artifactReason).toBeUndefined();
    expect(bundle.changedFiles).toEqual([
      {file: 'app/app.mjs', addedRanges: [{start: 3, end: 4}]},
      {file: 'app/new.mjs', addedRanges: [{start: 1, end: 2}]},
    ]);
  });

  it('takes the newest baseline commit other than the run commit, as re-runs of the run commit can be in the baseline', async () => {
    const {bundle} = await run({
      report: regressedReport(3),
      metadata: {commit: repository.head},
      historyDir: createHistory(repository.base, repository.head, undefined),
    });

    expect(bundle.run.baselineCommit).toBe(repository.base);
    expect(bundle.status).toBe('ok');
  });

  it.each([
    ['the run recorded no commit', {metadata: {branch: 'main'}}],
    ['no baseline run recorded a commit', {historyDir: createHistory(undefined, undefined)}],
    ['the history dir of the baseline runs is unknown', {historyDir: undefined}],
  ])('reports no-revision-metadata if %s, and keeps the regressions', async (_, options) => {
    const {bundle} = await run({
      report: regressedReport(2), metadata: {commit: repository.head}, historyDir: createHistory(repository.base, repository.base), ...options,
    });

    expect([bundle.status, bundle.changedFiles, bundle.regressions.length]).toEqual(['no-revision-metadata', [], 2]);
    expect(bundle.message).not.toBe('');
  });

  it('reports git-unavailable outside of a repository and for a commit missing from the checkout', async () => {
    const outside = await run({
      report: regressedReport(), metadata: {commit: repository.head}, historyDir: createHistory(repository.base), repoDir: temporaryDirectory('attribution-no-repo-'),
    });
    const missing = await run({
      report: regressedReport(), metadata: {commit: 'f'.repeat(40)}, historyDir: createHistory(repository.base),
    });

    expect([outside.bundle.status, outside.bundle.changedFiles, outside.bundle.regressions.length]).toEqual(['git-unavailable', [], 2]);
    expect(missing.bundle.status).toBe('git-unavailable');
    expect(missing.bundle.message).toContain('f'.repeat(40));
  });

  it('reports baseline-not-an-ancestor for a baseline commit of another branch', async () => {
    const {bundle} = await run({report: regressedReport(), metadata: {commit: repository.head}, historyDir: createHistory(repository.side)});

    expect([bundle.status, bundle.run.baselineCommit, bundle.changedFiles]).toEqual(['baseline-not-an-ancestor', repository.side, []]);
  });

  it('reports no-regressions without running git, and no-comparison without a report', async () => {
    const improved = await run({
      report: createReport([step('case1|Idle|0', 'improved', [change('TaskDuration', 'decreased')])]), metadata: {commit: repository.head}, repoDir: '/nonexistent',
    });
    const missing = await run({report: undefined, metadata: {commit: repository.head}});

    expect([improved.bundle.status, improved.bundle.regressions]).toEqual(['no-regressions', []]);
    expect([missing.bundle.status, missing.bundle.regressions]).toEqual(['no-comparison', []]);
  });

  it('never throws: a failing comparison still leaves a bundle that says why', async () => {
    const {bundle, closed} = await run({
      async report() {
        throw new Error('history unreadable');
      },
      metadata: {commit: repository.head},
    });

    expect(closed).toBe(true);
    expect(bundle.status).toBe('no-comparison');
    expect(bundle.message).toContain('history unreadable');
  });

  it('resolves close to false instead of throwing if the bundle cannot be written', async () => {
    const file = path.join(outputDir, 'not-a-dir');
    fs.writeFileSync(file, '');
    const presenter = new attributionPresenter({outputDir: file, comparison: {getReport: async () => regressedReport()}});

    await expect(presenter.close()).resolves.toBe(false);
  });

  it('writes the bundle once, atomically, and never to the GitHub job summary', async () => {
    const summary = path.join(outputDir, 'step-summary.md');
    const previous = process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_STEP_SUMMARY = summary;
    try {
      const {presenter, filePath} = await run({report: regressedReport(), metadata: {commit: repository.head}, historyDir: createHistory(repository.base)});
      fs.rmSync(filePath);

      await presenter.close();

      expect(fs.readdirSync(outputDir)).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY;
      } else {
        process.env.GITHUB_STEP_SUMMARY = previous;
      }
    }
  });

  it('removes the bundle it wrote on delete, and writes none after a delete', async () => {
    const {presenter, filePath} = await run({report: regressedReport(), metadata: {commit: repository.head}});
    await presenter.delete();
    const deletedFirst = new attributionPresenter({outputDir, comparison: {getReport: async () => regressedReport()}});
    await deletedFirst.delete();
    await deletedFirst.close();

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('keeps the repository untouched', async () => {
    const before = git(repository.dir, ['status', '--porcelain']);
    await run({report: regressedReport(), metadata: {commit: repository.head}, historyDir: createHistory(repository.base)});

    expect(git(repository.dir, ['status', '--porcelain'])).toBe(before);
  });
});
