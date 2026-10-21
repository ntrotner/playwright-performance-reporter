import type CDP from 'chrome-remote-interface';
import {
  nativeChromiumObservers,
} from '../browsers/chromium/observers/index.js';
import {
  type BudgetOptions,
  type BudgetViolation,
  type MeasurePlugin,
  type OnSamplingMeasure,
  type OnStartMeasure,
  type OnStopMeasure,
  type ResultAccumulator,
  type ThrottlingOptions,
  type StepCategory,
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

  /**
   * What the observer needs: `cdp` observers use the Chrome DevTools Protocol, `playwright` observers read
   * what the fixture recorded with Playwright, e.g. requests, and only run in the fixture mode. Defaults to `['cdp']`.
   */
  capabilities?: readonly ObserverCapability[];
  plugins: Array<MeasurePlugin<T>>;
  onStart: OnStartMeasure<T>;
  onSampling: OnSamplingMeasure<T>;
  onStop: OnStopMeasure<T>;
};

/**
 * What an observer needs: the Chrome DevTools Protocol, or the recordings of Playwright in the fixture mode
 */
export type ObserverCapability = 'cdp' | 'playwright';

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

    /**
     * Throttling applied to every page before it's measured. Only supported for Chromium.
     */
    conditions?: ThrottlingOptions;
  };
};

export type PresenterWriter = {
  /**
   * Create new entry of an object
   *
   * @param content
   */
  write(content: ResultAccumulator): Promise<boolean>;

  /**
   * Finish json stream
   */
  close(): Promise<boolean>;

  /**
   * Delete created target
   */
  delete(): Promise<boolean>;

  /**
   * Receive the budget violations of the run, before `close` is called. Only called if budgets are configured.
   *
   * @param violations violations of all budget rules, empty if every budget is met
   */
  onBudgetViolations?(violations: BudgetViolation[]): Promise<void>;
};

/**
 * Connect to a separate browser per worker, e.g. with `perWorkerDebuggingPort` of `playwright-performance-reporter/fixture`
 */
export type DebuggingPortOptions = {
  /**
   * Connect to port `base + parallelIndex` of the worker that runs the test
   */
  perWorker: boolean;

  /**
   * First port. Defaults to the port in the launch options, or 9222.
   */
  base?: number;
};

/**
 * Select the steps to measure
 */
export type StepSelection = {
  /**
   * Step categories to measure, e.g. `pw:api` for Playwright API calls like navigations. Defaults to `['test.step']`.
   * The fixture mode only measures `test.step()`.
   */
  categories?: StepCategory[];

  /**
   * Glob pattern (supports `*` and `?`) matched against the title of the step. Defaults to `'*'`.
   */
  titlePattern?: string;

  /**
   * Also measure selected steps within other selected steps. Defaults to false,
   * e.g. a navigation within a measured `test.step()` is not measured on its own.
   * `test.step()` blocks are always measured, also nested ones.
   */
  nested?: boolean;
};

/**
 * Information about a run, e.g. `{commit: 'abc123', branch: 'main'}`
 */
export type RunMetadata = Record<string, string>;

/**
 * Customize the reporter with desired browser and (custom) metrics
 */
export type Options = {
  deleteOnFailure: boolean;

  /**
   * Maximum amount of listeners on a single event emitter before Node logs a
   * `MaxListenersExceededWarning`. Raising this silences the warning when many
   * presenters attach `drain` listeners to file streams. `0` disables the limit
   * entirely. Defaults to Node's 10.
   */
  maxListeners?: number;

  /**
   * Remote debugging port of the browsers. By default the port of `--remote-debugging-port`
   * in the launch options is used, which requires a single worker.
   */
  debuggingPort?: DebuggingPortOptions;

  /**
   * - `port` (default): the reporter connects to the browsers via their remote debugging port
   * - `fixture`: the `withPerformance` fixture of `playwright-performance-reporter/fixture` measures every test
   *   inside its worker via Playwright's CDP session, and the reporter only reads the measurements from the
   *   test attachments. Works with any amount of workers and with sharding.
   */
  mode?: 'port' | 'fixture';

  /**
   * Which steps are measured by `onTestStep` and sampling. Defaults to every `test.step()`.
   */
  steps?: StepSelection;

  /**
   * Information about the run, e.g. the commit, written to every test. Merged over the detected
   * metadata of the CI provider, git and the machine. A function is called once when the reporter is created.
   */
  metadata?: RunMetadata | (() => RunMetadata);

  /**
   * Lighthouse-like `performanceScore` (0-100) of every page at the stop of a test or step, computed from
   * Web Vitals and Total Blocking Time. Defaults to the desktop curves. `false` disables it.
   */
  scoring?: {device?: 'mobile' | 'desktop'} | false;

  presenters?: PresenterWriter[];
  browsers: BrowserOptions;

  /**
   * Performance budgets enforced against the final ("onStop") metrics.
   * Omit to keep the reporter passive.
   */
  budgets?: BudgetOptions;
};

export const defaultOptions: Options = {
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
