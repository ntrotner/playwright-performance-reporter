import {type OnStartMeasure, type OnStopMeasure} from './index.js';

/**
 * Supported hooks to run measurements on
 */
export const hooks = ['onTest', 'onTestStep'] as const;
export type Hooks = typeof hooks[number];

export const hookOrder = ['onStart', 'onStop'] as const;
export type HookOrder = typeof hookOrder[number];

/**
 * All metrics implemented in the reporter
 */
export const metrics = ['usedJsHeapSize', 'totalJsHeapSize', 'jsHeapSizeLimit', 'powerInWatts'] as const;
export type Metrics = typeof metrics[number];

/**
 * Common interface to define procedures to observe metrics
 */
export type MetricObserver = {
  name: string;
  onStart: OnStartMeasure;
  onStop: OnStopMeasure;
};

/**
 * Browsers that have been tested to work with performance metric extraction
 */
export const supportedBrowsers = ['chromium', 'webkit', 'firefox'] as const;
export type SupportedBrowsers = typeof supportedBrowsers[number];

/**
 * Restrict metrics to browsers as some don't expose APIs or
 * don't support extraction at all
 */
export const browsersSupportingMetrics = {
  chromium: ['usedJsHeapSize', 'totalJsHeapSize', 'jsHeapSizeLimit'],
  firefox: [],
  webkit: [],
} as const;
export type ChromiumSupportedMetrics = typeof browsersSupportingMetrics.chromium[number] & Metrics;

/**
 * Customize the reporter with desired browser and (custom) metrics
 */
export type Options = {
  outputDir: string;
  outputFile: string;
  browsers: {
    [browser in SupportedBrowsers]?: {
      [hook in Hooks]?: {
        metrics: Array<typeof browsersSupportingMetrics[browser][number] & Metrics>;
        customMetrics?: Record<string, MetricObserver>;
      }
    }
  };
};

export const defaultOptions: Options = {
  outputDir: './',
  outputFile: 'performance-report.json',
  browsers: {
    chromium: {
      onTest: {
        metrics: ['usedJsHeapSize'],
      },
    },
  },
};
