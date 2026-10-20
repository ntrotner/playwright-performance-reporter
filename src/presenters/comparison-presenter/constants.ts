import {
  type MetricKind,
  type MetricUnit,
} from './types.js';

/**
 * Metrics that summarize a whole test or step, e.g. of the CPU profile
 */
export const totalMetricPrefix = 'cpuProfile';

/**
 * Google's "good" and "poor" thresholds per Web Vital.
 * Values between `good` and `poor` are "needs improvement".
 */
export const webVitalThresholds: Record<string, {good: number; poor: number}> = {
  largestContentfulPaint: {good: 2500, poor: 4000},
  firstContentfulPaint: {good: 1800, poor: 3000},
  interactionToNextPaint: {good: 200, poor: 500},
  cumulativeLayoutShift: {good: 0.1, poor: 0.25},
};

/**
 * Web Vitals measured once for the whole page, so only their latest value matters
 */
export const webVitalsMetrics = new Set(Object.keys(webVitalThresholds));

/**
 * Durations of the Navigation Timing, which describe the latest document, so only their latest value matters
 */
export const navigationTimingMetrics = new Set([
  'timeToFirstByte',
  'redirectTime',
  'dnsLookupTime',
  'tcpConnectTime',
  'tlsTime',
  'requestTime',
  'responseTime',
  'domContentLoadedTime',
  'domCompleteTime',
  'loadEventTime',
]);

/**
 * Metrics where a higher value is an improvement, unlike durations, sizes and counts
 */
export const higherIsBetterMetrics = new Set(['performanceScore']);

/**
 * Synthetic metric for the wall time of a test or step
 */
export const entityDurationMetric = 'entityDuration';

/**
 * Absolute timestamps, which are not comparable across runs, and
 * metadata of written artifacts, e.g. of the trace capture
 */
export const ignoredMetrics = new Set([
  'Timestamp',
  'NavigationStart',
  'FirstMeaningfulPaint',
  'DomContentLoaded',
  'traceSizeBytes',
  'traceDataLoss',
  // Constant flag whether the browser supports long animation frames
  'loafSupported',
  // Bound of the output of the user timing observer, not a measurement
  'userTimingDroppedNames',
]);

/**
 * Durations of the requests of a test or step, measured once between its start and stop by `requestTiming`
 */
export const requestDurationPrefixes = ['requestDuration', 'requestTtfb', 'apiRequestDuration'];

/**
 * Whether a metric is a request duration of `requestTiming`
 *
 * @param metricName name of the metric
 */
function isRequestDuration(metricName: string): boolean {
  return requestDurationPrefixes.some(prefix => metricName.startsWith(prefix));
}

/**
 * Numeric attribution of the Web Vitals, which like the Web Vitals describe the whole page
 */
export const webVitalsAttributionMetrics = new Set([
  'lcpRenderDelay',
  'lcpSize',
  'clsLargestShiftValue',
  'inpInputDelay',
  'inpProcessingDuration',
  'inpPresentationDelay',
]);

/**
 * Prefix of the marks, measures and element timings of the user timing observer, e.g. `userTiming:measure:editor-ready`
 */
export const userTimingMetricPrefix = 'userTiming:';

/**
 * Memory kept alive by a test or step, measured once between its start and stop
 */
export const memoryGrowthMetrics = new Set([
  'heapGrowthBytes',
  'nodeGrowth',
  'listenerGrowth',
  'documentGrowth',
  'heapGrowthPerSecond',
  'heapDiffAddedObjects',
  'heapDiffAddedBytes',
  'heapDiffDetachedNodes',
]);

/**
 * Decide on how to condense a metric
 *
 * @param metricName name of the metric
 */
export function classifyMetric(metricName: string): MetricKind {
  if (metricName.startsWith(totalMetricPrefix) || metricName.startsWith(userTimingMetricPrefix) || memoryGrowthMetrics.has(metricName) || isRequestDuration(metricName) || metricName === 'performanceScore' || webVitalsMetrics.has(metricName) || webVitalsAttributionMetrics.has(metricName) || navigationTimingMetrics.has(metricName)) {
    return 'total';
  }

  if (metricName.startsWith('totalNetwork') || /(?:Duration|Count|Time)$/.test(metricName)) {
    return 'cumulative';
  }

  return 'gauge';
}

/**
 * Durations of observers in milliseconds, while other durations of the Performance domain are in seconds
 */
const millisecondMetrics = new Set([
  'totalDnsTime',
  'totalTcpTime',
  'totalTlsTime',
  'totalRequestTime',
  'totalResponseTime',
  'totalRedirectTime',
  'totalBlockedTime',
  'totalLongTasksDuration',
  'totalBlockingTime',
  'maxLongTaskDuration',
  'lcpRenderDelay',
  'inpInputDelay',
  'inpProcessingDuration',
  'inpPresentationDelay',
  'totalLoafDuration',
  'totalLoafBlockingDuration',
  'maxLoafDuration',
  'totalForcedStyleAndLayoutDuration',
]);

/**
 * Decide on the unit of a metric
 *
 * @param metricName name of the metric
 */
export function metricUnit(metricName: string): MetricUnit {
  if (metricName === 'cumulativeLayoutShift' || metricName === 'clsLargestShiftValue' || metricName === 'performanceScore') {
    return 'score';
  }

  // Names of endpoints are chosen by the user, so their suffix says nothing about the unit
  if (isRequestDuration(metricName)) {
    return 'ms';
  }

  // Area of the largest contentful paint in pixels
  if (metricName === 'lcpSize') {
    return 'count';
  }

  // Names are chosen by the application, so their suffix says nothing about the unit
  if (metricName.startsWith(userTimingMetricPrefix)) {
    return 'ms';
  }

  if (/(?:Size|Bytes)$/.test(metricName)) {
    return 'bytes';
  }

  if (webVitalsMetrics.has(metricName) || navigationTimingMetrics.has(metricName) || millisecondMetrics.has(metricName)) {
    return 'ms';
  }

  if (!/(?:Duration|Time)$/.test(metricName)) {
    return 'count';
  }

  // Durations of the Performance domain are in seconds, the ones of the reporter, network and CPU profile in milliseconds
  return metricName === entityDurationMetric || metricName.startsWith('totalNetwork') || metricName.startsWith(totalMetricPrefix) ? 'ms' : 's';
}
