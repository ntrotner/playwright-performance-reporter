import {type SupportedBrowsers, type Metric, type Metrics} from '../types/index.js';

export type BrowserClient = {
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
