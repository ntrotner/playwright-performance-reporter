import {
  type SupportedBrowsers,
  type Metrics,
  type TargetMetric,
  type MetricObserver,
  type HookOrder,
} from '../../types/index.js';
import {type BrowserClient} from '../client.js';

export class FirefoxDevelopmentTools implements BrowserClient {
  /**
   * @inheritdoc
   */
  constructor(private readonly options: Record<string, any>) {}

  /**
   * @inheritdoc
   */
  async connect(): Promise<void> {}

  /**
   * @inheritdoc
   */
  async getMetric(metric: Metrics): Promise<TargetMetric[]> {
    return [];
  }

  /**
   * @inheritdoc
   */
  async runCustomObserver(customMetric: MetricObserver, hookOrder: HookOrder): Promise<TargetMetric[]> {
    return [];
  }

  /**
   * @inheritdoc
   */
  destroy() {
    return null;
  }

  /**
   * @inheritdoc
   */
  getBrowserName(): SupportedBrowsers {
    return 'firefox';
  }
}
