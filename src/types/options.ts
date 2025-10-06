import {
  type MeasurePlugin,
  type OnSamplingMeasure,
  type OnStartMeasure,
  type OnStopMeasure,
} from './index.js';

/**
 * Supported hooks to run measurements on
 */
export const hooks = ['onTest', 'onTestStep'] as const;
export type Hooks = typeof hooks[number];

export const hookOrder = ['onStart', 'onSampling', 'onStop'] as const;
export type HookOrder = typeof hookOrder[number];

/**
 * All metrics implemented in the reporter
 */
export const metrics = [
  'usedJsHeapSize',
  'totalJsHeapSize',
  'jsHeapSizeLimit',
  'powerInWatts',
  'allPerformanceMetrics',
  'heapDump',
  'heapDumpSampling',
] as const;
export type Metrics = typeof metrics[number];

/**
 * Common interface to define procedures to observe metrics
 */
export type MetricObserver = {
  name: string;
  plugins: MeasurePlugin[];
  onStart: OnStartMeasure;
  onSampling: OnSamplingMeasure;
  onStop: OnStopMeasure;
};

/**
 * Define which metric should regularly be requested
 */
export type MetricSampling = {
  samplingTimeoutInMilliseconds: number;
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
  chromium: ['usedJsHeapSize', 'totalJsHeapSize', 'allPerformanceMetrics', 'heapDump', 'heapDumpSampling'],
  firefox: [],
  webkit: [],
} as const;
export type ChromiumSupportedMetrics = typeof browsersSupportingMetrics.chromium[number] & Metrics;

export type OptionsFileWrite = {
  outputDir: string;
  outputFile: string;
};

export type JsonWriter = {
  /**
   * Initialize writer
   *
   * @param options defines target output
   */
  initialize(options: OptionsFileWrite): void;

  /**
   * Create new entry of an object
   *
   * @param content
   */
  write(content: Record<any, any>): boolean;

  /**
   * Finish json stream
   */
  close(): void;

  /**
   * Delete created target
   */
  delete(): boolean;
};

/**
 * Customize the reporter with desired browser and (custom) metrics
 */
export type Options = {
  outputDir: string;
  outputFile: string;
  deleteOnFailure: boolean;
  customJsonWriter?: JsonWriter;
  browsers: {
    [browser in SupportedBrowsers]?: {
      [hook in Hooks]?: {
        metrics: Array<typeof browsersSupportingMetrics[browser][number] & Metrics>;
        customMetrics?: Record<string, MetricObserver>;
        sampleMetrics?: Record<string, MetricSampling>;
      }
    }
  };
};

export const defaultOptions: Options = {
  outputDir: './',
  outputFile: 'performance-report.json',
  deleteOnFailure: false,
  browsers: {
    chromium: {
      onTest: {
        metrics: ['usedJsHeapSize'],
      },
    },
  },
};
