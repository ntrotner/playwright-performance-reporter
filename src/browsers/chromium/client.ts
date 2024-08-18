import CDP from 'chrome-remote-interface';
import {type BrowserClient} from '../client.js';
import {
  type Metrics,
  type Metric,
  type SupportedBrowsers,
  type ChromiumSupportedMetrics,
  type MetricObserver,
  type HookOrder,
  type OnStartMeasure,
  type OnStopMeasure,
} from '../../types/index.js';
import {
  TotalJsHeapSize,
  UsedJsHeapSize,
} from './observers/index.js';

export class ChromiumDevelopmentTools implements BrowserClient {
  /**
   * Chrome dev tools protocol client
   */
  private client: CDP.Client | undefined;

  /**
   * Indicates if `Performance` domain is active
   */
  private isPerformanceActive = false;

  /**
   * @inheritdoc
   */
  constructor(private readonly options: Record<string, any>) {}

  /**
   * @inheritdoc
   */
  public async connect() {
    if (!this.client) {
      try {
        const customOptions = {
          host: 'localhost',
          port: 9222,
        };

        for (const argument of ((this.options.launchOptions?.args ?? []) as string[])) {
          if (argument.includes('--remote-debugging-port')) {
            const port = argument.split('=')[1].trim();
            customOptions.port = Number(port);
          }
        }

        this.client ||= await CDP(customOptions);
        this.isPerformanceActive = false;
        this.client.on('disconnect', async () => {
          await this.destroy();
        });
      } catch {}
    }
  }

  /**
   * @inheritdoc
   */
  public async getMetric(metric: ChromiumSupportedMetrics, hookOrder: HookOrder): Promise<Metric[]> {
    return new Promise(async resolve => {
      await this.connect();
      const response: Metric[] = [];
      const mapping = this.mapMetric(metric);
      if (!mapping || !this.client) {
        resolve(response);
        return;
      }

      await this.activateDomain(mapping);
      await mapping[hookOrder](response, this.client);
      resolve(response);
    });
  }

  /**
   * @inheritdoc
   */
  public async runCustomObserver(observer: OnStartMeasure | OnStopMeasure): Promise<Metric[]> {
    return new Promise(async resolve => {
      await this.connect();
      const response: Metric[] = [];
      if (!this.client) {
        resolve(response);
        return;
      }

      await observer(response, this.client);
      resolve(response);
    });
  }

  /**
   * @inheritdoc
   */
  public async destroy() {
    try {
      this.isPerformanceActive = false;
      await this.client?.send('IO.close');
      this.client = undefined;
    } catch {}
  }

  /**
   * @inheritdoc
   */
  public getBrowserName(): SupportedBrowsers {
    return 'chromium';
  }

  /**
   * Provide observer to collect metric
   */
  private mapMetric(metric: Metrics): MetricObserver | undefined {
    switch (metric) {
      case 'usedJsHeapSize': {
        return new UsedJsHeapSize();
      }

      case 'totalJsHeapSize': {
        return new TotalJsHeapSize();
      }

      default: {
        return undefined;
      }
    }
  }

  /**
   * Activate performance metric collection
   */
  private async startPerformance(): Promise<boolean> {
    return new Promise(resolve => {
      if (!this.client) {
        this.isPerformanceActive = false;
        resolve(false);
        return;
      }

      this.client.send('Performance.enable', error => {
        this.isPerformanceActive = true;
        resolve(Boolean(error));
      });
    });
  }

  /**
   * Setup domain which need a setup
   */
  private async activateDomain(metricObserver: MetricObserver): Promise<void> {
    if (['totalJsHeapSize', 'usedJsHeapSize'].includes(metricObserver.name)) {
      if (!this.client) {
        this.isPerformanceActive = false;
        return;
      }

      await this.startPerformance();
    }
  }
}
