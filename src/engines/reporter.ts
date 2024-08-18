import path from 'node:path';
import fs from 'node:fs';
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
  type TestPerformance,
  type Options,
  type SupportedBrowsers,
  type Hooks,
  type HookOrder,
  HookOrderToMetricOrder,
  HookOrderToMeasurementOrder,
  HookOrderToMeasurementOffsetOrder,
} from '../types/index.js';
import {sanitizeStringInput} from '../helpers/index.js';
import {MetricsEngine} from './index.js';

export class PerformanceReporter implements Reporter {
  /**
   * Accumulation of all test cases
   */
  public results: Record<string, Record<string, TestPerformance>> = {};

  /**
   * Current test case name
   */
  private pivotTest = '';

  /*
   * Metrics engine to retrieve metrics from a browser
   */
  private readonly metricsEngine: MetricsEngine;

  constructor(private readonly options: Options) {
    this.metricsEngine = new MetricsEngine();
  }

  onBegin(config: FullConfig, suite: Suite) {}

  onEnd(result: FullResult) {
    this.writeReportToFile();
  }

  async onTestBegin(test: TestCase, result: TestResult) {
    this.pivotTest = sanitizeStringInput(test.title);
    const browserDetails = test.parent.project()?.use;
    if (browserDetails) {
      try {
        await this.metricsEngine.setupBrowser(browserDetails.defaultBrowserType, browserDetails);
      } catch {}
    }

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
    this.metricsEngine.destroy();
    this.pivotTest = '';
  }

  async onStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    const browserName = this.metricsEngine.getBrowser();
    if (!browserName) {
      // Browser not stable
      return;
    }

    if (step.category !== 'test.step') {
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

    if (step.category !== 'test.step') {
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
        if (identifier !== '') {
          identifier = ' - ' + identifier;
        }

        identifier = pivot.title + identifier;
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
    this.results[this.pivotTest] ||= {};
    this.results[this.pivotTest][name] ||= this.buildTestPerformance(name);
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
    const startOfTrigger = Date.now();
    const metrics = Promise.all(
      this.options.browsers[browser]?.[hook]?.metrics.map(async metric => this.metricsEngine.getMetric(metric, hookOrder)) ?? [],
    );
    const customMetrics = Promise.all(
      Object.values(this.options.browsers[browser]?.[hook]?.customMetrics ?? {})
        .map(async customMetric =>
          this.metricsEngine.runCustomMetric(customMetric[hookOrder]),
        ) || [],
    );

    const resolvedMetrics = await metrics;
    const resolvedCustomMetrics = await customMetrics;
    const endOfTrigger = Date.now();

    this.results[this.pivotTest][name][HookOrderToMeasurementOrder[hookOrder]] = Date.now();
    this.results[this.pivotTest][name][HookOrderToMeasurementOffsetOrder[hookOrder]] = endOfTrigger - startOfTrigger;
    this.results[this.pivotTest][name][HookOrderToMetricOrder[hookOrder]].push(
      ...resolvedMetrics.filter(m => m !== undefined),
      ...resolvedCustomMetrics.filter(m => m !== undefined),
    );
  }

  /**
   * Write raw output to filesystem
   *
   * Credits to https://github.com/ctrf-io/playwright-ctrf-json-report
   */
  private writeReportToFile(): void {
    const filePath = path.join(this.options.outputDir, this.options.outputFile);
    const output = JSON.stringify(this.results, null, 2);
    try {
      fs.writeFileSync(filePath, output + '\n', {flag: 'ax'});
      console.log(
        'Playwright-Performance-Reporter: successfully written json to %s/%s',
        this.options.outputDir,
        this.options.outputFile,
      );
    } catch (error) {
      console.error(`Error writing json report:, ${String(error)}`);
    }
  }
}

