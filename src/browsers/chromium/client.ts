import {type Metrics, type Metric, type SupportedBrowsers} from '../../types/index.js';
import {type BrowserClient} from '../client.js';

export class ChromiumDevelopmentTools implements BrowserClient {
  /**
   * @inheritdoc
   */
  public async connect(options: Record<string, any>) {}

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
    return 'chromium';
  }
}
