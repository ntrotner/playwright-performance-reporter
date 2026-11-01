import {
  execFileSync,
} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ResultAccumulator,
} from 'playwright-performance-reporter';
import type {
  ComparisonReport,
  MetricChange,
  StepComparison,
} from '../src/types.js';

/**
 * Fresh temporary directory, resolved through symlinks so paths compare equal
 *
 * @param prefix name prefix
 */
export function temporaryDirectory(prefix = 'attribution-'): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/**
 * Run git in a directory without user config, hooks or signing
 *
 * @param cwd repository
 * @param arguments_ arguments of git
 */
export function git(cwd: string, arguments_: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...arguments_], {cwd, encoding: 'utf8'}).trim();
}

/**
 * Repository with a base commit and a head commit that changes lines 3-4 of `app/app.mjs` and adds `app/new.mjs`,
 * plus a commit on a side branch off the base, which is not an ancestor of the head
 */
export function createRepository(): {dir: string; base: string; head: string; side: string} {
  const dir = temporaryDirectory('attribution-repo-');
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(path.join(dir, 'app/app.mjs'), ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', ''].join('\n'));
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'base']);
  const base = git(dir, ['rev-parse', 'HEAD']);

  git(dir, ['checkout', '--quiet', '-b', 'side']);
  fs.writeFileSync(path.join(dir, 'app/side.mjs'), 'side\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'side']);
  const side = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '--quiet', 'main']);

  fs.writeFileSync(path.join(dir, 'app/app.mjs'), ['line 1', 'line 2', 'changed 3', 'changed 4', 'line 5', ''].join('\n'));
  fs.writeFileSync(path.join(dir, 'app/new.mjs'), ['new 1', 'new 2', ''].join('\n'));
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'head']);
  const head = git(dir, ['rev-parse', 'HEAD']);
  return {
    dir, base, head, side,
  };
}

/**
 * Json chunks of a run of one test `case1` with the step `Open`
 *
 * @param metadata metadata of the test, e.g. its commit
 * @param stopMetrics metrics of the stop of the step, e.g. its artifacts
 */
export function createRun(metadata: Record<string, string> | undefined, stopMetrics: Array<Record<string, string | number>> = []): ResultAccumulator[] {
  const performance = (name: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({
    name, startMeasurement: start, endMeasurement: end, startMetrics: [{metric: {}}], stopMetrics: [], samplingMetrics: [], ...extra,
  });
  /* eslint-disable @typescript-eslint/naming-convention -- keys of the json chunks */
  return [
    {case1: {TEST_CASE_PARENT: performance('test', 1000, 1000, metadata ? {metadata} : {})}},
    {case1: {step1: performance('Open', 1100, 1100)}},
    {case1: {step1: performance('Open', 1100, 1900, {startMetrics: [], stopMetrics: stopMetrics.map(metric => ({type: 'page', metric}))})}},
    {case1: {step2: performance('Idle', 2000, 2500, {stopMetrics: [{type: 'page', metric: {JSHeapUsedSize: 1}}]})}},
    {case1: {TEST_CASE_PARENT: performance('test', 1000, 2600, {startMetrics: []})}},
  ];
  /* eslint-enable @typescript-eslint/naming-convention */
}

/**
 * History dir with one run per commit, oldest first: `performance-run-1.json`, `performance-run-2.json`, …
 *
 * @param commits commit of every run, undefined for a run without one
 */
export function createHistory(...commits: Array<string | undefined>): string {
  const dir = temporaryDirectory('attribution-history-');
  for (const [index, commit] of commits.entries()) {
    fs.writeFileSync(path.join(dir, `performance-run-${index + 1}.json`), JSON.stringify(createRun(commit ? {commit, branch: 'main'} : {platform: 'linux'})));
  }

  return dir;
}

/**
 * Change of a metric of a test or step
 *
 * @param metric metric name
 * @param status status of the change
 */
export function change(metric: string, status: MetricChange['status'] = 'increased'): MetricChange {
  return {
    metric, kind: 'cumulative', unit: 'ms', status, current: 200, baselineMedian: 100, absoluteChange: 100, relativeChange: 1, zScore: 5, recentRuns: 3, baselineRuns: 3, series: [],
  };
}

/**
 * Comparison of a test or step
 *
 * @param key entity key, `case1` for the test, `case1|<step>|0` for a step
 * @param status verdict of the comparison
 * @param changes significant changes
 */
export function step(key: string, status: StepComparison['status'], changes: MetricChange[]): StepComparison {
  const [testId, stepName] = key.split('|');
  return {
    key,
    kind: stepName === undefined ? 'test' : 'step',
    testId,
    testName: 'test',
    ...(stepName === undefined ? {} : {stepName}),
    order: stepName === undefined ? 0 : 1,
    name: stepName ?? 'test',
    status,
    duration: {status: 'increased', current: 200, baselineMedian: 100},
    changes,
  };
}

/**
 * Comparison report whose baseline runs are the runs of `createHistory`
 *
 * @param steps compared tests and steps
 * @param baselineRunCount amount of baseline runs, `performance-run-1.json` to `performance-run-<n>.json`
 */
export function createReport(steps: StepComparison[], baselineRunCount = 1): ComparisonReport {
  const run = (index: number | string) => ({id: `performance-run-${index}`, file: `performance-run-${index}.json`, startedAt: '2026-10-31T00:00:00.000Z'});
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-31T00:00:00.000Z',
    status: 'ok',
    message: 'Compared 2 step(s)',
    currentRun: run('current'),
    recentRuns: [run('current')],
    baselineRuns: Array.from({length: baselineRunCount}, (_, index) => run(index + 1)),
    excludedRuns: [],
    settings: {
      requiredMetrics: ['TaskDuration'], bandPercentile: 0.05, recentRuns: 3, baselineWindow: 20, relativeThreshold: 0.1, zScoreThreshold: 2, minBaselineRuns: 3,
    },
    steps,
  };
}
