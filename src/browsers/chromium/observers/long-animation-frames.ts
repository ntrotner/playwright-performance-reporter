import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';
import {
  assignConfig,
} from '../../../helpers/index.js';

/**
 * Options for the LongAnimationFramesObserver
 */
export type LongAnimationFramesObserverOptions = {
  /**
   * Amount of scripts in `loafTopScripts`, ranked by their duration. Defaults to 5.
   */
  topScripts: number;

  /**
   * Include every frame in `loafFrames`. Defaults to false, as the list can be long.
   */
  includeFrames: boolean;
};

/**
 * Script that ran in long animation frames, aggregated by its source and function
 */
export type LongAnimationFrameScript = {
  sourceURL: string;
  sourceFunctionName: string;

  /**
   * What called the script, e.g. `BUTTON#buy.onclick` or `Window.requestAnimationFrame`
   */
  invoker: string;

  /**
   * E.g. `event-listener`, `user-callback`, `classic-script`
   */
  invokerType: string;

  /**
   * Milliseconds the script ran across all long animation frames
   */
  duration: number;

  /**
   * Milliseconds the script spent in forced style and layout
   */
  forcedStyleAndLayoutDuration: number;

  /**
   * Amount of long animation frames the script ran in
   */
  count: number;
};

/**
 * Captures long animation frames (LoAF, frames longer than 50 ms) and the scripts that caused them.
 *
 * The page keeps a single buffer, which is reset on every `onStart`, so each measurement
 * only contains the frames since the latest start.
 */
export class LongAnimationFramesObserver implements ChromiumMetricObserver {
  public readonly name = 'longAnimationFrames';
  public readonly plugins = [];

  private readonly options: LongAnimationFramesObserverOptions = {
    topScripts: 5,
    includeFrames: false,
  };

  constructor(options?: Partial<LongAnimationFramesObserverOptions>) {
    assignConfig(this.options, options);
  }

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools, true);
  }

  /**
   * @inheritdoc
   */
  async onSampling(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools, false);
  }

  /**
   * @inheritdoc
   */
  async onStop(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools, false);
  }

  /**
   * Evaluate the long animation frames in the page and write them into the accumulator
   */
  private async common(accumulator: Metric, client: CDP.Client, reset: boolean) {
    return new Promise(resolve => {
      client.send('Runtime.evaluate', {expression: this.getLongAnimationFramesExpression(reset), returnByValue: true}, (error, cdpResponse) => {
        const response = cdpResponse as Protocol.Runtime.EvaluateResponse | undefined;
        const value = response?.result.value as unknown;
        if (error || response?.exceptionDetails !== undefined || typeof value !== 'object' || value === null) {
          resolve(false);
          return;
        }

        Object.assign(accumulator, value);
        resolve(true);
      });
    });
  }

  /**
   * Installs a persistent PerformanceObserver and reads the aggregated long animation frames.
   *
   * Note: Like the long tasks observer, it's installed without `buffered` on reset, and with `buffered`
   * when reading a new document. Frames that were not delivered to the callback yet are taken with
   * `takeRecords()`. Lists are returned as JSON strings, as metrics only hold strings and numbers.
   *
   * @param reset whether to clear the frames observed so far
   */
  private getLongAnimationFramesExpression(reset: boolean) {
    return `
  ((reset, topScripts, includeFrames) => {
    const KEY = '__performanceReporterLongAnimationFrames';
    const supported = typeof PerformanceObserver !== 'undefined'
      && (PerformanceObserver.supportedEntryTypes ?? []).includes('long-animation-frame');
    const buf = window[KEY] ?? {frames: []};
    window[KEY] = buf;

    if (supported && !buf.installed) {
      buf.installed = true;
      buf.record = entries => {
        for (const entry of entries) {
          buf.frames.push({
            startTime: entry.startTime,
            duration: entry.duration,
            blockingDuration: entry.blockingDuration ?? 0,
            scripts: (entry.scripts ?? []).map(script => ({
              sourceURL: script.sourceURL ?? '',
              sourceFunctionName: script.sourceFunctionName ?? '',
              invoker: script.invoker ?? '',
              invokerType: script.invokerType ?? '',
              duration: script.duration ?? 0,
              forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration ?? 0,
            })),
          });
        }
      };
      try {
        buf.observer = new PerformanceObserver(list => buf.record(list.getEntries()));
        buf.observer.observe({type: 'long-animation-frame', buffered: !reset});
      } catch {}
    }

    try {
      buf.record(buf.observer.takeRecords());
    } catch {}

    if (reset) buf.frames.length = 0;

    const scripts = new Map();
    for (const frame of buf.frames) {
      for (const script of frame.scripts) {
        const key = script.sourceURL + '|' + script.sourceFunctionName + '|' + script.invoker;
        const aggregate = scripts.get(key) ?? {...script, duration: 0, forcedStyleAndLayoutDuration: 0, count: 0};
        aggregate.duration += script.duration;
        aggregate.forcedStyleAndLayoutDuration += script.forcedStyleAndLayoutDuration;
        aggregate.count += 1;
        scripts.set(key, aggregate);
      }
    }

    const sum = values => values.reduce((total, value) => total + value, 0);
    const result = {
      loafSupported: supported ? 1 : 0,
      loafCount: buf.frames.length,
      totalLoafDuration: sum(buf.frames.map(frame => frame.duration)),
      totalLoafBlockingDuration: sum(buf.frames.map(frame => frame.blockingDuration)),
      maxLoafDuration: buf.frames.length > 0 ? Math.max(...buf.frames.map(frame => frame.duration)) : 0,
      totalForcedStyleAndLayoutDuration: sum([...scripts.values()].map(script => script.forcedStyleAndLayoutDuration)),
      loafTopScripts: JSON.stringify([...scripts.values()].sort((a, b) => b.duration - a.duration).slice(0, topScripts)),
    };

    if (includeFrames) result.loafFrames = JSON.stringify(buf.frames);

    return result;
  })(${String(reset)}, ${this.options.topScripts}, ${String(this.options.includeFrames)})
`;
  }
}
