import {type PerformanceMetrics} from './index.js';

/**
 * Metrics for a specific test step
 */
export type TestStepPerformance = {
  /**
   * Name of step
   */
  name: string;
} & PerformanceMetrics;

/**
 * Metrics for a test suite
 */
export type TestPerformance = {
  /**
   * Name of step
   */
  name: string;
} & PerformanceMetrics;

/**
 * Accumulator for results that could be deep merged
 */
export type ResultAccumulator = Record<string, Record<string, TestPerformance>>;
