import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';

/**
 * Captures main-thread long tasks and computes the Total Blocking Time of a test or step.
 *
 * The page keeps a single buffer, which is reset on every `onStart`, so each measurement
 * only contains the long tasks since the latest start.
 */
export class LongTasksObserver implements ChromiumMetricObserver {
  public readonly name = 'longTasks';
  public readonly plugins = [];

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
   * Evaluate the long tasks in the page and write them into the accumulator
   */
  private async common(accumulator: Metric, client: CDP.Client, reset: boolean) {
    return new Promise(resolve => {
      client.send('Runtime.evaluate', {expression: this.getLongTasksExpression(reset), returnByValue: true}, (error, cdpResponse) => {
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
   * Installs a persistent PerformanceObserver and reads the aggregated long tasks.
   *
   * Note: The observer is installed without `buffered` on reset, so long tasks before the start
   * are excluded. If the document changed in between, e.g. by a navigation, it's installed on
   * read with `buffered: true` to include the long tasks of the new document.
   *
   * @param reset whether to clear the long tasks observed so far
   */
  private getLongTasksExpression(reset: boolean) {
    return `
  ((reset) => {
    const KEY = '__performanceReporterLongTasks';
    const buf = window[KEY] ?? {durations: []};
    window[KEY] = buf;

    if (!buf.installed) {
      buf.installed = true;
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) buf.durations.push(entry.duration);
        }).observe({type: 'longtask', buffered: !reset});
      } catch {}
    }

    if (reset) buf.durations.length = 0;

    return {
      longTaskCount: buf.durations.length,
      totalLongTasksDuration: buf.durations.reduce((total, duration) => total + duration, 0),
      totalBlockingTime: buf.durations.reduce((total, duration) => total + Math.max(0, duration - 50), 0),
      maxLongTaskDuration: buf.durations.length > 0 ? Math.max(...buf.durations) : 0,
    };
  })(${reset})
`;
  }
}
