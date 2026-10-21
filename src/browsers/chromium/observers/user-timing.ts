import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';
import {
  assignConfig,
  globToRegExp,
} from '../../../helpers/index.js';

/**
 * Entry types of the User Timing and Element Timing APIs
 */
export type UserTimingEntryType = 'mark' | 'measure' | 'element';

/**
 * Options for the UserTimingObserver
 */
export type UserTimingObserverOptions = {
  /**
   * Glob pattern (`*` and `?`) of the entry names, for elements the `elementtiming` identifier. Defaults to `'*'`.
   */
  namePattern: string;

  /**
   * Entry types to collect. Defaults to all.
   */
  entryTypes: UserTimingEntryType[];

  /**
   * Prefix of the output keys. Defaults to `userTiming`.
   */
  prefix: string;

  /**
   * Maximum amount of names per type, to bound the output with dynamic names. Defaults to 50.
   */
  maxNames: number;
};

/**
 * Collects the marks, measures and element timings of the page since the latest start, e.g.
 * `performance.measure('editor-ready', ...)` or `<img elementtiming="hero">`.
 *
 * Output keys are `<prefix>:<type>:<name>`, the duration of a measure, the start time of a mark,
 * and the render time of an element, all in milliseconds. The latest entry of a name wins.
 */
export class UserTimingObserver implements ChromiumMetricObserver {
  public readonly name = 'userTiming';
  public readonly plugins = [];

  private readonly options: UserTimingObserverOptions = {
    namePattern: '*',
    entryTypes: ['mark', 'measure', 'element'],
    prefix: 'userTiming',
    maxNames: 50,
  };

  constructor(options?: Partial<UserTimingObserverOptions>) {
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
   * Evaluate the user timings in the page and write them into the accumulator
   */
  private async common(accumulator: Metric, client: CDP.Client, reset: boolean) {
    return new Promise(resolve => {
      client.send('Runtime.evaluate', {expression: this.getUserTimingExpression(reset), returnByValue: true}, (error, cdpResponse) => {
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
   * Installs a persistent PerformanceObserver and reads the collected entries.
   *
   * Note: Like the long tasks observer, it's installed without `buffered` on reset, and with `buffered`
   * when reading a new document. Entries that were not delivered yet are taken with `takeRecords()`.
   *
   * @param reset whether to clear the entries observed so far
   */
  private getUserTimingExpression(reset: boolean) {
    const settings = JSON.stringify({
      reset,
      pattern: globToRegExp(this.options.namePattern).source,
      entryTypes: this.options.entryTypes,
      prefix: this.options.prefix,
      maxNames: this.options.maxNames,
    });

    return `
  ((settings) => {
    const KEY = '__performanceReporterUserTiming';
    const buf = window[KEY] ?? {entries: []};
    window[KEY] = buf;

    if (!buf.installed) {
      buf.installed = true;
      buf.observers = [];
      buf.record = entries => {
        for (const entry of entries) {
          const name = entry.entryType === 'element' ? entry.identifier : entry.name;
          const value = entry.entryType === 'measure'
            ? entry.duration
            : (entry.entryType === 'element' ? (entry.renderTime || entry.loadTime) : entry.startTime);
          buf.entries.push({type: entry.entryType, name: name ?? '', value});
        }
      };

      // A type that is not supported throws, which must not prevent the other types
      for (const type of ['mark', 'measure', 'element']) {
        try {
          const observer = new PerformanceObserver(list => buf.record(list.getEntries()));
          observer.observe({type, buffered: !settings.reset});
          buf.observers.push(observer);
        } catch {}
      }
    }

    for (const observer of buf.observers) {
      try {
        buf.record(observer.takeRecords());
      } catch {}
    }

    if (settings.reset) buf.entries.length = 0;

    const pattern = new RegExp(settings.pattern, 's');
    const result = {};
    const names = {mark: new Set(), measure: new Set(), element: new Set()};
    const counts = {mark: 0, measure: 0, element: 0};
    let dropped = 0;
    for (const entry of buf.entries) {
      if (!settings.entryTypes.includes(entry.type) || !pattern.test(entry.name)) continue;

      counts[entry.type]++;
      const name = entry.name.replace(/[^\\w.:-]/g, '_');
      if (!names[entry.type].has(name) && names[entry.type].size >= settings.maxNames) {
        dropped++;
        continue;
      }

      names[entry.type].add(name);
      result[settings.prefix + ':' + entry.type + ':' + name] = entry.value;
    }

    return Object.assign(result, {
      [settings.prefix + 'MarkCount']: counts.mark,
      [settings.prefix + 'MeasureCount']: counts.measure,
      [settings.prefix + 'ElementCount']: counts.element,
      [settings.prefix + 'DroppedNames']: dropped,
    });
  })(${settings})
`;
  }
}
