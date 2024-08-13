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
 * Allow users of the reporter to define custom metrics without contributing
 */
export type CustomMetric = {
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
const browsersSupportingMetrics = {
  chromium: ['usedJsHeapSize', 'totalJsHeapSize', 'jsHeapSizeLimit'],
  firefox: [],
  webkit: [],
} as const;

/**
 * Customize the reporter with desired browser and (custom) metrics
 */
export type Options = {
  browsers: {
    [browser in SupportedBrowsers]?: {
      [hook in Hooks]?: {
        metrics: Array<typeof browsersSupportingMetrics[browser][number] & Metrics>;
        customMetrics?: Record<string, CustomMetric>;
      }
    }
  };
};

export const defaultOptions: Options = {
  browsers: {
    chromium: {
      onTest: {
        metrics: ['usedJsHeapSize'],
      },
    },
  },
};
