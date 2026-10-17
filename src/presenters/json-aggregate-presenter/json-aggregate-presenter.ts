import path from 'node:path';
import fs from 'node:fs';
import {
  HookOrderToMeasurementOffsetOrder,
  HookOrderToMeasurementOrder,
  type PresenterWriter,
  type ResultAccumulator,
  type TestPerformance,
} from '../../types/index.js';
import {
  Logger,
} from '../../helpers/index.js';
import {
  type JsonAggregatePresenterOptions,
} from './types.js';

/**
 * Merge all JSON chunks into one object per test and step, written once on close
 */
export class JsonAggregatePresenter implements PresenterWriter {
  /**
   * Locator where to store the output
   */
  private readonly filePath: string;

  /**
   * Indent the output
   */
  private readonly pretty: boolean;

  /**
   * Merged chunks
   */
  private results: ResultAccumulator = {};

  /**
   * Status whether writer is usable
   */
  private isClosed = false;

  /**
   * Status whether the output was discarded
   */
  private isDeleted = false;

  /**
   * Status whether the file was created by this presenter
   */
  private isWritten = false;

  /**
   * Result of closing, to write the file only once
   */
  private closing: Promise<boolean> | undefined;

  constructor(options: JsonAggregatePresenterOptions) {
    this.filePath = path.join(options.outputDir, options.outputFile);
    this.pretty = options.pretty ?? false;
  }

  /**
   * Merge a serializable chunk into the aggregate.
   *
   * @param content
   */
  public async write(content: ResultAccumulator): Promise<boolean> {
    if (this.isClosed) {
      return false;
    }

    try {
      // Serialize now to reject content that cannot be written on close, the copy is detached from the caller
      const serialized = JSON.stringify(content);
      this.merge(JSON.parse(serialized) as ResultAccumulator);
      return true;
    } catch (error) {
      Logger.error(String(error));
      return false;
    }
  }

  /**
   * Write the aggregate to the file
   */
  public async close(): Promise<boolean> {
    this.isClosed = true;
    this.closing ??= this.flush();
    return this.closing;
  }

  /**
   * Discard the aggregate and delete the file if it was written
   */
  public async delete(): Promise<boolean> {
    this.isClosed = true;
    this.isDeleted = true;
    this.results = {};
    await this.closing;

    if (!this.isWritten) {
      return true;
    }

    try {
      fs.rmSync(this.filePath, {force: true, maxRetries: 5, retryDelay: 500});
      this.isWritten = false;
      return true;
    } catch (error) {
      Logger.error(String(error));
      return false;
    }
  }

  /**
   * Write the aggregate as a single JSON document
   */
  private async flush(): Promise<boolean> {
    if (this.isDeleted) {
      return true;
    }

    try {
      await fs.promises.writeFile(this.filePath, JSON.stringify(this.results, undefined, this.pretty ? 2 : undefined));
      this.isWritten = true;
      return true;
    } catch (error) {
      Logger.error(String(error));
      return false;
    }
  }

  /**
   * Chunks only contain the metrics of one event, so the metrics are appended in arrival order.
   * Measurements a chunk did not trigger default to its creation time without an offset, so the earliest
   * measured start and the latest measured end are kept, and placeholders only if nothing was measured.
   *
   * @param chunk partial results of one event
   */
  private merge(chunk: ResultAccumulator) {
    for (const [caseId, steps] of Object.entries(chunk)) {
      this.results[caseId] ??= {};

      for (const [stepId, performance] of Object.entries(steps ?? {})) {
        const target = this.results[caseId][stepId];
        if (!target) {
          this.results[caseId][stepId] = {
            ...performance,
            startMetrics: performance.startMetrics ?? [],
            stopMetrics: performance.stopMetrics ?? [],
            samplingMetrics: performance.samplingMetrics ?? [],
          };
          continue;
        }

        this.mergePerformance(target, performance);
      }
    }
  }

  /**
   * Merge a chunk of a test or step into the existing entry
   *
   * @param target merged entry
   * @param performance chunk of the same test or step
   */
  private mergePerformance(target: TestPerformance, performance: TestPerformance) {
    target.name ||= performance.name;
    target.startMetrics.push(...(performance.startMetrics ?? []));
    target.stopMetrics.push(...(performance.stopMetrics ?? []));
    target.samplingMetrics.push(...(performance.samplingMetrics ?? []));

    for (const hookOrder of ['onStart', 'onStop'] as const) {
      const measurement = HookOrderToMeasurementOrder[hookOrder];
      const offset = HookOrderToMeasurementOffsetOrder[hookOrder];
      const isMeasured = performance[offset] !== undefined;
      const isFurther = hookOrder === 'onStart'
        ? performance[measurement] < target[measurement]
        : performance[measurement] >= target[measurement];

      if ((isMeasured && target[offset] === undefined) || (isMeasured === (target[offset] !== undefined) && isFurther)) {
        target[measurement] = performance[measurement];
        target[offset] = performance[offset];
      }
    }
  }
}
