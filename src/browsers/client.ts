import {
  type SupportedBrowsers,
  type HookOrder,
  type TargetMetric,
  type MetricObserver,
  type BrowserDeveloperToolsClient,
} from '../types/index.js';

export type BrowserClient = {
  /**
   * Create connection to browser
   */
  connect(): Promise<void>;

  /**
   * Call client api and retrieve metric
   *
   * @param metric identifier observer
   * @param hookOrder which hook to run
   */
  getMetric(metric: MetricObserver<BrowserDeveloperToolsClient[SupportedBrowsers]>, hookOrder: HookOrder): Promise<TargetMetric[]>;

  /**
   * Cleans up client connection
   */
  destroy(): void;

  /**
   * Get registered browser client name
   */
  getBrowserName(): SupportedBrowsers;
};
