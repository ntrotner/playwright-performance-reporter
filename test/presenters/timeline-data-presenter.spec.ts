import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativePresenters} from '../../src/presenters';
import {type ResultAccumulator, type TargetMetric} from '../../src';

const observation = (metricValue: number): TargetMetric => ({id: 'page', metric: {JSHeapUsedSize: metricValue}});

/**
 * Chunk of one execution of a test, keyed by its own case id like a repeated test.
 * `endMeasurement` is the absolute wall clock time.
 */
const execution = (caseId: string, name: string, endMeasurements: Record<string, number>): ResultAccumulator => ({
  [caseId]: Object.fromEntries(Object.entries(endMeasurements).map(([stepId, endMeasurement]) => [stepId, {
    name: stepId === 'TEST_CASE_PARENT' ? name : stepId,
    startMetrics: [observation(1)],
    stopMetrics: [],
    samplingMetrics: [],
    startMeasurement: endMeasurement,
    endMeasurement,
  }])),
});

describe('Timeline data presenter', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-data-presenter-'));
  });

  afterEach(() => {
    fs.rmSync(outputDir, {recursive: true, force: true});
  });

  const generate = async (chunks: ResultAccumulator[]) => {
    const presenter = new nativePresenters.timelineDataPresenter({outputDir, outputFile: 'timeline.json'});
    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      await presenter.write(chunk);
    }

    await presenter.close();
    return JSON.parse(fs.readFileSync(path.join(outputDir, 'timeline.json'), 'utf8')) as Array<{name: string; execution: string; timestamp: number}>;
  };

  it('should reset the timeline to zero for every execution of a test', async () => {
    // Same test name, but two executions with their own case id, like a repeat would produce
    const timeline = await generate([
      execution('case-a', 'Example test', {TEST_CASE_PARENT: 5000, open: 2000, close: 4000}),
      execution('case-b', 'Example test', {TEST_CASE_PARENT: 104_000, open: 101_000}),
    ]);

    const byExecution = new Map<string, number[]>();
    for (const point of timeline) {
      expect(point.name).toBe('Example test');
      byExecution.set(point.execution, [...(byExecution.get(point.execution) ?? []), point.timestamp]);
    }

    expect(byExecution.size).toBe(2);
    // Each execution starts at zero and only spans its own duration, not the offset from the first one
    for (const timestamps of byExecution.values()) {
      expect(Math.min(...timestamps)).toBe(0);
      expect(Math.max(...timestamps)).toBeLessThanOrEqual(5000);
    }
  });
});
