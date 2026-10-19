import {
  Buffer,
} from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type ChromiumMetricObserver,
  type Metric,
  type ObserverOptions,
} from '../../../types/index.js';
import {
  nativeChromiumPlugins,
} from '../plugins/index.js';
import {
  assignConfig,
  enhanceGarbageCollectionPlugin,
} from '../../../helpers/index.js';

/**
 * Trace categories of the DevTools Performance panel, as used by Puppeteer's `page.tracing`
 */
export const defaultTraceCategories = [
  '-*',
  'devtools.timeline',
  'v8.execute',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'toplevel',
  'blink.console',
  'blink.user_timing',
  'latencyInfo',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler',
];

/**
 * Category of the screenshot events, which are needed for a filmstrip
 */
export const screenshotTraceCategory = 'disabled-by-default-devtools.screenshot';

/**
 * Milliseconds to wait for Chrome to collect the trace after it was ended, e.g. if the target closed
 */
const tracingCompleteTimeoutInMilliseconds = 30_000;

/**
 * Options for the TraceCaptureObserver
 */
export type TraceCaptureObserverOptions = ObserverOptions & {
  /**
   * Folder for the trace files. Created if missing.
   */
  outputDir: string;

  /**
   * Prefix of the trace file names. Defaults to `trace`.
   */
  filePrefix: string;

  /**
   * Chrome trace categories. Defaults to the categories of the DevTools Performance panel.
   */
  categories: string[];

  /**
   * Include screenshot events, e.g. for a filmstrip. Defaults to false.
   */
  screenshots: boolean;

  /**
   * Gzip the trace file. Defaults to true.
   */
  compress: boolean;

  /**
   * Milliseconds a start waits for the stop of the previous trace on the same target. Defaults to 5000.
   * Playwright doesn't await the reporter, so the next step can start while the previous one still stops.
   */
  startTimeoutInMilliseconds: number;
};

/**
 * Trace of a target that has not ended yet
 */
type RunningTrace = {
  /**
   * Resolves once Chrome stopped tracing, so a new trace can be started on the target
   */
  ended: Promise<void>;
  markEnded: () => void;
};

/**
 * Summary of a written trace
 */
export type TraceCaptureResult = {
  /**
   * Path of the trace file
   */
  traceFile: string;
  traceSizeBytes: number;

  /**
   * 1 if Chrome reported that the trace buffer overflowed and events were dropped
   */
  traceDataLoss: number;
};

/**
 * Records a Chrome trace between start and stop and writes it into a file,
 * which can be loaded in the DevTools Performance panel.
 */
export class TraceCaptureObserver implements ChromiumMetricObserver {
  public readonly name = 'traceCapture';
  public readonly plugins = [];

  private readonly options: TraceCaptureObserverOptions = {
    triggerGarbageCollectionOnObserve: false,
    outputDir: './traces',
    filePrefix: 'trace',
    categories: defaultTraceCategories,
    screenshots: false,
    compress: true,
    startTimeoutInMilliseconds: 5000,
  };

  /**
   * Traces that have not ended yet. Tracing is started per target, so the state is kept per client.
   */
  private readonly runningTraces = new WeakMap<CDP.Client, RunningTrace>();

  /**
   * Counter to keep file names unique within the same millisecond
   */
  private fileCounter = 0;

  constructor(options?: Partial<TraceCaptureObserverOptions>) {
    assignConfig(this.options, options);
    enhanceGarbageCollectionPlugin(nativeChromiumPlugins.heapGarbageCollectorPlugin, this, this.options);
  }

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.waitForPreviousTrace(developmentTools);
    if (this.runningTraces.has(developmentTools)) {
      throw new Error('TraceCaptureObserver.onStart command failed: Trace already running');
    }

    let markEnded = () => {};
    const ended = new Promise<void>(resolve => {
      markEnded = resolve;
    });
    const runningTrace: RunningTrace = {ended, markEnded};
    this.runningTraces.set(developmentTools, runningTrace);
    try {
      await developmentTools.Tracing.start({
        traceConfig: {includedCategories: this.getCategories()},
        transferMode: 'ReturnAsStream',
        streamFormat: 'json',
        streamCompression: this.options.compress ? 'gzip' : 'none',
      });
    } catch (error: unknown) {
      this.releaseTrace(developmentTools, runningTrace);
      throw new Error(`TraceCaptureObserver.onStart command failed: ${String(error)}`);
    }
  }

  /**
   * @inheritdoc
   */
  async onSampling(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {}

  /**
   * @inheritdoc
   */
  async onStop(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    const runningTrace = this.runningTraces.get(developmentTools);
    if (!runningTrace) {
      return;
    }

    try {
      const tracingComplete = this.waitForTracingComplete(developmentTools);
      await developmentTools.Tracing.end();
      const {stream, dataLossOccurred} = await tracingComplete;
      // Chrome stopped tracing, so the next trace can start while this one is written
      this.releaseTrace(developmentTools, runningTrace);
      if (!stream) {
        throw new Error('No trace stream returned');
      }

      const traceFile = this.buildFilePath();
      const traceSizeBytes = await this.writeStream(developmentTools, stream, traceFile);
      const result: TraceCaptureResult = {
        traceFile,
        traceSizeBytes,
        traceDataLoss: dataLossOccurred ? 1 : 0,
      };
      Object.assign(accumulator, result);
    } catch (error: unknown) {
      throw new Error(`TraceCaptureObserver.onStop command failed: ${String(error)}`);
    } finally {
      this.releaseTrace(developmentTools, runningTrace);
    }
  }

  /**
   * Wait until a trace on the target, which is still stopping, has ended
   *
   * @param client CDP client of the target
   */
  private async waitForPreviousTrace(client: CDP.Client): Promise<void> {
    const runningTrace = this.runningTraces.get(client);
    if (!runningTrace) {
      return;
    }

    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      runningTrace.ended,
      new Promise<void>(resolve => {
        timeout = setTimeout(resolve, this.options.startTimeoutInMilliseconds);
      }),
    ]);
    clearTimeout(timeout);
  }

  /**
   * Allow a new trace on the target
   *
   * @param client CDP client of the target
   * @param runningTrace trace that ended
   */
  private releaseTrace(client: CDP.Client, runningTrace: RunningTrace): void {
    if (this.runningTraces.get(client) === runningTrace) {
      this.runningTraces.delete(client);
    }

    runningTrace.markEnded();
  }

  /**
   * Categories to record, including screenshots if requested
   */
  private getCategories(): string[] {
    const categories = [...this.options.categories];
    if (this.options.screenshots && !categories.includes(screenshotTraceCategory)) {
      categories.push(screenshotTraceCategory);
    }

    return categories;
  }

  /**
   * Resolve once Chrome has collected the trace and provides the stream handle
   *
   * @param client CDP client of the target
   */
  private async waitForTracingComplete(client: CDP.Client): Promise<Protocol.Tracing.TracingCompleteEvent> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('Trace was not completed in time'));
      }, tracingCompleteTimeoutInMilliseconds);
      const unsubscribe = client.Tracing.tracingComplete(event => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(event);
      });
    });
  }

  /**
   * Unique path of the next trace file
   */
  private buildFilePath(): string {
    this.fileCounter++;
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    const extension = this.options.compress ? 'json.gz' : 'json';
    return path.join(this.options.outputDir, `${this.options.filePrefix}-${timestamp}-${this.fileCounter}.${extension}`);
  }

  /**
   * Drain the trace stream into a file
   *
   * @param client CDP client of the target
   * @param handle stream handle of the trace
   * @param filePath target file
   * @returns amount of written bytes
   */
  private async writeStream(client: CDP.Client, handle: string, filePath: string): Promise<number> {
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    const fileStream = fs.createWriteStream(filePath, {flags: 'w'});
    let size = 0;

    try {
      let eof = false;
      while (!eof) {
        // Chunks have to be read in order
        // eslint-disable-next-line no-await-in-loop
        const chunk = await client.IO.read({handle});
        const data = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
        size += data.length;
        if (!fileStream.write(data)) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise<void>(resolve => {
            fileStream.once('drain', () => {
              resolve();
            });
          });
        }

        eof = chunk.eof;
      }
    } finally {
      await new Promise<void>(resolve => {
        fileStream.end(() => {
          resolve();
        });
      });

      try {
        await client.IO.close({handle});
      } catch {}
    }

    return size;
  }
}
