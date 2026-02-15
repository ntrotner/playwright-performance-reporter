import {
  type SupportedBrowsers,
  type TargetMetric,
  type FirefoxMetricObserver,
} from '../../types/index.js';
import {
  type BrowserClient,
} from '../client.js';

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
  async getMetric(metric: FirefoxMetricObserver): Promise<TargetMetric[]> {
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
