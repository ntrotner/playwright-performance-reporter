import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type Metric,
  type MetricObserver,
} from '../../../types/index.js';

export class AllPerformanceMetrics implements MetricObserver {
  public readonly name = 'allPerformanceMetrics';

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

        if ((cdpResponse as Protocol.Performance.GetMetricsResponse).metrics.length === 0) {
          resolve(false);
          return;
        }

        Object.assign(
          accumulator,
          Object.fromEntries(
            (cdpResponse as Protocol.Performance.GetMetricsResponse).metrics.map(
              metric => [metric.name, metric.value],
            ),
          ),
        );
        resolve(true);
      });
    });
  }
}

