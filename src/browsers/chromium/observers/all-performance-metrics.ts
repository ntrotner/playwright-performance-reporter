import type CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol/types/protocol';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';
import {
  nativeChromiumPlugins,
} from '../plugins/index.js';

export class AllPerformanceMetrics implements ChromiumMetricObserver {
  public readonly name = 'allPerformanceMetrics';
  public readonly plugins = [
    nativeChromiumPlugins.performanceDomainPlugin,
  ];

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    await this.common(accumulator, developmentTools);
  }

  /**
   * @inheritdoc
   */
  async onSampling(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
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
          Object.fromEntries((cdpResponse as Protocol.Performance.GetMetricsResponse).metrics.map(metric => [metric.name, metric.value])),
        );
        resolve(true);
      });
    });
  }
}

