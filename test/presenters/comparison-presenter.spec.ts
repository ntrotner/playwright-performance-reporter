import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativePresenters} from '../../src/presenters';
import {type ComparisonReport} from '../../src/presenters';
import {loadHistory, summarizeEntities} from '../../src/presenters/comparison-presenter/history';
import {median, scaledMedianAbsoluteDeviation, splitRuns} from '../../src/presenters/comparison-presenter/comparison';
import {type ResultAccumulator, type TargetMetric} from '../../src';

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

  const startMetric = target({JSHeapUsedSize: input.heapSamples[0], TaskDuration: 1, ScriptDuration: 0.5, Timestamp: input.start, ...network(stepStart)});
  const stopMetric = target({JSHeapUsedSize: input.heapSamples.at(-1)!, TaskDuration: 1 + input.taskDuration, ScriptDuration: 0.5 + input.taskDuration / 2, Timestamp: stepEnd, ...network(stepEnd)});
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
    {case: {step: performance('open page', {stopMetrics: [stopMetric, profile], startMeasurement: stepEnd, endMeasurement: stepEnd, endMeasurementOffset: 1})}},
    {case: {second: performance('submit form', {startMetrics: [target({TaskDuration: 5})], startMeasurement: stepEnd + 1, startMeasurementOffset: 1})}},
    {case: {second: performance('submit form', {stopMetrics: [target({TaskDuration: 5.5})], startMeasurement: stepEnd + 3, endMeasurement: stepEnd + 3, endMeasurementOffset: 1})}},
    {case: {TEST_CASE_PARENT: performance('suite > test', {stopMetrics: [stopMetric], startMeasurement: stepEnd + 5, endMeasurement: stepEnd + 5, endMeasurementOffset: 1})}},
  ] as ResultAccumulator[];
}

const baselineInputs: RunInput[] = [
  {start: 1000, taskDuration: 1, heapSamples: [100, 100, 100], networkRequests: 10, cpuActiveTime: 20},
  {start: 2000, taskDuration: 1.05, heapSamples: [102, 102, 102, 102, 102], networkRequests: 10, cpuActiveTime: 21},
  {start: 3000, taskDuration: 0.95, heapSamples: [98, 98], networkRequests: 10, cpuActiveTime: 19},
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
    return {presenter, closed, report, html};
  };

  describe('statistics', () => {
    it('should compute median and scaled median absolute deviation', () => {
      expect(median([3, 1, 2])).toBe(2);
      expect(median([4, 1, 2, 3])).toBe(2.5);
      expect(scaledMedianAbsoluteDeviation([1, 1, 1])).toBe(0);
      expect(scaledMedianAbsoluteDeviation([1, 2, 3])).toBeCloseTo(1.4826);
    });
  });

  describe('splitRuns', () => {
    const runs = (count: number) => Array.from({length: count}, (_, index) => ({id: `run-${index}`, file: '', startedAt: index, entities: {}}));
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
      const few = summarizeEntities(buildRun({start: 0, taskDuration: 1, heapSamples: [100, 100], networkRequests: 10, cpuActiveTime: 20}));
      const many = summarizeEntities(buildRun({start: 0, taskDuration: 1, heapSamples: Array.from({length: 30}, () => 100), networkRequests: 10, cpuActiveTime: 20}));
      const stepKey = 'case|open page|0';

      expect(Object.keys(few)).toEqual(['case', stepKey, 'case|submit form|0']);
      expect(Object.values(few).map(entity => entity.order)).toEqual([0, 1, 2]);
      for (const metric of ['JSHeapUsedSize', 'TaskDuration', 'totalNetworkRequests', 'entityDuration', 'cpuProfileActiveTime']) {
        expect(many[stepKey].metrics[metric].value).toBeCloseTo(few[stepKey].metrics[metric].value);
      }

      expect(few[stepKey].metrics.TaskDuration).toEqual(expect.objectContaining({kind: 'cumulative', value: 1, rate: 1}));
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
        const run = buildRun({start: 0, taskDuration: 1, heapSamples: [100, 200], networkRequests: 10, cpuActiveTime: 20});
        // Keep start and stop chunks, replace the evenly spaced samples
        return summarizeEntities([...run.slice(0, 2), ...samples, ...run.slice(-4)])['case|open page|0'].metrics.JSHeapUsedSize;
      };

      const sparse = withSamples([sample(250, 100), sample(750, 200)]);
      const dense = withSamples([sample(250, 100), ...Array.from({length: 20}, (_, index) => sample(750 + (index * 12), 200))]);

      expect(sparse.value).toBeCloseTo(151);
      expect(dense.value).toBeCloseTo(sparse.value);
      expect(dense.observations).toBeGreaterThan(sparse.observations);
    });

    it('should estimate the boundaries of a step from surrounding samples', () => {
      const run = buildRun({start: 0, taskDuration: 1, heapSamples: [100, 100], networkRequests: 10, cpuActiveTime: 20});
      const withoutNetwork = (stepIds: string[]) => summarizeEntities(run.map(chunk => {
        const copy = structuredClone(chunk);
        for (const stepId of stepIds) {
          for (const metric of [...(copy.case?.[stepId]?.startMetrics ?? []), ...(copy.case?.[stepId]?.stopMetrics ?? [])]) {
            delete metric.metric.totalNetworkRequests;
          }
        }

        return copy;
      }))['case|open page|0'].metrics.totalNetworkRequests.value;

      // Step boundaries are interpolated between the test boundaries and the samples
      expect(withoutNetwork(['step'])).toBeGreaterThan(9.5);
      expect(withoutNetwork(['step'])).toBeLessThanOrEqual(10);
      // Without surrounding observations only the growth between the samples is known, nothing is extrapolated
      expect(withoutNetwork(['step', 'TEST_CASE_PARENT'])).toBeCloseTo(3.33, 1);
    });

    it('should tolerate counter resets', () => {
      const run = buildRun({start: 0, taskDuration: 1, heapSamples: [100, 100], networkRequests: 10, cpuActiveTime: 20});
      run.splice(-4, 0, {case: {step: performance('open page', {endMeasurement: 900, endMeasurementOffset: 1, samplingMetrics: [target({TaskDuration: 0.25})]})}} as ResultAccumulator);
      const entities = summarizeEntities(run);

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

      const history = await loadHistory(historyDir, ['JSHeapUsedSize', 'totalNetworkRequests'], ['object.json']);

      expect(history.runs.map(run => run.id)).toEqual(['a-valid', 'b-valid']);
      expect(history.excluded).toEqual([
        {file: 'missing.json', reason: 'Missing required metrics', missingMetrics: ['totalNetworkRequests']},
        expect.objectContaining({file: 'truncated.json'}),
      ]);
    });

    it('should return an empty history for a missing directory', async () => {
      expect(await loadHistory(path.join(historyDir, 'unknown'), [], [])).toEqual({runs: [], excluded: []});
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

    it('should remove the current run and reports on delete', async () => {
      const {presenter} = await runPresenter(buildRun(baselineInputs[0]));

      expect(await presenter.delete()).toBe(true);
      expect(fs.readdirSync(historyDir)).toEqual([]);
      expect(fs.readdirSync(outputDir)).toEqual([]);
    });

    it('should escape data embedded into the html', async () => {
      const run = buildRun(baselineInputs[0]);
      (run[0].case.TEST_CASE_PARENT as any).name = '</script><script>alert(1)</script>';
      const {html} = await runPresenter(run);

      expect(html).not.toContain('</script><script>alert(1)');
    });

    it('should classify small within-band changes as noisy', async () => {
      for (const [index, input] of baselineInputs.entries()) {
        writeHistory(`run-${index}.json`, buildRun(input));
      }

      // cpuProfileActiveTime = 21 (baseline median = 20, spread ≈ 1.48),
      // a 5% increase that sits inside the 3×MAD band and below the relative threshold
      const {report} = await runPresenter(buildRun({
        start: 10_000, taskDuration: 1, heapSamples: Array.from({length: 12}, () => 100), networkRequests: 10, cpuActiveTime: 21,
      }));
      const openPage = report.steps.find(step => step.key === 'case|open page|0')!;

      expect(openPage.status).toBe('noisy');
      expect(openPage.changes).toEqual([]);
    });
  });
});
