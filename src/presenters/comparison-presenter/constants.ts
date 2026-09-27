import {
  type MetricKind,
  type MetricUnit,
} from './types.js';

/**
 * Metrics that summarize a whole test or step, e.g. of the CPU profile
 */
export const totalMetricPrefix = 'cpuProfile';

/**
 * Web Vitals measured once for the whole page, so only their latest value matters
 */
export const webVitalsMetrics = new Set([
  'largestContentfulPaint',
  'firstContentfulPaint',
  'cumulativeLayoutShift',
  'interactionToNextPaint',
]);

/**
 * Google's official "good" and "poor" thresholds per Web Vital.
 * Values between `good` and `poor` are "needs improvement".
 */
export const webVitalThresholds: Record<string, {good: number; poor: number}> = {
  largestContentfulPaint: {good: 2500, poor: 4000},
  firstContentfulPaint: {good: 1800, poor: 3000},
  interactionToNextPaint: {good: 200, poor: 500},
  cumulativeLayoutShift: {good: 0.1, poor: 0.25},
};

/**
 * Synthetic metric for the wall time of a test or step
 */
export const entityDurationMetric = 'entityDuration';

/**
 * Absolute timestamps, which are not comparable across runs
 */
export const ignoredMetrics = new Set([
  'Timestamp',
  'NavigationStart',
  'FirstMeaningfulPaint',
  'DomContentLoaded',
]);

/**
 * Scale factor to make the median absolute deviation consistent with the standard deviation
 */
export const madScaleFactor = 1.4826;

/**
 * Decide on how to condense a metric
 *
 * @param metricName name of the metric
 */
export function classifyMetric(metricName: string): MetricKind {
  if (metricName.startsWith(totalMetricPrefix) || webVitalsMetrics.has(metricName)) {
    return 'total';
  }

  if (metricName.startsWith('totalNetwork') || /(?:Duration|Count|Time)$/.test(metricName)) {
    return 'cumulative';
  }

  return 'gauge';
}

/**
 * Metrics measured in milliseconds, while other durations of the Performance domain are in seconds
 */
const millisecondMetrics = new Set([
  'entityDuration',
  'totalNetworkDuration',
  'largestContentfulPaint',
  'firstContentfulPaint',
  'interactionToNextPaint',
]);

/**
 * Decide on the unit of a metric
 *
 * @param metricName name of the metric
 */
export function metricUnit(metricName: string): MetricUnit {
  if (metricName === 'cumulativeLayoutShift') {
    return 'score';
  }

  if (millisecondMetrics.has(metricName) || (metricName.startsWith(totalMetricPrefix) && /(?:Duration|Time)$/.test(metricName))) {
    return 'ms';
  }

  if (/(?:Size|Bytes)$/.test(metricName)) {
    return 'bytes';
  }

  if (/(?:Duration|Time)$/.test(metricName)) {
    return 's';
  }

  return 'count';
}
