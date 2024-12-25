import {
  type SupportedBrowsers,
  type Metrics,
  type HookOrder,
  type TargetMetric,
  type MetricObserver,
} from '../types/index.js';

export type BrowserClient = {
  /**
   * Create connection to browser
   */
  connect(): Promise<void>;

  /**
   * Call client api and retrieve metric
   *
   * @param metric identifier type
   * @param hookOrder which hook to run
   */
  getMetric(metric: Metrics, hookOrder: HookOrder): Promise<TargetMetric[]>;

  /**
   * Run user defined observer for metric extraction
   *
   * @param observer custom metric observer
   * @param hookOrder which hook to run
   */
  runCustomObserver(observer: MetricObserver, hookOrder: HookOrder): Promise<TargetMetric[]>;

  /**
   * Cleans up client connection
   */
  destroy(): void;

  /**
   * Get registered browser client name
   */
  getBrowserName(): SupportedBrowsers;
};
