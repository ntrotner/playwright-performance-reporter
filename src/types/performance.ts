import {type BrowserClient} from '../browsers/client.js';

export enum HookOrderToMetricOrder {
  'onStart' = 'startMetrics',
  'onStop' = 'stopMetrics',
}

export enum HookOrderToMeasurementOrder {
  'onStart' = 'startMeasurement',
  'onStop' = 'endMeasurement',
}

/**
 * Common metric type
 */
export type Metric = Record<string, string | number>;

/**
 * Common interface to expose performance metrics during a timeframe
 */
export type PerformanceMetrics = {
  /**
   * Unix timestamp of start of capture
   */
  startMeasurement: number;

  /**
   * Unix timestamp of end of capture
   */
  endMeasurement: number;

  /**
   * Metrics gathered from the extractors
   */
  startMetrics: Metric[];

  /**
   * Metrics gathered from the extractors
   */
  stopMetrics: Metric[];
};

/**
 * Start metric measurement and write the preliminary result into the storage
 */
export type OnStartMeasure = (input: BrowserClient) => Promise<Metric>;

/**
 * Stop metric measurement and write the result into the storage
 */
export type OnStopMeasure = (input: BrowserClient) => Promise<Metric>;
