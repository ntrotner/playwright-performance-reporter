import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  nativePresenters,
} from '../../src/presenters/index.js';
import {
  type PresenterWriter,
  type ResultAccumulator,
  type TargetMetric,
  type TestPerformance,
} from '../../src/index.js';

const observation = (value: number): TargetMetric => ({id: 'page', metric: {usedHeap: value}});

/**
 * Chunk like the reporter writes it: a fresh entry that only contains the data of one event
 */
const chunk = (caseId: string, stepId: string, performance: Partial<TestPerformance>): ResultAccumulator => ({
  [caseId]: {
    [stepId]: {
      name: stepId,
      startMetrics: [],
      stopMetrics: [],
      samplingMetrics: [],
      startMeasurement: 0,
      endMeasurement: 0,
      ...performance,
    },
  },
});

describe('Json aggregate presenter', () => {
  let outputDir: string;
  let outputFile: string;
  let presenter: PresenterWriter;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-aggregate-presenter-'));
    outputFile = path.join(outputDir, 'aggregate.json');
    presenter = new nativePresenters.jsonAggregatePresenter({outputDir, outputFile: 'aggregate.json'});
  });

  afterEach(() => {
    fs.rmSync(outputDir, {recursive: true, force: true});
  });

  const writeAll = async (chunks: ResultAccumulator[]) => {
    for (const content of chunks) {
      // eslint-disable-next-line no-await-in-loop
      expect(await presenter.write(content)).toBe(true);
    }

    expect(await presenter.close()).toBe(true);
    return JSON.parse(fs.readFileSync(outputFile, 'utf8')) as ResultAccumulator;
  };

  it('should merge start, sampling and stop chunks of the same step in arrival order', async () => {
    const result = await writeAll([
      // Measurements not triggered by an event default to the creation time of the chunk
      chunk('case', 'step', {
        startMetrics: [observation(1)],
        startMeasurement: 1000,
        startMeasurementOffset: 5,
        endMeasurement: 1001,
      }),
      chunk('case', 'step', {
        samplingMetrics: [observation(2)],
        startMeasurement: 1002,
        endMeasurement: 2000,
        endMeasurementOffset: 3,
      }),
      chunk('case', 'step', {
        samplingMetrics: [observation(3)],
        startMeasurement: 2002,
        endMeasurement: 3000,
        endMeasurementOffset: 4,
      }),
      chunk('case', 'step', {
        stopMetrics: [observation(4)],
        startMeasurement: 3500,
        endMeasurement: 4000,
        endMeasurementOffset: 7,
      }),
    ]);

    expect(result).toEqual({
      case: {
        step: {
          name: 'step',
          startMetrics: [observation(1)],
          stopMetrics: [observation(4)],
          samplingMetrics: [observation(2), observation(3)],
          startMeasurement: 1000,
          startMeasurementOffset: 5,
          endMeasurement: 4000,
          endMeasurementOffset: 7,
        },
      },
    });
  });

  it('should prefer measured start and end over placeholders of other chunks', async () => {
    const result = await writeAll([
      // Sampling of the parent test assigned to the step while its start metrics are still collected
      chunk('case', 'step', {
        samplingMetrics: [observation(1)],
        startMeasurement: 900,
        endMeasurement: 900,
        endMeasurementOffset: 2,
      }),
      chunk('case', 'step', {
        startMetrics: [observation(2)],
        startMeasurement: 1000,
        startMeasurementOffset: 100,
        endMeasurement: 900,
      }),
      chunk('case', 'step', {
        stopMetrics: [observation(3)],
        startMeasurement: 1500,
        endMeasurement: 2000,
        endMeasurementOffset: 7,
      }),
      // Stray entry without measurements, like the sampling owner of a tick assigned to another step
      chunk('case', 'step', {startMeasurement: 2500, endMeasurement: 2500}),
    ]);

    expect(result.case.step).toMatchObject({
      startMeasurement: 1000,
      startMeasurementOffset: 100,
      endMeasurement: 2000,
      endMeasurementOffset: 7,
    });
    expect(result.case.step.samplingMetrics).toEqual([observation(1)]);
  });

  it('should keep multiple cases and steps apart', async () => {
    const result = await writeAll([
      chunk('case-a', 'TEST_CASE_PARENT', {name: 'Test A', startMetrics: [observation(1)]}),
      chunk('case-a', 'open', {startMetrics: [observation(2)]}),
      chunk('case-a', 'open', {stopMetrics: [observation(3)]}),
      chunk('case-a', 'TEST_CASE_PARENT', {name: 'Test A', stopMetrics: [observation(4)]}),
      chunk('case-b', 'TEST_CASE_PARENT', {name: 'Test B', startMetrics: [observation(5)]}),
      chunk('case-b', 'TEST_CASE_PARENT', {name: 'Test B', stopMetrics: [observation(6)]}),
    ]);

    expect(Object.keys(result)).toEqual(['case-a', 'case-b']);
    expect(Object.keys(result['case-a'])).toEqual(['TEST_CASE_PARENT', 'open']);
    expect(result['case-a'].TEST_CASE_PARENT.name).toBe('Test A');
    expect(result['case-a'].TEST_CASE_PARENT.startMetrics).toEqual([observation(1)]);
    expect(result['case-a'].TEST_CASE_PARENT.stopMetrics).toEqual([observation(4)]);
    expect(result['case-a'].open.startMetrics).toEqual([observation(2)]);
    expect(result['case-a'].open.stopMetrics).toEqual([observation(3)]);
    expect(result['case-b'].TEST_CASE_PARENT.name).toBe('Test B');
    expect(result['case-b'].TEST_CASE_PARENT.startMetrics).toEqual([observation(5)]);
    expect(result['case-b'].TEST_CASE_PARENT.stopMetrics).toEqual([observation(6)]);
  });

  it('should not be affected by changes to written content', async () => {
    const content = chunk('case', 'step', {startMetrics: [observation(1)]});
    await presenter.write(content);
    content.case.step.startMetrics.push(observation(2));
    await presenter.write(chunk('case', 'step', {stopMetrics: [observation(3)]}));
    await presenter.close();

    const result = JSON.parse(fs.readFileSync(outputFile, 'utf8')) as ResultAccumulator;
    expect(result.case.step.startMetrics).toEqual([observation(1)]);
    expect(result.case.step.stopMetrics).toEqual([observation(3)]);
  });

  it('should write a single JSON object only on close', async () => {
    await presenter.write(chunk('case', 'step', {startMetrics: [observation(1)]}));
    expect(fs.existsSync(outputFile)).toBe(false);

    await presenter.close();
    const result: unknown = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    expect(typeof result).toBe('object');
    expect(Array.isArray(result)).toBe(false);
  });

  it('should reject writes after close', async () => {
    await presenter.close();

    expect(await presenter.write(chunk('case', 'step', {}))).toBe(false);
  });

  it('should fail when object is not serializable', async () => {
    expect(await presenter.write({key: 2n} as unknown as ResultAccumulator)).toBe(false);
    expect(await presenter.write(chunk('case', 'step', {startMetrics: [observation(1)]}))).toBe(true);
    await presenter.close();

    expect(Object.keys(JSON.parse(fs.readFileSync(outputFile, 'utf8')) as ResultAccumulator)).toEqual(['case']);
  });

  it('should delete file after close', async () => {
    await presenter.write(chunk('case', 'step', {}));
    await presenter.close();
    expect(fs.existsSync(outputFile)).toBe(true);

    expect(await presenter.delete()).toBe(true);
    expect(fs.existsSync(outputFile)).toBe(false);
  });

  it('should not create file when deleted before close', async () => {
    await presenter.write(chunk('case', 'step', {}));

    expect(await presenter.delete()).toBe(true);
    expect(await presenter.write(chunk('case', 'step', {}))).toBe(false);
    expect(await presenter.close()).toBe(true);
    expect(fs.existsSync(outputFile)).toBe(false);
  });
});
