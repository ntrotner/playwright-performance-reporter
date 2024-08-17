import {type BrowserClient} from '../browsers/client.js';

export enum HookOrderToMetricOrder {
  'onStart' = 'startMetrics',
  'onStop' = 'stopMetrics',
}

export enum HookOrderToMeasurementOrder {
  'onStart' = 'startMeasurement',
  'onStop' = 'endMeasurement',
}

export enum HookOrderToMeasurementOffsetOrder {
  'onStart' = 'startMeasurementOffset',
  'onStop' = 'endMeasurementOffset',
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
   * Amount of milliseconds between metric trigger and when it was measured
   */
  startMeasurementOffset?: number

  /**
   * Unix timestamp of end of capture
   */
  endMeasurement: number;

  /**
   * Amount of milliseconds between metric trigger and when it was measured
   */
  endMeasurementOffset?: number

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
