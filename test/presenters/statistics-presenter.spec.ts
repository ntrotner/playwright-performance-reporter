import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  nativePresenters,
  type ResultAccumulator,
} from '../../src/index.js';
import {
  type StatisticsReport,
} from '../../src/presenters/statistics-presenter/index.js';

/**
 * Chunks of one execution of a test with two steps of the same name and one other step
 */
const execution = (caseId: string, repeatEachIndex: number, retry: number, lcp: number) => [
  {[caseId]: {TEST_CASE_PARENT: {
    name: 'Profile', startMetrics: [], stopMetrics: [], samplingMetrics: [], startMeasurement: 0, endMeasurement: 0, execution: {repeatEachIndex, retry},
  }}},
  ...['open', 'open', 'close'].map((step, index) => ({[caseId]: {[`${step}-${index}`]: {
    name: step,
    startMetrics: [],
    stopMetrics: [{type: 'worker', metric: {largestContentfulPaint: 1}}, {type: 'page', metric: {largestContentfulPaint: lcp + index, title: 'text'}}],
    samplingMetrics: [],
    startMeasurement: index * 100,
    endMeasurement: (index * 100) + lcp,
  }}})),
  {[caseId]: {TEST_CASE_PARENT: {
    name: 'Profile', startMetrics: [], stopMetrics: [], samplingMetrics: [], startMeasurement: 0, endMeasurement: 1000,
  }}},
] as unknown as ResultAccumulator[];

describe('Statistics presenter', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statistics-presenter-'));
  });

  afterEach(() => {
    fs.rmSync(outputDir, {recursive: true, force: true});
  });

  const generate = async (chunks: ResultAccumulator[], options = {}) => {
    const presenter = new nativePresenters.statisticsPresenter({outputDir, outputFile: 'statistics.json', ...options});
    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      await presenter.write(chunk);
    }

    expect(await presenter.close()).toBe(true);
    return {presenter, report: JSON.parse(fs.readFileSync(path.join(outputDir, 'statistics.json'), 'utf8')) as StatisticsReport};
  };

  it('should compute statistics across the repeats of a test, without retries', async () => {
    const {report} = await generate([
      ...execution('repeat-0', 0, 0, 100),
      ...execution('repeat-1', 1, 0, 200),
      ...execution('repeat-2', 2, 0, 600),
      ...execution('repeat-2', 2, 1, 5000),
      ...execution('retry', 3, 1, 9000),
    ]);

    expect(report.percentiles).toEqual([0.5, 0.75, 0.95]);
    expect(report.tests).toHaveLength(1);
    const [test] = report.tests;
    expect(test.name).toBe('Profile');
    expect(test.executions).toBe(3);
    expect(test.test.metrics.entityDuration).toEqual(expect.objectContaining({count: 3, min: 1000, max: 1000}));
    expect(test.steps.map(step => [step.name, step.occurrence, step.executions])).toEqual([['open', 0, 3], ['open', 1, 3], ['close', 0, 3]]);
    // Page values are preferred and string metrics are left out
    // The retry of repeat-2 is a separate execution, which is left out
    expect(test.steps[0].metrics.largestContentfulPaint).toEqual({
      count: 3, min: 100, max: 600, mean: 300, mad: expect.any(Number) as number, p50: 200, p75: 400, p95: 560,
    });
    expect(test.steps[0].metrics).not.toHaveProperty('title');
  });

  it('should include retries and custom percentiles on request', async () => {
    const {report} = await generate([...execution('a', 0, 0, 100), ...execution('b', 0, 1, 300)], {includeRetries: true, percentiles: [0.9], pretty: true});

    expect(report.tests[0].executions).toBe(2);
    expect(report.tests[0].steps[2].metrics.largestContentfulPaint).toEqual(expect.objectContaining({count: 2, p90: 282}));
    expect(fs.readFileSync(path.join(outputDir, 'statistics.json'), 'utf8')).toContain('\n  "schemaVersion": 1');
  });

  it('should throw on invalid percentiles and delete its output', async () => {
    expect(() => new nativePresenters.statisticsPresenter({outputDir, outputFile: 'statistics.json', percentiles: [1.5]})).toThrow('Invalid percentile');

    const {presenter} = await generate(execution('a', 0, 0, 100));
    await presenter.delete();
    expect(fs.existsSync(path.join(outputDir, 'statistics.json'))).toBe(false);
  });

  it('should report a failure to write', async () => {
    const presenter = new nativePresenters.statisticsPresenter({outputDir: path.join(outputDir, 'missing'), outputFile: 'statistics.json'});

    expect(await presenter.close()).toBe(false);
  });
});
