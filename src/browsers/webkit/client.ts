import {
  type SupportedBrowsers,
  type TargetMetric,
  type WebkitMetricObserver,
} from '../../types/index.js';
import {
  type BrowserClient,
} from '../client.js';

export class WebkitDevelopmentTools implements BrowserClient {
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
  async getMetric(metric: WebkitMetricObserver): Promise<TargetMetric[]> {
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
    return 'webkit';
  }
}
