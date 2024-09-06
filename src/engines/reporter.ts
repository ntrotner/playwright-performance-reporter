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
  testCaseParent,
} from '../types/index.js';
import {
  buildTestCaseIdentifier,
  buildTestPerformance,
  buildTestStepIdentifier,
  writeReportToFile,
} from '../helpers/index.js';
import {MetricsEngine} from './index.js';

export class PerformanceReporter implements Reporter {
  /**
   * Accumulation of all test cases
   */
  public results: Record<string, Record<string, TestPerformance>> = {};

  /**
   * Maps unique playwright test ids to the computed name
   */
  private readonly idToNameMapping = new Map<string, string>();

  /*
   * Metrics engine to retrieve metrics from a browser
   */
  private readonly metricsEngine: MetricsEngine;

  constructor(private readonly options: Options) {
    this.metricsEngine = new MetricsEngine();
  }

  onBegin(config: FullConfig, suite: Suite) {}

  onEnd(result: FullResult) {
    writeReportToFile({...this.options, content: this.results});
  }

  async onTestBegin(test: TestCase, result: TestResult) {
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

    const {id, name} = buildTestCaseIdentifier(test);
    if (id === '') {
      // Root of test suite
      return;
    }

    this.registerTestPerformance(id, testCaseParent, name);
    await this.executeMetrics(id, testCaseParent, 'onTest', 'onStart', browserName);
  }

  async onTestEnd(test: TestCase, result: TestResult) {
    const browserName = this.metricsEngine.getBrowser();
    if (!browserName) {
      // Browser not stable
      return;
    }

    const {id} = buildTestCaseIdentifier(test);
    if (id === '') {
      // Root of test suite
      return;
    }

    await this.executeMetrics(id, testCaseParent, 'onTest', 'onStop', browserName);
    this.metricsEngine.destroy();
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

    const caseIdentifier = buildTestCaseIdentifier(test);
    const stepIdentifier = buildTestStepIdentifier(step);
    if (stepIdentifier.name === '') {
      // Root of test suite
      return;
    }

    this.registerTestPerformance(caseIdentifier.id, stepIdentifier.id, stepIdentifier.name);
    await this.executeMetrics(caseIdentifier.id, stepIdentifier.id, 'onTestStep', 'onStart', browserName);
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

    const caseIdentifier = buildTestCaseIdentifier(test);
    const stepIdentifier = buildTestStepIdentifier(step);
    if (stepIdentifier.name === '') {
      // Root of test suite
      return;
    }

    await this.executeMetrics(caseIdentifier.id, stepIdentifier.id, 'onTestStep', 'onStop', browserName);
  }

  /**
   * Add new `TestPerformance` with identifier
   *
   * @param caseId identifier for case
   * @param stepId identifier for step
   * @param name human friendly identifier
   */
  private registerTestPerformance(caseId: string, stepId: string, name: string) {
    this.idToNameMapping.set(caseId, name);
    this.results[caseId] ||= {};
    this.results[caseId][stepId] ||= buildTestPerformance(name);
  }

  /**
   * Execute metrics gathering for existing metrics and custom metrics
   *
   * @param caseId identifier for case
   * @param stepId identifier for step
   * @param hook playwright hook
   * @param hookOrder playwright hook order
   * @param browser which settings and metrics to use
   */
  private async executeMetrics(caseId: string, stepId: string, hook: Hooks, hookOrder: HookOrder, browser: SupportedBrowsers) {
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

    this.results[caseId][stepId][HookOrderToMeasurementOrder[hookOrder]] = Date.now();
    this.results[caseId][stepId][HookOrderToMeasurementOffsetOrder[hookOrder]] = endOfTrigger - startOfTrigger;
    this.results[caseId][stepId][HookOrderToMetricOrder[hookOrder]].push(
      ...resolvedMetrics.filter(m => m !== undefined),
      ...resolvedCustomMetrics.filter(m => m !== undefined),
    );
  }
}

