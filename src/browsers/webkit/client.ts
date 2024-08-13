import {type SupportedBrowsers, type Metric, type Metrics} from '../../types/index.js';
import {type BrowserClient} from '../client.js';

export class WebkitDevelopmentTools implements BrowserClient {
  /**
   * @inheritdoc
   */
  async getMetric(metric: Metrics): Promise<Metric[]> {
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
