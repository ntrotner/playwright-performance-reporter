import path from 'node:path';
import fs from 'node:fs';
import {
  type PresenterWriter,
  type ResultAccumulator,
  type TestPerformance,
} from '../../types/index.js';
import {
  Logger,
} from '../../helpers/index.js';
import {
  type TimelineDataPoint,
  type ChartPresenterOptions,
} from './types.js';

/**
 * Base presenter that collects timeline data points and writes to file
 */
export class TimelineDataPresenter implements PresenterWriter {
  /**
   * Status whether writer is usable
   */
  protected isClosed = false;

  /**
   * Timeline data collected from writes
   */
  protected timelineData: TimelineDataPoint[] = [];

  /**
   * Locator where to store the output
   */
  private readonly filePath: string | undefined;

  /**
   * File writer
   */
  private readonly fileStream: fs.WriteStream | undefined;

  /**
   * Maps unique test ids to the computed name
   */
  private readonly testIdToParentNameMap = new Map<string, string>();

  /**
   * Initialize writer
   *
   * @param options defines target output
   */
  constructor(options: ChartPresenterOptions) {
    this.filePath = path.join(options.outputDir, options.outputFile);
    this.fileStream = fs.createWriteStream(this.filePath, {flags: 'w'});
  }

  /**
   * Finish data collection and generate output
   */
  async close(): Promise<boolean> {
    this.isClosed = true;

    if (!this.fileStream || !this.filePath) {
      return false;
    }

    try {
      const content = this.generate();
      this.fileStream.write(content);
      this.fileStream.end();

      return await new Promise(resolve => {
        this.fileStream?.once('finish', () => {
          resolve(true);
        });
      });
    } catch (error) {
      Logger.error(String(error));
      return false;
    }
  }

  /**
   * Delete created file
   */
  async delete(): Promise<boolean> {
    const closeResult = await this.close();
    if (!closeResult) {
      return false;
    }

    if (this.filePath) {
      fs.rmSync(this.filePath, {maxRetries: 5, retryDelay: 500});
      return true;
    }

    return false;
  }

  /**
   * Create new entry by filtering numeric data for the timeline.
   *
   * @param content The result accumulator containing test performance data
   */
  async write(content: ResultAccumulator): Promise<boolean> {
    if (this.isClosed) {
      return false;
    }

    try {
      for (const [caseId, steps] of Object.entries(content)) {
        for (const [stepId, testPerformance] of Object.entries(steps)) {
          if (stepId === 'TEST_CASE_PARENT') {
            this.testIdToParentNameMap.set(caseId, testPerformance.name);
          }

          const datapoint = this.extractDatapoint(caseId, testPerformance);
          if (datapoint) {
            this.timelineData.push(datapoint);
          }
        }
      }

      return true;
    } catch (error) {
      Logger.error(`Failed to parse timeline data: ${String(error)}`);
      return false;
    }
  }

  /**
   * Extract a TimelineDataPoint from TestPerformance data
   *
   * @param caseId The case identifier
   * @param testPerformance The test performance data
   * @returns TimelineDataPoint or undefined if no numeric data found
   */
  protected extractDatapoint(
    caseId: string,
    testPerformance: TestPerformance,
  ): TimelineDataPoint | undefined {
    const labels: string[] = [];
    const values: number[] = [];

    const metricSources = [
      testPerformance.startMetrics,
      testPerformance.stopMetrics,
      testPerformance.samplingMetrics,
    ];

    for (const metrics of metricSources) {
      if (!Array.isArray(metrics)) {
        continue;
      }

      for (const item of metrics) {
        if (!item?.metric) {
          continue;
        }

        for (const [metricName, metricValue] of Object.entries(item.metric)) {
          if (typeof metricValue === 'number' && !Number.isNaN(metricValue)) {
            labels.push(metricName);
            values.push(metricValue);
          }
        }
      }
    }

    if (labels.length === 0) {
      return undefined;
    }

    return {
      labels,
      name: this.testIdToParentNameMap.get(caseId) ?? caseId,
      timestamp: testPerformance.endMeasurement,
      values,
    };
  }

  /**
   * Generate output from collected timeline data
   */
  protected generate(): string {
    return JSON.stringify(this.timelineData, null, 2);
  }
}
