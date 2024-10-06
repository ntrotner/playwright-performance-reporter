import {
  type SupportedBrowsers,
  type Metrics,
  type HookOrder,
  type OnStopMeasure,
  type OnStartMeasure,
  type TargetMetric,
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
   */
  runCustomObserver(observer: OnStartMeasure | OnStopMeasure): Promise<TargetMetric[]>;

  /**
   * Cleans up client connection
   */
  destroy(): void;

  /**
   * Get registered browser client name
   */
  getBrowserName(): SupportedBrowsers;
};
