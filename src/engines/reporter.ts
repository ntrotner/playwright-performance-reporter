import {
  type FullConfig,
  type FullResult,
  type Reporter,
  type Suite,
  type TestCase,
  type TestResult,
  type TestStep,
} from '@playwright/test/reporter';
import {
  type TestPerformance, type Options, type SupportedBrowsers, type Hooks, type HookOrder, HookOrderToMetricOrder, HookOrderToMeasurementOrder,
} from '../types/index.js';
import {MetricsEngine} from './index.js';

export class PerformanceReporter implements Reporter {
  /**
   * Accumulation of all test cases
   */
  public results: Record<string, TestPerformance> = {};

  /*
   * Metrics engine to retrieve metrics from a browser
   */
  private readonly metricsEngine: MetricsEngine;

  constructor(private readonly options: Options) {
    this.metricsEngine = new MetricsEngine();
  }

  onBegin(config: FullConfig, suite: Suite) {
    const browserName = suite.entries()[0].title as SupportedBrowsers;

    if (browserName) {
      this.metricsEngine.setupBrowser(browserName);
    }
  }

  onEnd(result: FullResult) {
    this.metricsEngine.destroy();
  }

  async onTestBegin(test: TestCase, result: TestResult) {
    const browserName = this.metricsEngine.getBrowser();
    if (!browserName) {
      // Browser not stable
      return;
    }

    const identifier = this.buildIdentifier(test);
    if (identifier === '') {
      // Root of test suite
      return;
    }

    this.registerTestPerformance(identifier);
    await this.executeMetrics(identifier, 'onTest', 'onStart', browserName);
  }

  async onTestEnd(test: TestCase, result: TestResult) {
    const browserName = this.metricsEngine.getBrowser();
    if (!browserName) {
      // Browser not stable
      return;
    }

    const identifier = this.buildIdentifier(test);
    if (identifier === '') {
      // Root of test suite
      return;
    }

    await this.executeMetrics(identifier, 'onTest', 'onStop', browserName);
  }

  async onStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    const browserName = this.metricsEngine.getBrowser();
    if (!browserName) {
      // Browser not stable
      return;
    }

    const identifier = this.buildIdentifier(step);
    if (identifier === '') {
      // Root of test suite
      return;
    }

    this.registerTestPerformance(identifier);
    await this.executeMetrics(identifier, 'onTestStep', 'onStart', browserName);
  }

  async onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    const browserName = this.metricsEngine.getBrowser();
    if (!browserName) {
      // Browser not stable
      return;
    }

    const identifier = this.buildIdentifier(step);
    if (identifier === '') {
      // Root of test suite
      return;
    }

    await this.executeMetrics(identifier, 'onTestStep', 'onStop', browserName);
  }

  /**
   * Get name from test hierarchy
   *
   * @param testCases test or test step
   */
  private buildIdentifier(testCases: TestCase | TestStep): string {
    let identifier = '';
    let pivot: Suite | TestCase | TestStep | undefined = testCases;

    while (pivot) {
      if (pivot.title !== '') {
        identifier = pivot.title + ' - ' + identifier;
      }

      pivot = pivot.parent;
    }

    return identifier;
  }

  /**
   * Create generic `TestPerformance` object to fill during measurements
   *
   * @param name identifier for the performance metrics
   */
  private buildTestPerformance(name: string): TestPerformance {
    return {
      name,
      startMetrics: [],
      stopMetrics: [],
      startMeasurement: Date.now(),
      endMeasurement: Date.now(),
    };
  }

  /**
   * Add new `TestPerformance` with identifier
   *
   * @param name identifier for the performance metrics
   */
  private registerTestPerformance(name: string) {
    this.results[name] = this.buildTestPerformance(name);
  }

  /**
   * Execute metrics gathering for existing metrics and custom metrics
   *
   * @param name identifier for the performance metrics
   * @param hook playwright hook
   * @param hookOrder playwright hook order
   * @param browser which settings and metrics to use
   */
  private async executeMetrics(name: string, hook: Hooks, hookOrder: HookOrder, browser: SupportedBrowsers) {
    const metrics = Promise.all(
      this.options.browsers[browser]?.[hook]?.metrics.map(async metric => this.metricsEngine.getMetric(metric)) ?? [],
    );
    const customMetrics = Promise.all(
      Object.values(this.options.browsers[browser]?.[hook]?.customMetrics ?? {})
        .map(async customMetric =>
          this.metricsEngine.runCustomMetric(customMetric[hookOrder]),
        ) || [],
    );

    const resolvedMetrics = await metrics;
    const resolvedCustomMetrics = await customMetrics;

    this.results[name][HookOrderToMeasurementOrder[hookOrder]] = Date.now();
    this.results[name][HookOrderToMetricOrder[hookOrder]].push(
      ...resolvedMetrics.filter(m => m !== undefined),
      ...resolvedCustomMetrics.filter(m => m !== undefined),
    );
  }
}

