import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type Metric,
  type MetricObserver,
} from '../../../types/index.js';

export class TotalJsHeapSize implements MetricObserver {
  public readonly name = 'totalJsHeapSize';
  public readonly chromiumCompatibleName = 'JSHeapTotalSize';

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools);
  }

  /**
   * @inheritdoc
   */
  async onStop(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools);
  }

  /**
   * Common function for onStart and onStop hook
   */
  private async common(accumulator: Metric, client: CDP.Client) {
    return new Promise(resolve => {
      client.send('Performance.getMetrics', (error, cdpResponse) => {
        if (!cdpResponse || Boolean(error)) {
          resolve(false);
          return;
        }

        const foundMetric = (cdpResponse as Protocol.Performance.GetMetricsResponse).metrics.find(metricResponse => metricResponse.name === this.chromiumCompatibleName);
        if (!foundMetric) {
          resolve(false);
          return;
        }

        Object.assign(accumulator, {[this.name]: foundMetric.value});
        resolve(true);
      });
    });
  }
}
