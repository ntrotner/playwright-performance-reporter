import {
  type SupportedBrowsers, type Metric, type Metrics, type OnStartMeasure, type OnStopMeasure,
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
  async getMetric(metric: Metrics): Promise<Metric[]> {
    return [];
  }

  /**
   * @inheritdoc
   */
  async runCustomObserver(observer: OnStartMeasure | OnStopMeasure): Promise<Metric[]> {
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
