import {type SupportedBrowsers, type Metric, type Metrics} from '../types/index.js';

export type BrowserClient = {
  /**
   * Create connection to browser
   *
   * @param options parameters for browser setup
   */
  connect(options: Record<string, any>): Promise<void>;

  /**
   * Call client api and retrieve metric
   *
   * @param metric identifier type
   */
  getMetric(metric: Metrics): Promise<Metric[]>;

  /**
   * Cleans up client connection
   */
  destroy(): void;

  /**
   * Get registered browser client name
   */
  getBrowserName(): SupportedBrowsers;
};
