import {
  execFileSync,
} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  type ResultAccumulator,
  testCaseParent,
} from 'playwright-performance-reporter';
import type {
  ChangedHunk,
  ComparisonReport,
  StepComparison,
} from '../src/types.js';

/**
 * Fresh temporary directory
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
 * Repository with a base commit and a head commit that changes lines 3-4 of `app/app.mjs` and adds `app/new.mjs`
 */
export function createRepository(): {dir: string; base: string; head: string} {
  const dir = temporaryDirectory('attribution-repo-');
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(path.join(dir, 'app/app.mjs'), ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', ''].join('\n'));
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'base']);
  const base = git(dir, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(dir, 'app/app.mjs'), ['line 1', 'line 2', 'changed 3', 'changed 4', 'line 5', ''].join('\n'));
  fs.writeFileSync(path.join(dir, 'app/new.mjs'), ['new 1', 'new 2', ''].join('\n'));
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'head']);
  const head = git(dir, ['rev-parse', 'HEAD']);
  return {dir, base, head};
}

/**
 * Leaking app of the heap tests, which writes a heap snapshot of itself
 */
export const leakyApp = path.resolve('test/fixtures/leaky-app.mjs');

/**
 * 1-based line of the leaky app that contains a text
 *
 * @param text text of the line
 */
export function leakyAppLine(text: string): number {
  return fs.readFileSync(leakyApp, 'utf8').split('\n').findIndex(line => line.includes(text)) + 1;
}

/**
 * Changed lines of the leaky app, with their text like the presenter records them
 *
 * @param lines 1-based changed lines
 */
export function leakyAppHunk(lines: number[]): ChangedHunk {
  const source = fs.readFileSync(leakyApp, 'utf8').split('\n');
  return {
    file: 'test/fixtures/leaky-app.mjs',
    absoluteFile: leakyApp,
    addedRanges: lines.map(line => ({start: line, end: line})),
    addedLines: lines.map(line => ({line, text: source[line - 1]})),
  };
}

/**
 * History dir with one run per commit, oldest first: `performance-run-1.json`, `performance-run-2.json`, …
 *
 * @param commits commit of every run, undefined for a run without one
 */
export function createHistory(...commits: Array<string | undefined>): string {
  const dir = temporaryDirectory('attribution-history-');
  for (const [index, commit] of commits.entries()) {
    const metadata: Record<string, string> = commit ? {commit, branch: 'main'} : {platform: 'linux'};
    const run: ResultAccumulator[] = [{
      case1: {
        [testCaseParent]: {
          name: 'test', startMeasurement: index + 1, endMeasurement: index + 2, startMetrics: [], stopMetrics: [], samplingMetrics: [], metadata,
        },
      },
    }];
    fs.writeFileSync(path.join(dir, `performance-run-${index + 1}.json`), JSON.stringify(run));
  }

  return dir;
}

/**
 * Comparison report of a run, with the runs of `createHistory` as its baseline runs
 *
 * @param steps compared tests and steps
 * @param baselineRunCount amount of baseline runs, `performance-run-1.json` to `performance-run-<n>.json`
 */
export function createReport(steps: StepComparison[], baselineRunCount = 1): ComparisonReport {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-31T00:00:00.000Z',
    status: 'ok',
    message: 'Compared',
    currentRun: {id: 'performance-run-current', file: 'performance-run-current.json', startedAt: '2026-10-31T00:00:00.000Z'},
    recentRuns: [{id: 'performance-run-current', file: 'performance-run-current.json', startedAt: '2026-10-31T00:00:00.000Z'}],
    // Oldest first, like the comparison presenter
    baselineRuns: Array.from({length: baselineRunCount}, (_, index) => ({id: `performance-run-${index + 1}`, file: `performance-run-${index + 1}.json`, startedAt: `2026-10-${10 + index}T00:00:00.000Z`})),
    excludedRuns: [],
    settings: {
      requiredMetrics: [], bandPercentile: 0.05, recentRuns: 1, baselineWindow: 20, relativeThreshold: 0.1, zScoreThreshold: 2, minBaselineRuns: 3,
    },
    steps,
  };
}

/**
 * Compared step with the given changes
 *
 * @param key entity key
 * @param status verdict of the step
 * @param changes metric and status per change
 */
export function createStep(key: string, status: StepComparison['status'], changes: Array<{metric: string; status: StepComparison['changes'][number]['status']}>): StepComparison {
  const [testId, stepName, occurrence] = key.split('|');
  return {
    key,
    kind: stepName ? 'step' : 'test',
    testId,
    testName: 'test',
    stepName,
    occurrence: occurrence && occurrence !== '0' ? Number(occurrence) : undefined,
    order: stepName ? 1 : 0,
    name: stepName ? `test > ${stepName}` : 'test',
    status,
    duration: {status: 'unchanged', current: 100, baselineMedian: 100},
    changes: changes.map(change => ({
      metric: change.metric,
      kind: 'gauge',
      unit: change.metric.includes('Heap') ? 'bytes' : 'ms',
      status: change.status,
      current: 200,
      baselineMedian: 100,
      absoluteChange: 100,
      relativeChange: 1,
      zScore: 8,
      recentRuns: 1,
      baselineRuns: 4,
      series: [],
    })),
  };
}

/**
 * Function of a synthetic CPU profile and the lines its samples hit
 */
export type ProfiledFunction = {
  functionName: string;
  url: string;

  /**
   * 0-based line of the function, as in a CPU profile
   */
  lineNumber: number;

  /**
   * Sampled line (1-based) and amount of 1 ms samples on it
   */
  samples: Array<[line: number, count: number]>;
};

/**
 * Options of a synthetic trace
 */
export type TraceOptions = {
  /**
   * Record the line of every sample, which older Chrome versions omit. Defaults to true.
   */
  withLines?: boolean;

  /**
   * Url of the page in the main frame. Defaults to `http://localhost:4321/`.
   */
  pageUrl?: string;

  /**
   * Scripts that declare a source map, as recorded with the source rundown category
   */
  sourceMappedUrls?: string[];
};

/**
 * Write a gzip Chrome trace with a CPU profile, as `traceCapture` does, in which every sample takes 1 ms
 *
 * @param file target file
 * @param functions profiled functions
 * @param options lines, page and source maps
 */
export function writeTrace(file: string, functions: ProfiledFunction[], options: TraceOptions = {}): void {
  const withLines = options.withLines ?? true;
  const pid = 10;
  const tid = 11;
  const nodes = [
    {id: 1, callFrame: {codeType: 'other', functionName: '(root)', scriptId: 0}},
    {id: 2, parent: 1, callFrame: {codeType: 'other', functionName: '(program)', scriptId: 0}},
    ...functions.map((fn, index) => ({
      id: index + 3, parent: 1, callFrame: {
        codeType: 'JS', functionName: fn.functionName, url: fn.url, scriptId: index + 20, lineNumber: fn.lineNumber, columnNumber: 0,
      },
    })),
  ];
  const samples: number[] = [2];
  const lines: number[] = [0];
  for (const [index, fn] of functions.entries()) {
    for (const [line, count] of fn.samples) {
      for (let sample = 0; sample < count; sample++) {
        samples.push(index + 3);
        lines.push(line);
      }
    }
  }

  // A trailing idle sample closes the last sample
  samples.push(2);
  lines.push(0);
  const events = [
    {
      name: 'process_name', ph: 'M', pid, tid, ts: 0, cat: '__metadata', args: {name: 'Renderer'},
    },
    {
      name: 'thread_name', ph: 'M', pid, tid, ts: 0, cat: '__metadata', args: {name: 'CrRendererMain'},
    },
    {
      name: 'TracingStartedInBrowser', ph: 'I', s: 't', pid: 1, tid: 1, ts: 1000, cat: 'disabled-by-default-devtools.timeline', args: {
        data: {
          frameTreeNodeId: 1, frames: [{
            frame: 'F1', isInPrimaryMainFrame: true, isOutermostMainFrame: true, name: '', processId: pid, url: options.pageUrl ?? 'http://localhost:4321/',
          }], persistentIds: true,
        },
      },
    },
    ...(options.sourceMappedUrls ?? []).map((url, index) => ({
      name: 'ScriptCatchup', ph: 'X', pid, tid, ts: 1500, cat: 'disabled-by-default-devtools.v8-source-rundown', args: {
        data: {
          isolate: '1', scriptId: 100 + index, url, sourceMapUrl: `${url}.map`,
        },
      },
    })),
    {
      name: 'Profile', ph: 'P', id: '0x1', pid, tid, ts: 2000, cat: 'disabled-by-default-v8.cpu_profiler', args: {data: {startTime: 2000}},
    },
    {
      name: 'ProfileChunk', ph: 'P', id: '0x1', pid, tid: tid + 1, ts: 2001, cat: 'disabled-by-default-v8.cpu_profiler', args: {
        data: {
          cpuProfile: {nodes, samples},
          timeDeltas: samples.map((_, index) => index === 0 ? 0 : 1000),
          ...(withLines ? {lines} : {}),
        },
      },
    },
  ];
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({traceEvents: events})));
}
