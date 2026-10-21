import type CDP from 'chrome-remote-interface';
import {
  type AppliedConditions,
} from './conditions.js';

export enum HookOrderToMetricOrder {
  onStart = 'startMetrics',
  onStop = 'stopMetrics',
}

export enum HookOrderToMeasurementOrder {
  onStart = 'startMeasurement',
  onStop = 'endMeasurement',
}

export enum HookOrderToMeasurementOffsetOrder {
  onStart = 'startMeasurementOffset',
  onStop = 'endMeasurementOffset',
}

/**
 * Common metric type
 */
export type Metric = Record<string, string | number>;

/**
 * Metric type specific for targets
 */
export type TargetMetric = {
  metric: Metric;
} & Partial<CDP.Target>;

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
  startMeasurementOffset?: number;

  /**
   * Unix timestamp of end of capture
   */
  endMeasurement: number;

  /**
   * Amount of milliseconds between metric trigger and when it was measured
   */
  endMeasurementOffset?: number;

  /**
   * Metrics gathered from the extractors
   */
  startMetrics: TargetMetric[];

  /**
   * Metrics gathered from the extractors
   */
  stopMetrics: TargetMetric[];

  /**
   * Metrics gathered from the extractors in sampling mode
   */
  samplingMetrics: TargetMetric[];

  /**
   * Throttling the test was measured under, only set on the test itself if configured
   */
  conditions?: AppliedConditions;

  /**
   * Execution of the test, e.g. with `repeatEach`. Only set on the test itself, at its start.
   */
  execution?: TestExecution;
};

/**
 * Execution of a test. Every repeat has its own test id, while the name stays the same.
 */
export type TestExecution = {
  /**
   * Index of the repeat with `repeatEach`, starting at 0
   */
  repeatEachIndex: number;

  /**
   * Retry of a failed execution, 0 for the first attempt
   */
  retry: number;
};

/**
 * Plugin to execute before the metrics are fetched. Can be used to make the metrics fetch possible.
 */
export type MeasurePlugin<T> = (developmentTools: T) => Promise<any>;

/**
 * Start metric measurement and write the preliminary result into the storage
 */
export type OnStartMeasure<T> = (accumulator: Metric, developmentTools: T) => Promise<void>;

/**
 * Sampling metric measurement and write the result into the storage
 */
export type OnSamplingMeasure<T> = (accumulator: Metric, developmentTools: T) => Promise<void>;

/**
 * Stop metric measurement and write the result into the storage
 */
export type OnStopMeasure<T> = (accumulator: Metric, developmentTools: T) => Promise<void>;

export {type default as CDP} from 'chrome-remote-interface';
