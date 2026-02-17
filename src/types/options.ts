import type CDP from 'chrome-remote-interface';
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
export type MetricObserver<T> = {
  name: string;
  plugins: Array<MeasurePlugin<T>>;
  onStart: OnStartMeasure<T>;
  onSampling: OnSamplingMeasure<T>;
  onStop: OnStopMeasure<T>;
};

/**
 * Define which metric should regularly be requested
 */
export type MetricSampling<T> = {
  samplingTimeoutInMilliseconds: number;
  metric: MetricObserver<T>;
};

/**
 * Supported browser dev tool clients
 */
export type BrowserDeveloperToolsClient = {
  chromium: CDP.Client;
  webkit: Record<string, unknown>;
  firefox: Record<string, unknown>;
};

/**
 * Browsers that have been tested to work with performance metric extraction
 */
export const supportedBrowsers = ['chromium', 'webkit', 'firefox'] as const;
export type SupportedBrowsers = typeof supportedBrowsers[number];

/**
 * Chromium specific metric observer and measure plugin
 */
export type ChromiumMetricObserver = MetricObserver<BrowserDeveloperToolsClient['chromium']>;
export type ChromiumMeasurePlugin = MeasurePlugin<BrowserDeveloperToolsClient['chromium']>;

/**
 * Firefox specific metric observer and measure plugin.
 */
export type FirefoxMetricObserver = MetricObserver<BrowserDeveloperToolsClient['firefox']>;
export type FirefoxMeasurePlugin = MeasurePlugin<BrowserDeveloperToolsClient['firefox']>;

/**
 * Webkit specific metric observer and measure plugin.
 */
export type WebkitMetricObserver = MetricObserver<BrowserDeveloperToolsClient['webkit']>;
export type WebkitMeasurePlugin = MeasurePlugin<BrowserDeveloperToolsClient['webkit']>;

export type OptionsFileWrite = {
  outputDir: string;
  outputFile: string;
};

/**
 * Options to customize the reporter for a specific browser.
 */
type BrowserOptions = {
  [browser in SupportedBrowsers]?: Partial<Record<Hooks, {
    metrics: Array<MetricObserver<BrowserDeveloperToolsClient[browser]>>;
  }>> & {
    sampling?: {
      metrics: Array<MetricSampling<BrowserDeveloperToolsClient[browser]>>;
    };
  };
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
