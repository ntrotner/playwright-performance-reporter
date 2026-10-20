import {
  EventEmitter,
} from 'node:events';
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
  type Options,
  type SupportedBrowsers,
  type Hooks,
  type HookOrder,
  HookOrderToMetricOrder,
  HookOrderToMeasurementOrder,
  HookOrderToMeasurementOffsetOrder,
  testCaseParent,
  type ResultAccumulator,
  type PresenterWriter,
  type BrowserDeveloperToolsClient,
  type MetricObserver,
  type MetricSampling,
  type BudgetSample,
} from '../types/index.js';
import {
  evaluateBudgets,
  formatBudgetViolation,
  validateBudgetRules,
  buildTestCaseIdentifier,
  buildTestPerformance,
  buildTestStepIdentifier,
  Logger,
} from '../helpers/index.js';
import {
  nativePresenters,
} from '../presenters/index.js';
import {
  MetricsEngine,
} from './index.js';

export class PerformanceReporter implements Reporter {
  /**
   * Maps unique playwright test ids to the computed name
   */
  private readonly idToNameMapping = new Map<string, string>();

  /*
   * Metrics engine to retrieve metrics from a browser
   */
  private readonly metricsEngine: MetricsEngine;

  /**
   * Writers to stream data to different outputs
   */
  private readonly presenters: PresenterWriter[];

  /**
   * Latest test step identifier
   */
  private latestStepId: string | undefined;

  /**
   * Latest case identifier
   */
  private latestCaseId: string | undefined;

  /**
   * Latest test name
   */
  private latestName: string | undefined;

  /**
   * Reference to the unsubscribe function for a hook and test id
   */
  private readonly samplingRunner = new Map<Hooks, Map<string, () => void>>([
    ['onTest', new Map()],
    ['onTestStep', new Map()],
  ]);

  /**
   * Final metrics of tests and steps, used to evaluate budgets
   */
  private readonly budgetStore: BudgetSample[] = [];

  /**
   * Hooks that ran or are still running, in the order Playwright called them.
   * Playwright doesn't await the hooks, so without the queue the start of a step could run
   * while the stop of the previous step is still measuring, or the test end could close the
   * connection before the last step was measured.
   */
  private hookQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: Options) {
    if (options.maxListeners !== undefined) {
      EventEmitter.setMaxListeners(options.maxListeners);
    }

    if (options.budgets) {
      validateBudgetRules(options.budgets.rules);
    }

    this.metricsEngine = new MetricsEngine();
    this.presenters = options.presenters && options.presenters.length > 0
      ? options.presenters
      : [
        new nativePresenters.jsonChunkPresenter({
          outputDir: './',
          outputFile: `performance-report-${Date.now()}.json`,
        }),
      ];
  }

  onBegin(config: FullConfig, suite: Suite) {}

  async onEnd(result: FullResult) {
    // Playwright doesn't await the other hooks, so the last test can still be measured
    await this.hookQueue;

    // Enforce budgets before closing presenters, so a failing presenter can't skip it
    this.enforceBudgets(result);

    let closeStatus: boolean;

    try {
      closeStatus = await this.closePresenters();
    } catch {
      closeStatus = false;
    }

    if (!closeStatus) {
      Logger.error('Error writing report');
      return {status: result.status};
    }

    if (result.status !== 'passed' && this.options.deleteOnFailure) {
      await this.deleteFromPresenters();
      Logger.info('Test failed and file deleted');
    } else {
      Logger.info('Successfully closed presenters');
    }

    return {status: result.status};
  }

  async onTestBegin(test: TestCase, result: TestResult) {
    return this.enqueue(async () => this.measureTestBegin(test, result));
  }

  async onTestEnd(test: TestCase, result: TestResult) {
    return this.enqueue(async () => this.measureTestEnd(test, result));
  }

  async onStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    return this.enqueue(async () => this.measureStepBegin(test, result, step));
  }

  async onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    return this.enqueue(async () => this.measureStepEnd(test, result, step));
  }

  /**
   * Measure the start of a test and start its sampling
   */
  private async measureTestBegin(test: TestCase, result: TestResult) {
    const browserDetails = test.parent.project()?.use;
    if (browserDetails && browserDetails.defaultBrowserType) {
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

    this.latestCaseId = id;
    this.latestStepId = testCaseParent;
    this.latestName = name;

    const results = this.createTestPerformance(id, testCaseParent, name);
    await this.executeMetrics(results, id, testCaseParent, 'onTest', 'onStart', browserName);
    await this.writeToPresenters(results);

    const samplingResults = this.createTestPerformance(id, testCaseParent, name);
    await this.executeMetrics(samplingResults, id, testCaseParent, 'onTest', 'onSampling', browserName);
  }

  /**
   * Measure the end of a test and close the connection to the browser
   */
  private async measureTestEnd(test: TestCase, result: TestResult) {
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

    this.destroySamplingRunner(id, testCaseParent, 'onTest');
    const results = this.createTestPerformance(id, testCaseParent, name);
    await this.executeMetrics(results, id, testCaseParent, 'onTest', 'onStop', browserName);
    this.captureFinalMetrics(results);
    this.metricsEngine.destroy();
    await this.writeToPresenters(results);
  }

  /**
   * Measure the start of a step and start its sampling
   */
  private async measureStepBegin(test: TestCase, result: TestResult, step: TestStep) {
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

    this.latestCaseId = caseIdentifier.id;
    this.latestStepId = stepIdentifier.id;
    this.latestName = stepIdentifier.name;

    const results = this.createTestPerformance(caseIdentifier.id, stepIdentifier.id, stepIdentifier.name);
    await this.executeMetrics(results, caseIdentifier.id, stepIdentifier.id, 'onTestStep', 'onStart', browserName);
    await this.writeToPresenters(results);

    const samplingResults = this.createTestPerformance(caseIdentifier.id, stepIdentifier.id, stepIdentifier.name);
    await this.executeMetrics(samplingResults, caseIdentifier.id, stepIdentifier.id, 'onTestStep', 'onSampling', browserName);
  }

  /**
   * Measure the end of a step
   */
  private async measureStepEnd(test: TestCase, result: TestResult, step: TestStep) {
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

    this.destroySamplingRunner(caseIdentifier.id, stepIdentifier.id, 'onTestStep');
    const results = this.createTestPerformance(caseIdentifier.id, stepIdentifier.id, stepIdentifier.name);
    await this.executeMetrics(results, caseIdentifier.id, stepIdentifier.id, 'onTestStep', 'onStop', browserName);
    this.captureFinalMetrics(results);
    await this.writeToPresenters(results);
  }

  /**
   * Run a hook after all hooks that were called before it
   *
   * @param hook measurement of the hook
   */
  private async enqueue(hook: () => Promise<void>): Promise<void> {
    const previous = this.hookQueue;
    const running = (async () => {
      await previous;
      await hook();
    })();

    // A failing hook must not stop the following hooks
    this.hookQueue = (async () => {
      try {
        await running;
      } catch {}
    })();

    return running;
  }

  /**
   * Write data to all presenters concurrently
   *
   * @param content the content to write
   */
  private async writeToPresenters(content: ResultAccumulator): Promise<void> {
    await Promise.allSettled(this.presenters.map(async presenter => presenter.write(content)));
  }

  /**
   * Close all presenters
   */
  private async closePresenters(): Promise<boolean> {
    const status = await Promise.allSettled(this.presenters.map(async presenter => presenter.close()));

    return status.every(result => result.status === 'fulfilled');
  }

  /**
   * Delete files from all presenters
   */
  private async deleteFromPresenters(): Promise<void> {
    await Promise.allSettled(this.presenters.map(async presenter => presenter.delete()));
  }

  /**
   * Retain the final metrics that budgets refer to, without keeping large payloads like heap dumps in memory
   *
   * @param results result accumulator after the 'onStop' measurement
   */
  private captureFinalMetrics(results: ResultAccumulator) {
    if (!this.options.budgets) {
      return;
    }

    const budgetMetrics = this.options.budgets.rules.map(rule => rule.metric);
    for (const steps of Object.values(results)) {
      for (const performance of Object.values(steps)) {
        for (const targetMetric of performance.stopMetrics) {
          const metric = Object.fromEntries(budgetMetrics
            .filter(key => Object.hasOwn(targetMetric.metric, key))
            .map(key => [key, targetMetric.metric[key]]));
          this.budgetStore.push({name: performance.name, metric});
        }
      }
    }
  }

  /**
   * Evaluate budgets and fail the run on violations, if configured.
   * The status is also returned from `onEnd`, as Playwright may pass a copy of the result.
   *
   * @param result result of the full test run
   */
  private enforceBudgets(result: FullResult) {
    if (!this.options.budgets) {
      return;
    }

    try {
      const shouldFail = (this.options.budgets.onViolation ?? 'fail') === 'fail';
      const violations = evaluateBudgets(this.budgetStore, this.options.budgets.rules);
      for (const violation of violations) {
        if (shouldFail) {
          Logger.error(formatBudgetViolation(violation));
        } else {
          Logger.warning(formatBudgetViolation(violation));
        }
      }

      if (shouldFail && violations.length > 0 && result.status === 'passed') {
        result.status = 'failed';
      }
    } catch (error) {
      Logger.error('Error evaluating budgets', String(error));
    }
  }

  /**
   * Add new `TestPerformance` with identifier
   *
   * @param caseId identifier for case
   * @param stepId identifier for step
   * @param name human friendly identifier
   */
  private createTestPerformance(caseId: string, stepId: string, name: string): ResultAccumulator {
    this.idToNameMapping.set(caseId, name);
    return {
      [caseId]: {
        [stepId]: buildTestPerformance(name),
      },
    };
  }

  /**
   * Destroys sampling for metrics
   *
   * @param caseId identifier for case
   * @param stepId identifier for step
   * @param hook playwright hook
   */
  private destroySamplingRunner(caseId: string, stepId: string, hook: Hooks) {
    this.samplingRunner.get(hook)?.get(caseId + stepId)?.call(this);
    this.samplingRunner.get(hook)?.delete(caseId + stepId);
  }

  /**
   * Execute metrics gathering for metrics
   *
   * @param results result accumulator
   * @param caseId identifier for case
   * @param stepId identifier for step
   * @param hook playwright hook
   * @param hookOrder playwright hook order
   * @param browser which settings and metrics to use
   */
  private async executeMetrics(results: ResultAccumulator, caseId: string, stepId: string, hook: Hooks, hookOrder: HookOrder, browser: SupportedBrowsers) {
    if (hookOrder === 'onSampling') {
      await this.executeSamplingMetrics(results, caseId, stepId, hook, browser);
      return;
    }

    const metrics = (this.options.browsers[browser]?.[hook]?.metrics ?? []) as Array<MetricObserver<BrowserDeveloperToolsClient[SupportedBrowsers]>>;
    if (metrics.length > 0) {
      Logger.info('Fetching metrics', ...metrics.map(m => m.name));
    }

    const startOfTrigger = Date.now();
    const metricsPromises = metrics.map(async metric => this.metricsEngine.getMetric(metric, hookOrder));

    const resolvedMetrics = await Promise.all(metricsPromises);
    const endOfTrigger = Date.now();

    results[caseId][stepId][HookOrderToMeasurementOrder[hookOrder]] = endOfTrigger;
    results[caseId][stepId][HookOrderToMeasurementOffsetOrder[hookOrder]] = endOfTrigger - startOfTrigger;
    results[caseId][stepId][HookOrderToMetricOrder[hookOrder]].push(...resolvedMetrics.filter(m => m !== undefined).flat());
  }

  /**
   * Setup sampling for metrics
   *
   * @param results result accumulator
   * @param caseId identifier for case
   * @param stepId identifier for step
   * @param hook playwright hook
   * @param browser which settings and metrics to use
   */
  private async executeSamplingMetrics(results: ResultAccumulator, caseId: string, stepId: string, hook: Hooks, browser: SupportedBrowsers) {
    const samplingConfig = this.options.browsers[browser]?.sampling?.metrics as Array<MetricSampling<BrowserDeveloperToolsClient[SupportedBrowsers]>>;
    if (!samplingConfig) {
      return;
    }

    const samplingArguments: Array<{callback: () => Promise<void>; delay: number}> = samplingConfig.map(samplingItem => ({
      callback: async () => {
        const startOfTrigger = Date.now();
        const metricsResponse = await this.metricsEngine.getMetric(samplingItem.metric, 'onSampling');
        const endOfTrigger = Date.now();

        if (metricsResponse && this.latestCaseId && this.latestStepId && this.latestName) {
          const clonedResults = structuredClone(results);

          clonedResults[this.latestCaseId] ||= {};
          clonedResults[this.latestCaseId][this.latestStepId] ||= buildTestPerformance(this.latestName);
          clonedResults[this.latestCaseId][this.latestStepId][HookOrderToMeasurementOrder.onStop] = endOfTrigger;
          clonedResults[this.latestCaseId][this.latestStepId][HookOrderToMeasurementOffsetOrder.onStop] = endOfTrigger - startOfTrigger;
          clonedResults[this.latestCaseId][this.latestStepId].samplingMetrics.push(...metricsResponse);

          await this.writeToPresenters(clonedResults);
        }
      },
      delay: samplingItem.samplingTimeoutInMilliseconds,
    }));

    const intervals = samplingArguments
      .filter(Boolean)
      .map(sampling => setInterval(sampling.callback, sampling.delay));

    // Clear every interval of the test or step, not only the last one
    this.samplingRunner.get(hook)?.set(caseId + stepId, () => {
      for (const interval of intervals) {
        clearInterval(interval);
      }
    });
  }
}

