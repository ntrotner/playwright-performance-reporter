import {
  nativeChromiumObservers,
} from '../browsers/chromium/observers/index.js';
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
  metric: MetricObserver;
};

/**
 * Browsers that have been tested to work with performance metric extraction
 */
export const supportedBrowsers = ['chromium', 'webkit', 'firefox'] as const;
export type SupportedBrowsers = typeof supportedBrowsers[number];

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
  write(content: Record<any, any>): Promise<boolean>;

  /**
   * Finish json stream
   */
  close(): void;

  /**
   * Delete created target
   */
  delete(): Promise<boolean>;
};

type BrowserOptions = {
  [browser in SupportedBrowsers]?: {
    [hook in Hooks]?: {
      metrics: MetricObserver[];
    };
  } & {
    sampling?: {
      metrics: MetricSampling[];
    };
  };
};

/**
 * Customize the reporter with desired browser and (custom) metrics
 */
export type Options = {
  outputDir: string;
  outputFile: string;
  deleteOnFailure: boolean;
  customJsonWriter?: JsonWriter;
  browsers: BrowserOptions;
};

export const defaultOptions: Options = {
  outputDir: './',
  outputFile: 'performance-report.json',
  deleteOnFailure: false,
  browsers: {
    chromium: {
      onTest: {
        metrics: [new nativeChromiumObservers.allPerformanceMetrics()],
      },
      sampling: {
        metrics: [
          {
            samplingTimeoutInMilliseconds: 1000,
            metric: new nativeChromiumObservers.usedJsHeapSize(),
          },
        ],
      },
    },
  },
};
