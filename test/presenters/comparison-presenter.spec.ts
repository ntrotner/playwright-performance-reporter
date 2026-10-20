import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  nativePresenters,
  type ComparisonReport,
} from '../../src/presenters';
import {
  loadHistory,
  mergeRepeats,
  summarizeEntities,
} from '../../src/presenters/comparison-presenter/history';
import {
  buildStepComparisons,
  compareRuns,
  median,
  percentile,
  scaledMedianAbsoluteDeviation,
  splitRuns,
} from '../../src/presenters/comparison-presenter/comparison';
import {
  classifyMetric,
  metricUnit,
} from '../../src/presenters/comparison-presenter/constants';
import {
  type RunSummary,
} from '../../src/presenters/comparison-presenter/types';
import {
  type ResultAccumulator,
  type TargetMetric,
} from '../../src';

type RunInput = {
  start: number;
  taskDuration: number;
  heapSamples: number[];
  networkRequests: number;
  cpuActiveTime: number;
};

const performance = (name: string, fields: Partial<Record<string, unknown>>) => ({
  name,
  startMetrics: [],
  stopMetrics: [],
  samplingMetrics: [],
  startMeasurement: 0,
  endMeasurement: 0,
  ...fields,
});

const target = (metric: TargetMetric['metric']): TargetMetric => ({id: 'page', metric});

/**
 * Chunks as written by the reporter for one test with one step
 */
function buildRun(input: RunInput): ResultAccumulator[] {
  const stepStart = input.start + 10;
  const stepEnd = stepStart + 1000;
  const sampleInterval = 1000 / (input.heapSamples.length + 1);
  // Network counters grow linearly within the step
  const network = (time: number) => {
    const requests = input.networkRequests * Math.min(1, Math.max(0, time - stepStart) / 1000);
    return {totalNetworkRequests: requests, totalNetworkTransferSize: requests * 100, totalNetworkDuration: requests * 5};
  };

  const startMetric = target({
    JSHeapUsedSize: input.heapSamples[0], TaskDuration: 1, ScriptDuration: 0.5, Timestamp: input.start, ...network(stepStart),
  });
  const stopMetric = target({
    JSHeapUsedSize: input.heapSamples.at(-1)!, TaskDuration: 1 + input.taskDuration, ScriptDuration: 0.5 + input.taskDuration / 2, Timestamp: stepEnd, ...network(stepEnd),
  });
  const profile = target({
    cpuProfileDuration: 1000,
    cpuProfileSampleCount: 1000,
    cpuProfileActiveTime: input.cpuActiveTime,
    cpuProfileIdleTime: 1000 - input.cpuActiveTime,
  });

  return [
    {case: {TEST_CASE_PARENT: performance('suite > test', {startMetrics: [startMetric], startMeasurement: input.start, startMeasurementOffset: 1})}},
    {case: {step: performance('open page', {startMetrics: [startMetric, target({})], startMeasurement: stepStart, startMeasurementOffset: 1})}},
    ...input.heapSamples.map((heap, index) => ({
      case: {
        step: performance('open page', {
          startMeasurement: stepStart,
          endMeasurement: stepStart + (sampleInterval * (index + 1)),
          endMeasurementOffset: 1,
          samplingMetrics: [target({JSHeapUsedSize: heap, ...network(stepStart + (sampleInterval * (index + 1)))})],
        }),
      },
    })),
    {
      case: {
        step: performance('open page', {
          stopMetrics: [stopMetric, profile], startMeasurement: stepEnd, endMeasurement: stepEnd, endMeasurementOffset: 1,
        }),
      },
    },
    {case: {second: performance('submit form', {startMetrics: [target({TaskDuration: 5})], startMeasurement: stepEnd + 1, startMeasurementOffset: 1})}},
    {
      case: {
        second: performance('submit form', {
          stopMetrics: [target({TaskDuration: 5.5})], startMeasurement: stepEnd + 3, endMeasurement: stepEnd + 3, endMeasurementOffset: 1,
        }),
      },
    },
    {
      case: {
        TEST_CASE_PARENT: performance('suite > test', {
          stopMetrics: [stopMetric], startMeasurement: stepEnd + 5, endMeasurement: stepEnd + 5, endMeasurementOffset: 1,
        }),
      },
    },
  ] as ResultAccumulator[];
}

const baselineInputs: RunInput[] = [
  {
    start: 1000, taskDuration: 1, heapSamples: [100, 100, 100], networkRequests: 10, cpuActiveTime: 20,
  },
  {
    start: 2000, taskDuration: 1.05, heapSamples: [102, 102, 102, 102, 102], networkRequests: 10, cpuActiveTime: 21,
  },
  {
    start: 3000, taskDuration: 0.95, heapSamples: [98, 98], networkRequests: 10, cpuActiveTime: 19,
  },
];

describe('Comparison presenter', () => {
  let historyDir: string;
  let outputDir: string;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comparison-presenter-'));
    historyDir = path.join(root, 'history');
    outputDir = path.join(root, 'report');
    fs.mkdirSync(historyDir);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(historyDir), {recursive: true, force: true});
  });

  const writeHistory = (file: string, content: unknown) => {
    fs.writeFileSync(path.join(historyDir, file), typeof content === 'string' ? content : JSON.stringify(content));
  };

  const runPresenter = async (chunks: ResultAccumulator[]) => {
    const presenter = new nativePresenters.comparisonPresenter({historyDir, outputDir});
    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      await presenter.write(chunk);
    }

    const closed = await presenter.close();
    const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'performance-comparison.json'), 'utf8')) as ComparisonReport;
    const html = fs.readFileSync(path.join(outputDir, 'performance-comparison.html'), 'utf8');
    return {
      presenter, closed, report, html,
    };
  };

  describe('statistics', () => {
    it('should compute median and scaled median absolute deviation', () => {
      expect(median([3, 1, 2])).toBe(2);
      expect(median([4, 1, 2, 3])).toBe(2.5);
      expect(scaledMedianAbsoluteDeviation([1, 1, 1])).toBe(0);
      expect(scaledMedianAbsoluteDeviation([1, 2, 3])).toBeCloseTo(1.4826);
      expect(percentile([1, 2, 3, 4, 5], 0.05)).toBeCloseTo(1.2);
      expect(percentile([5, 1, 3], 1)).toBe(5);
    });
  });

  describe('direction of metrics', () => {
    const comparison = (metric: string, status: 'increased' | 'decreased') => ({entityKey: 'case', metric, status}) as any;
    const statusOf = (...comparisons: unknown[]) => buildStepComparisons([{key: 'case', kind: 'test', testId: 'case', testName: 'test', order: 0}], comparisons as any)[0].status;

    it('should treat a higher performance score as improvement', () => {
      expect(statusOf(comparison('performanceScore', 'increased'))).toBe('improved');
      expect(statusOf(comparison('performanceScore', 'decreased'))).toBe('regressed');
      expect(statusOf(comparison('performanceScore', 'increased'), comparison('TaskDuration', 'decreased'))).toBe('improved');
      expect(statusOf(comparison('performanceScore', 'decreased'), comparison('TaskDuration', 'decreased'))).toBe('mixed');
      expect(classifyMetric('performanceScore')).toBe('total');
      expect(metricUnit('performanceScore')).toBe('score');
    });
  });

  describe('metric semantics', () => {
    it.each([
      ['entityDuration', 'cumulative', 'ms'],
      ['TaskDuration', 'cumulative', 's'],
      ['ThreadTime', 'cumulative', 's'],
      ['LayoutCount', 'cumulative', 'count'],
      ['JSHeapUsedSize', 'gauge', 'bytes'],
      ['usedJsHeapSize', 'gauge', 'bytes'],
      ['Nodes', 'gauge', 'count'],
      ['totalNetworkRequests', 'cumulative', 'count'],
      ['totalNetworkTransferSize', 'cumulative', 'bytes'],
      ['totalNetworkDuration', 'cumulative', 'ms'],
      ['cpuProfileActiveTime', 'total', 'ms'],
      ['cpuProfileDuration', 'total', 'ms'],
      ['cpuProfileSampleCount', 'total', 'count'],
      ['largestContentfulPaint', 'total', 'ms'],
      ['interactionToNextPaint', 'total', 'ms'],
      ['cumulativeLayoutShift', 'total', 'score'],
      ['lcpRenderDelay', 'total', 'ms'],
      ['lcpSize', 'total', 'count'],
      ['clsLargestShiftValue', 'total', 'score'],
      ['inpInputDelay', 'total', 'ms'],
      ['inpProcessingDuration', 'total', 'ms'],
      ['inpPresentationDelay', 'total', 'ms'],
    ])('should classify %s as %s in %s', (metric, kind, unit) => {
      expect(classifyMetric(metric)).toBe(kind);
      expect(metricUnit(metric)).toBe(unit);
    });
  });

  describe('compareRuns', () => {
    const run = (id: string, value: number): RunSummary => ({
      id,
      file: `${id}.json`,
      startedAt: 0,
      entities: {
        case: {
          key: 'case',
          kind: 'test',
          testId: 'case',
          testName: 'test',
          order: 0,
          duration: 1,
          metrics: {
            TaskDuration: {
              kind: 'cumulative', value, lower: value, upper: value, median: value, observations: 1,
            },
          },
        },
      },
    });
    const compare = (baseline: number[], current: number) => compareRuns(
      [run('current', current)],
      baseline.map((value, index) => run(`run-${index}`, value)),
      {minBaselineRuns: 3, relativeThreshold: 0.1, zScoreThreshold: 2},
    ).find(comparison => comparison.metric === 'TaskDuration')!;

    it('should report changes above the relative threshold and outside the noise', () => {
      expect(compare([1, 1.01, 0.99], 2)).toEqual(expect.objectContaining({
        status: 'increased', baselineMedian: 1, absoluteChange: 1, relativeChange: 1,
      }));
      expect(compare([1, 1.01, 0.99], 0.5).status).toBe('decreased');
      expect(compare([1, 1.01, 0.99], 1).status).toBe('unchanged');
    });

    it('should ignore changes below the relative threshold', () => {
      expect(compare([1, 1.01, 0.99], 1.05).status).toBe('unchanged');
    });

    it('should classify changes within the noise of the baseline as noisy', () => {
      // Spread of the baseline is about 0.74, so a change of 30% has a z-score of about 0.4
      const comparison = compare([1, 1.5, 0.5], 1.3);

      expect(comparison.status).toBe('noisy');
      expect(comparison.relativeChange).toBeCloseTo(0.3);
      expect(comparison.zScore).toBeLessThan(2);
    });

    it('should only use the relative threshold without enough baseline runs', () => {
      expect(compare([0.5, 1.5], 1.3).status).toBe('increased');
    });

    it('should only compare the configured metrics and the duration', () => {
      const runWithHeap = (id: string) => {
        const summary = run(id, 1);
        summary.entities.case.metrics.JSHeapUsedSize = {
          kind: 'gauge', value: 1, lower: 1, upper: 1, median: 1, observations: 1,
        };
        summary.entities.case.metrics.entityDuration = {
          kind: 'cumulative', value: 1, lower: 1, upper: 1, median: 1, observations: 1,
        };
        return summary;
      };

      const comparisons = compareRuns([runWithHeap('current')], [runWithHeap('run-0')], {
        minBaselineRuns: 3, relativeThreshold: 0.1, zScoreThreshold: 2, comparedMetrics: ['JSHeapUsedSize'],
      });

      expect(comparisons.map(comparison => comparison.metric)).toEqual(['JSHeapUsedSize', 'entityDuration']);
    });

    it('should not divide by a zero baseline', () => {
      expect(compare([0, 0, 0], 1)).toEqual(expect.objectContaining({status: 'increased', relativeChange: undefined, zScore: undefined}));
    });
  });

  describe('splitRuns', () => {
    const runs = (count: number) => Array.from({length: count}, (_, index) => ({
      id: `run-${index}`, file: '', startedAt: index, entities: {},
    }));
    const ids = (split: ReturnType<typeof splitRuns>) => ({recent: split.recent.map(run => run.id), baseline: split.baseline.map(run => run.id)});
    const settings = {recentRuns: 3, baselineWindow: 4, minBaselineRuns: 3};

    it('should compare the latest runs against the runs before them', () => {
      expect(ids(splitRuns(runs(9), {...runs(10)[9]}, settings))).toEqual({
        recent: ['run-7', 'run-8', 'run-9'],
        baseline: ['run-3', 'run-4', 'run-5', 'run-6'],
      });
    });

    it('should shrink the recent runs first while the history is short', () => {
      expect(ids(splitRuns(runs(4), runs(5)[4], settings))).toEqual({recent: ['run-3', 'run-4'], baseline: ['run-0', 'run-1', 'run-2']});
      expect(ids(splitRuns(runs(2), runs(3)[2], settings))).toEqual({recent: ['run-2'], baseline: ['run-0', 'run-1']});
      expect(ids(splitRuns([], runs(1)[0], settings))).toEqual({recent: ['run-0'], baseline: []});
    });
  });

  describe('summarizeEntities', () => {
    it('should condense metrics independent of the amount of samples', () => {
      const few = summarizeEntities(buildRun({
        start: 0, taskDuration: 1, heapSamples: [100, 100], networkRequests: 10, cpuActiveTime: 20,
      }), 0.05);
      const many = summarizeEntities(buildRun({
        start: 0, taskDuration: 1, heapSamples: Array.from({length: 30}, () => 100), networkRequests: 10, cpuActiveTime: 20,
      }), 0.05);
      const stepKey = 'case|open page|0';

      expect(Object.keys(few)).toEqual(['case', stepKey, 'case|submit form|0']);
      expect(Object.values(few).map(entity => entity.order)).toEqual([0, 1, 2]);
      for (const metric of ['JSHeapUsedSize', 'TaskDuration', 'totalNetworkRequests', 'entityDuration', 'cpuProfileActiveTime']) {
        expect(many[stepKey].metrics[metric].value).toBeCloseTo(few[stepKey].metrics[metric].value);
      }

      // Band of a counter is its growth, not the absolute counter values
      expect(few[stepKey].metrics.TaskDuration).toEqual(expect.objectContaining({
        kind: 'cumulative', value: 1, rate: 1, lower: 1, median: 1, upper: 1,
      }));
      expect(few[stepKey].metrics.JSHeapUsedSize.kind).toBe('gauge');
      // Totals only belong to the step that measured them
      expect(few[stepKey].metrics.cpuProfileActiveTime).toEqual(expect.objectContaining({kind: 'total', value: 20}));
      expect(few['case|submit form|0'].metrics.cpuProfileActiveTime).toBeUndefined();
      expect(few[stepKey].metrics.Timestamp).toBeUndefined();
      expect(few[stepKey].stepName).toBe('open page');
      expect(few[stepKey].testName).toBe('suite > test');
    });

    it('should weight gauges by time instead of by the amount of samples', () => {
      const sample = (time: number, heap: number) => ({
        case: {step: performance('open page', {endMeasurement: time, endMeasurementOffset: 1, samplingMetrics: [target({JSHeapUsedSize: heap})]})},
      }) as ResultAccumulator;
      const withSamples = (samples: ResultAccumulator[]) => {
        const run = buildRun({
          start: 0, taskDuration: 1, heapSamples: [100, 200], networkRequests: 10, cpuActiveTime: 20,
        });
        // Keep start and stop chunks, replace the evenly spaced samples
        return summarizeEntities([...run.slice(0, 2), ...samples, ...run.slice(-4)], 0.05)['case|open page|0'].metrics.JSHeapUsedSize;
      };

      const sparse = withSamples([sample(250, 100), sample(750, 200)]);
      const dense = withSamples([sample(250, 100), ...Array.from({length: 20}, (_, index) => sample(750 + (index * 12), 200))]);

      expect(sparse.value).toBeCloseTo(151);
      expect(dense.value).toBeCloseTo(sparse.value);
      expect(dense.observations).toBeGreaterThan(sparse.observations);
      expect(sparse).toEqual(expect.objectContaining({lower: 100, upper: 200}));
      expect([dense.lower, dense.median, dense.upper]).toEqual([sparse.lower, sparse.median, sparse.upper]);
    });

    it('should condense a step without duration', () => {
      const run = buildRun({
        start: 0, taskDuration: 1, heapSamples: [100, 200], networkRequests: 10, cpuActiveTime: 20,
      });
      run.at(-2)!.case.second.endMeasurement = run.at(-3)!.case.second.startMeasurement;
      const {metrics} = summarizeEntities(run, 0.05)['case|submit form|0'];

      expect(metrics.entityDuration.value).toBe(0);
      expect(metrics.JSHeapUsedSize).toEqual(expect.objectContaining({
        value: 200, lower: 200, median: 200, upper: 200,
      }));
      expect(metrics.TaskDuration.rate).toBeUndefined();
    });

    it('should estimate the boundaries of a step from surrounding samples', () => {
      const run = buildRun({
        start: 0, taskDuration: 1, heapSamples: [100, 100], networkRequests: 10, cpuActiveTime: 20,
      });
      const withoutNetwork = (stepIds: string[]) => summarizeEntities(run.map(chunk => {
        const copy = structuredClone(chunk);
        for (const stepId of stepIds) {
          for (const metric of [...(copy.case?.[stepId]?.startMetrics ?? []), ...(copy.case?.[stepId]?.stopMetrics ?? [])]) {
            delete metric.metric.totalNetworkRequests;
          }
        }

        return copy;
      }), 0.05)['case|open page|0'].metrics.totalNetworkRequests.value;

      // Step boundaries are interpolated between the test boundaries and the samples
      expect(withoutNetwork(['step'])).toBeGreaterThan(9.5);
      expect(withoutNetwork(['step'])).toBeLessThanOrEqual(10);
      // Without surrounding observations only the growth between the samples is known, nothing is extrapolated
      expect(withoutNetwork(['step', 'TEST_CASE_PARENT'])).toBeCloseTo(3.33, 1);
    });

    it('should tolerate counter resets', () => {
      const run = buildRun({
        start: 0, taskDuration: 1, heapSamples: [100, 100], networkRequests: 10, cpuActiveTime: 20,
      });
      run.splice(-4, 0, {case: {step: performance('open page', {endMeasurement: 900, endMeasurementOffset: 1, samplingMetrics: [target({TaskDuration: 0.25})]})}} as ResultAccumulator);
      const entities = summarizeEntities(run, 0.05);

      // 1 -> reset to 0.25 -> 2
      expect(entities['case|open page|0'].metrics.TaskDuration.value).toBeCloseTo(2);
    });
  });

  describe('loadHistory', () => {
    it('should only include runs which contain all required metrics', async () => {
      writeHistory('b-valid.json', buildRun(baselineInputs[1]));
      writeHistory('a-valid.json', buildRun(baselineInputs[0]));
      writeHistory('missing.json', [{case: {step: performance('open page', {stopMetrics: [target({JSHeapUsedSize: 1})]})}}]);
      writeHistory('truncated.json', '[{"case":');
      writeHistory('object.json', {not: 'chunks'});
      writeHistory('notes.txt', 'ignored');

      const history = await loadHistory(historyDir, ['JSHeapUsedSize', 'totalNetworkRequests'], [path.join(historyDir, 'object.json')], 0.05);

      expect(history.runs.map(run => run.id)).toEqual(['a-valid', 'b-valid']);
      expect(history.excluded).toEqual([
        {file: 'missing.json', reason: 'Missing required metrics', missingMetrics: ['totalNetworkRequests']},
        expect.objectContaining({file: 'truncated.json'}),
      ]);
    });

    it('should date a run without measurements by its file', async () => {
      writeHistory('empty.json', []);
      const {mtimeMs} = fs.statSync(path.join(historyDir, 'empty.json'));

      const {runs} = await loadHistory(historyDir, [], [], 0.05);

      expect(runs).toEqual([expect.objectContaining({id: 'empty', startedAt: mtimeMs, entities: {}})]);
    });

    it('should return an empty history for a missing directory', async () => {
      expect(await loadHistory(path.join(historyDir, 'unknown'), [], [], 0.05)).toEqual({runs: [], excluded: []});
    });
  });

  describe('ComparisonPresenter', () => {
    it('should compare the steps against the baseline in order of execution', async () => {
      for (const [index, input] of baselineInputs.entries()) {
        writeHistory(`run-${index}.json`, buildRun(input));
      }

      writeHistory('incomplete.json', [{case: {}}]);

      const {closed, report, html} = await runPresenter(buildRun({
        start: 10_000, taskDuration: 2, heapSamples: Array.from({length: 12}, () => 100), networkRequests: 5, cpuActiveTime: 60,
      }));

      expect(closed).toBe(true);
      expect(report.status).toBe('ok');
      expect(report.baselineRuns).toHaveLength(3);
      expect(report.excludedRuns).toEqual([expect.objectContaining({file: 'incomplete.json', reason: 'Missing required metrics'})]);
      expect(report.steps.map(step => [step.name, step.order])).toEqual([
        ['suite > test', 0],
        ['suite > test > open page', 1],
        ['suite > test > submit form', 2],
      ]);
      expect(report.message).toContain('Compared 2 step(s)');

      const openPage = report.steps[1];
      const change = (metric: string) => openPage.changes.find(c => c.metric === metric);
      expect(openPage.status).toBe('mixed');
      expect(change('TaskDuration')).toEqual(expect.objectContaining({
        status: 'increased', unit: 's', current: 2, baselineMedian: 1,
      }));
      for (const [index, expected] of [1, 1.05, 0.95, 2].entries()) {
        expect(change('TaskDuration')?.series[index].value).toBeCloseTo(expected);
      }

      expect(change('cpuProfileActiveTime')).toEqual(expect.objectContaining({status: 'increased', kind: 'total', unit: 'ms'}));
      expect(change('totalNetworkRequests')).toEqual(expect.objectContaining({status: 'decreased'}));
      // Same heap level with more samples is not a change
      expect(change('JSHeapUsedSize')).toBeUndefined();
      expect(openPage.changes[0].status).toBe('increased');
      expect(report.steps[2]).toEqual(expect.objectContaining({status: 'unchanged', changes: []}));

      expect(html).toContain('<title>Step Performance Comparison</title>');
      expect(html).toContain('"currentRunId"');
      expect(fs.readdirSync(historyDir).filter(file => file.startsWith('performance-run-'))).toHaveLength(1);
    });

    it('should compare the median of the recent runs to smooth out a single outlier', async () => {
      const inputs = [...baselineInputs, {...baselineInputs[0], start: 4000}, {...baselineInputs[1], start: 5000}];
      for (const [index, input] of inputs.entries()) {
        writeHistory(`run-${index}.json`, buildRun(input));
      }

      // Only the current run is slow, the other recent runs are not
      const {report} = await runPresenter(buildRun({...baselineInputs[0], start: 10_000, taskDuration: 3}));
      const openPage = report.steps.find(step => step.key === 'case|open page|0')!;

      expect(report.recentRuns).toHaveLength(3);
      expect(report.baselineRuns).toHaveLength(3);
      expect(report.message).toContain('latest 3 run(s)');
      expect(openPage.changes.find(change => change.metric === 'TaskDuration')).toBeUndefined();
    });

    it('should report a change that persists across the recent runs', async () => {
      const inputs = [...baselineInputs, {...baselineInputs[0], start: 4000, taskDuration: 3}, {...baselineInputs[1], start: 5000, taskDuration: 3}];
      for (const [index, input] of inputs.entries()) {
        writeHistory(`run-${index}.json`, buildRun(input));
      }

      const {report} = await runPresenter(buildRun({...baselineInputs[0], start: 10_000, taskDuration: 3}));
      const openPage = report.steps.find(step => step.key === 'case|open page|0')!;

      expect(openPage.changes.find(change => change.metric === 'TaskDuration')).toEqual(expect.objectContaining({
        status: 'increased', current: 3, baselineMedian: 1, recentRuns: 3, baselineRuns: 3,
      }));
    });

    it('should report missing and new steps of the current run', async () => {
      writeHistory('run-0.json', buildRun(baselineInputs[0]));
      const current = buildRun(baselineInputs[1]).map(chunk => {
        const renamed = structuredClone(chunk);
        if (renamed.case?.step) {
          renamed.case.step.name = 'renamed step';
        }

        return renamed;
      });

      const {report} = await runPresenter(current);
      const step = (key: string) => report.steps.find(s => s.key === key);

      expect(report.status).toBe('low-confidence');
      expect(step('case|open page|0')).toEqual(expect.objectContaining({status: 'missing', duration: expect.objectContaining({status: 'missing'})}));
      expect(step('case|renamed step|0')?.status).toBe('new');
    });

    it('should only compare runs measured under the same conditions', async () => {
      const throttled = (chunks: ResultAccumulator[]) => {
        const [first, ...rest] = chunks;
        return [{case: {TEST_CASE_PARENT: {...first.case.TEST_CASE_PARENT, conditions: {cpuSlowdown: 4, disableCache: false, description: 'CPU 4x slowdown'}}}}, ...rest];
      };

      writeHistory('run-0.json', buildRun(baselineInputs[0]));
      writeHistory('run-1.json', throttled(buildRun(baselineInputs[1])));

      const {report, html} = await runPresenter(throttled(buildRun({...baselineInputs[2], start: 10_000})));

      expect(report.conditions).toBe('CPU 4x slowdown');
      expect(report.baselineRuns.map(run => run.file)).toEqual(['run-1.json']);
      expect(report.excludedRuns).toEqual([{file: 'run-0.json', reason: 'Different measurement conditions: unthrottled'}]);
      expect(html).toContain('Measured under: CPU 4x slowdown.');
    });

    it('should merge the repeats of a test into its first repeat by the median', async () => {
      const repeat = (caseId: string, repeatEachIndex: number, taskDuration: number) => buildRun({...baselineInputs[0], start: 10_000 + (repeatEachIndex * 5000), taskDuration}).map(chunk => {
        const steps = structuredClone(chunk.case);
        if (steps.TEST_CASE_PARENT && steps.TEST_CASE_PARENT.startMetrics.length > 0) {
          steps.TEST_CASE_PARENT.execution = {repeatEachIndex, retry: 0};
        }

        return {[caseId]: steps};
      });

      writeHistory('run-0.json', buildRun(baselineInputs[0]));
      const {report} = await runPresenter([...repeat('case', 0, 1), ...repeat('case-repeat-1', 1, 3), ...repeat('case-repeat-2', 2, 2)]);

      const openPage = report.steps.find(step => step.key === 'case|open page|0');
      expect(report.steps.map(step => step.key)).not.toContain('case-repeat-1');
      expect(openPage?.changes.find(change => change.metric === 'TaskDuration')).toEqual(expect.objectContaining({current: 2, status: 'increased'}));
      const entities = summarizeEntities(repeat('case', 0, 1), 0.05);
      expect(mergeRepeats(entities, new Map(), 0.05)).toEqual(entities);
    });

    it('should provide the report and the metadata of the runs', async () => {
      const withMetadata = (chunks: ResultAccumulator[]) => {
        const [first, ...rest] = chunks;
        return [{case: {TEST_CASE_PARENT: {...first.case.TEST_CASE_PARENT, metadata: {commit: 'abc123'}}}}, ...rest];
      };

      writeHistory('run-0.json', withMetadata(buildRun(baselineInputs[0])));
      const presenter = new nativePresenters.comparisonPresenter({historyDir, outputDir});
      for (const chunk of withMetadata(buildRun({...baselineInputs[1], start: 10_000}))) {
        // eslint-disable-next-line no-await-in-loop
        await presenter.write(chunk);
      }

      const report = await presenter.getReport();
      const [history] = (await loadHistory(historyDir, [], [], 0.05)).runs;

      expect(report?.status).toBe('low-confidence');
      expect(await presenter.getReport()).toBe(report);
      expect(history.metadata).toEqual({commit: 'abc123'});
      expect(await new nativePresenters.comparisonPresenter({historyDir, outputDir}).getReport()).toBeUndefined();
    });

    it('should mark the current run as baseline without history', async () => {
      const {closed, report} = await runPresenter(buildRun(baselineInputs[0]));

      expect(closed).toBe(true);
      expect(report.status).toBe('no-baseline');
      expect(report.steps.every(step => step.status === 'new' && step.changes.length === 0)).toBe(true);
    });

    it('should not compare a current run without the required metrics', async () => {
      writeHistory('run-0.json', buildRun(baselineInputs[0]));
      const {report} = await runPresenter([{case: {TEST_CASE_PARENT: performance('suite > test', {})}}] as ResultAccumulator[]);

      expect(report.status).toBe('invalid-current-run');
      expect(report.message).toContain('JSHeapUsedSize');
      expect(report.steps).toEqual([]);
    });

    it('should not create a run without writes', async () => {
      const presenter = new nativePresenters.comparisonPresenter({historyDir, outputDir});

      expect(await presenter.close()).toBe(true);
      expect(fs.readdirSync(historyDir)).toEqual([]);
      expect(fs.readdirSync(outputDir)).toEqual([]);
    });

    it('should not treat the reports as history when they are written into the history directory', async () => {
      outputDir = historyDir;
      await runPresenter(buildRun(baselineInputs[0]));
      const {report} = await runPresenter(buildRun(baselineInputs[1]));

      expect(report.excludedRuns).toEqual([]);
      expect(report.baselineRuns).toHaveLength(1);
    });

    it('should keep the reports of a previous run on delete without writes', async () => {
      await runPresenter(buildRun(baselineInputs[0]));
      const presenter = new nativePresenters.comparisonPresenter({historyDir, outputDir});

      expect(await presenter.delete()).toBe(true);
      expect(fs.readdirSync(historyDir)).toHaveLength(1);
      expect(fs.readdirSync(outputDir)).toEqual(['performance-comparison.html', 'performance-comparison.json']);
    });

    it('should generate the reports only once', async () => {
      const {presenter} = await runPresenter(buildRun(baselineInputs[0]));
      fs.rmSync(path.join(outputDir, 'performance-comparison.json'));

      expect(await presenter.close()).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'performance-comparison.json'))).toBe(false);
    });

    it('should remove the current run and reports on delete', async () => {
      const {presenter} = await runPresenter(buildRun(baselineInputs[0]));

      expect(await presenter.delete()).toBe(true);
      expect(fs.readdirSync(historyDir)).toEqual([]);
      expect(fs.readdirSync(outputDir)).toEqual([]);
    });

    it('should keep the Web Vitals attribution of the latest measurement of a step', async () => {
      const run = buildRun(baselineInputs[0]);
      const attributed = (lcpElement: string) => target({
        largestContentfulPaint: 1200, lcpElement, lcpUrl: 'hero.png', lcpRenderDelay: 20, inpTarget: 'button.buy', inpEventType: 'click',
      });
      const openPage = run.filter(chunk => chunk.case.step?.stopMetrics.length > 0).at(-1)!.case.step;
      openPage.stopMetrics.push(attributed('img#hero'));
      // Older measurement of the same step
      run[1].case.step.startMetrics.push(attributed('img#old'));

      const entities = summarizeEntities(run, 0.05);
      const {report, html} = await runPresenter(run);

      expect(entities['case|open page|0'].attribution).toEqual({
        lcp: {element: 'img#hero', url: 'hero.png'},
        inp: {target: 'button.buy', eventType: 'click'},
      });
      expect(entities['case|submit form|0'].attribution).toBeUndefined();
      expect(entities['case|open page|0'].metrics.lcpRenderDelay).toEqual(expect.objectContaining({kind: 'total', value: 20}));
      expect(entities['case|open page|0'].metrics).not.toHaveProperty('lcpElement');
      expect(report.steps.flatMap(step => step.changes).some(change => change.metric === 'lcpElement')).toBe(false);
      expect(html).toContain('"attribution":{"lcp":{"element":"img#hero","url":"hero.png"}');
      expect(html).toContain('<div id="attribution" class="attribution" hidden></div>');
    });

    it('should keep the slowest scripts of the latest long animation frames measurement of a step', async () => {
      const run = buildRun(baselineInputs[0]);
      const scripts = [{
        sourceURL: 'app.js', sourceFunctionName: 'render', invoker: 'BUTTON.onclick', invokerType: 'event-listener', duration: 140, forcedStyleAndLayoutDuration: 15, count: 2,
      }];
      const openPage = run.filter(chunk => chunk.case.step?.stopMetrics.length > 0).at(-1)!.case.step;
      openPage.stopMetrics.push(target({loafCount: 2, loafTopScripts: JSON.stringify(scripts)}));
      run[1].case.step.startMetrics.push(target({loafCount: 0, loafTopScripts: '[]'}));
      run.at(-2)!.case.second.stopMetrics.push(target({loafTopScripts: 'not json'}));

      const entities = summarizeEntities(run, 0.05);
      const {html} = await runPresenter(run);

      expect(entities['case|open page|0'].longAnimationFrameScripts).toEqual(scripts);
      expect(entities['case|submit form|0'].longAnimationFrameScripts).toBeUndefined();
      expect(entities['case|open page|0'].metrics).not.toHaveProperty('loafTopScripts');
      expect(html).toContain('"scripts":[{"sourceURL":"app.js"');
      expect(html).toContain('<div id="scripts" class="scripts" hidden></div>');
    });

    it('should embed Chart.js into the visual report unless disabled', async () => {
      const {html} = await runPresenter(buildRun(baselineInputs[0]));
      expect(html).toContain('Chart.js v4');
      expect(html).not.toContain('cdn.jsdelivr.net');

      const presenter = new nativePresenters.comparisonPresenter({historyDir, outputDir, inlineAssets: false, visualReportOutputFile: 'cdn.html'});
      for (const chunk of buildRun({...baselineInputs[1], start: 10_000})) {
        // eslint-disable-next-line no-await-in-loop
        await presenter.write(chunk);
      }

      await presenter.close();
      expect(fs.readFileSync(path.join(outputDir, 'cdn.html'), 'utf8')).toMatch(/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.\d+\.\d+\//);
    });

    it('should escape data embedded into the html', async () => {
      const run = buildRun(baselineInputs[0]);
      (run[0].case.TEST_CASE_PARENT as any).name = '</script><script>alert(1)</script>';
      const {html} = await runPresenter(run);

      expect(html).not.toContain('</script><script>alert(1)');
    });

    it('should classify small changes within the noise as noisy', async () => {
      for (const [index, input] of baselineInputs.entries()) {
        writeHistory(`run-${index}.json`, buildRun(input));
      }

      // CpuProfileActiveTime = 21 (baseline median = 20, spread ≈ 1.48),
      // a 5% increase with a z-score of about 0.7
      const {report} = await runPresenter(buildRun({
        start: 10_000, taskDuration: 1, heapSamples: Array.from({length: 12}, () => 100), networkRequests: 10, cpuActiveTime: 21,
      }));
      const openPage = report.steps.find(step => step.key === 'case|open page|0')!;

      expect(openPage.status).toBe('noisy');
      expect(openPage.changes).toEqual([]);
    });
  });
});
