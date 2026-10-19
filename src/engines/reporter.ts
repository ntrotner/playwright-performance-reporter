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
  defaultDebuggingPort,
} from '../fixture/index.js';
import {
  MetricsEngine,
} from './index.js';

/**
 * Playwright hook of a measurement
 */
type HookKind = 'testBegin' | 'stepBegin' | 'stepEnd' | 'testEnd';

/**
 * Hooks that may measure concurrently when Playwright calls them one after another, e.g. the ends of nested steps
 */
const concurrentHookKinds = new Set<HookKind>(['stepBegin', 'stepEnd']);

/**
 * Browser connection and active test or step of a worker
 */
type WorkerContext = {
  metricsEngine: MetricsEngine;
  latestCaseId?: string;
  latestStepId?: string;
  latestName?: string;

  /**
   * Hooks of the worker that ran or are still running, in the order Playwright called them.
   * Playwright doesn't await the hooks, so without the queue the start of a step could run
   * while the stop of the previous step is still measuring, or the test end could close the
   * connection before the last step was measured.
   */
  hookQueue: Promise<void>;

  /**
   * Consecutive hooks of the same kind, which start after all hooks of the worker before them
   */
  hookBatch?: {kind: HookKind; start: Promise<void>};
};

export class PerformanceReporter implements Reporter {
  /**
   * Maps unique playwright test ids to the computed name
   */
  private readonly idToNameMapping = new Map<string, string>();

  /*
   * Metrics engine to retrieve metrics from the browser of the first worker
   */
  private readonly metricsEngine: MetricsEngine;

  /**
   * Browser connection and active test or step per worker.
   * Without `debuggingPort.perWorker`, every test uses the context of the first worker.
   */
  private readonly workers = new Map<number, WorkerContext>();

  /**
   * Maps unique playwright test ids to the context of the worker that runs the test
   */
  private readonly caseToWorker = new Map<string, WorkerContext>();

  /**
   * Writers to stream data to different outputs
   */
  private readonly presenters: PresenterWriter[];

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
    await Promise.all([...this.workers.values()].map(async worker => worker.hookQueue));

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
    return this.enqueue(this.getWorker(result), 'testBegin', async () => this.measureTestBegin(test, result));
  }

  async onTestEnd(test: TestCase, result: TestResult) {
    return this.enqueue(this.getWorker(result), 'testEnd', async () => this.measureTestEnd(test, result));
  }

  async onStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    return this.enqueue(this.getWorker(result), 'stepBegin', async () => this.measureStepBegin(test, result, step));
  }

  async onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    return this.enqueue(this.getWorker(result), 'stepEnd', async () => this.measureStepEnd(test, result, step));
  }

  /**
   * Measure the start of a test and start its sampling
   */
  private async measureTestBegin(test: TestCase, result: TestResult) {
    const worker = this.getWorker(result);
    const browserDetails = test.parent.project()?.use;
    if (browserDetails && browserDetails.defaultBrowserType) {
      try {
        await worker.metricsEngine.setupBrowser(browserDetails.defaultBrowserType, this.withDebuggingPort(browserDetails, result));
      } catch {}
    }

    const browserName = worker.metricsEngine.getBrowser();
    if (!browserName) {
      // Browser not stable
      return;
    }

    const {id, name} = buildTestCaseIdentifier(test);
    if (id === '') {
      // Root of test suite
      return;
    }

    this.caseToWorker.set(id, worker);
    worker.latestCaseId = id;
    worker.latestStepId = testCaseParent;
    worker.latestName = name;

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
    const worker = this.getWorker(result);
    const browserName = worker.metricsEngine.getBrowser();
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
    worker.metricsEngine.destroy();
    this.caseToWorker.delete(id);
    await this.writeToPresenters(results);
  }

  /**
   * Measure the start of a step and start its sampling
   */
  private async measureStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    const worker = this.getWorker(result);
    const browserName = worker.metricsEngine.getBrowser();
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

    worker.latestCaseId = caseIdentifier.id;
    worker.latestStepId = stepIdentifier.id;
    worker.latestName = stepIdentifier.name;

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
    const browserName = this.getWorker(result).metricsEngine.getBrowser();
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
   * Run a hook after all hooks of the worker that were called before it.
   * Consecutive step begins or step ends run concurrently, as nested steps begin and end at the same time,
   * e.g. the end of an outer step doesn't wait for the end of its inner step while the page closes.
   *
   * @param worker context of the worker that runs the test
   * @param kind kind of the hook
   * @param hook measurement of the hook
   */
  private async enqueue(worker: WorkerContext, kind: HookKind, hook: () => Promise<void>): Promise<void> {
    if (worker.hookBatch?.kind !== kind || !concurrentHookKinds.has(kind)) {
      worker.hookBatch = {kind, start: worker.hookQueue};
    }

    const {start} = worker.hookBatch;
    const running = (async () => {
      await start;
      await hook();
    })();

    // A failing hook must not stop the following hooks
    const previous = worker.hookQueue;
    worker.hookQueue = (async () => {
      await previous;
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

    const {metricsEngine} = this.getWorkerOfCase(caseId);
    const startOfTrigger = Date.now();
    const metricsPromises = metrics.map(async metric => metricsEngine.getMetric(metric, hookOrder));

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

    const worker = this.getWorkerOfCase(caseId);
    const samplingArguments: Array<{callback: () => Promise<void>; delay: number}> = samplingConfig.map(samplingItem => ({
      callback: async () => {
        const startOfTrigger = Date.now();
        const metricsResponse = await worker.metricsEngine.getMetric(samplingItem.metric, 'onSampling');
        const endOfTrigger = Date.now();

        // The worker runs one test at a time, so its latest test or step is the one being sampled
        const {latestCaseId, latestStepId, latestName} = worker;
        if (metricsResponse && latestCaseId && latestStepId && latestName) {
          const clonedResults = structuredClone(results);

          clonedResults[latestCaseId] ||= {};
          clonedResults[latestCaseId][latestStepId] ||= buildTestPerformance(latestName);
          clonedResults[latestCaseId][latestStepId][HookOrderToMeasurementOrder.onStop] = endOfTrigger;
          clonedResults[latestCaseId][latestStepId][HookOrderToMeasurementOffsetOrder.onStop] = endOfTrigger - startOfTrigger;
          clonedResults[latestCaseId][latestStepId].samplingMetrics.push(...metricsResponse);

          await this.writeToPresenters(clonedResults);
        }
      },
      delay: samplingItem.samplingTimeoutInMilliseconds,
    }));

    // Every sampling metric has its own interval, which all have to be cleared at the end of the test or step
    const intervals = samplingArguments.map(sampling => setInterval(sampling.callback, sampling.delay));
    this.samplingRunner.get(hook)?.set(caseId + stepId, () => {
      for (const interval of intervals) {
        clearInterval(interval);
      }
    });
  }

  /**
   * Context of the worker that runs a test
   *
   * @param result result of the test, which contains the parallel index of the worker
   */
  private getWorker(result: TestResult): WorkerContext {
    const index = this.options.debuggingPort?.perWorker ? result.parallelIndex : 0;
    let worker = this.workers.get(index);
    if (!worker) {
      worker = {metricsEngine: index === 0 ? this.metricsEngine : new MetricsEngine(), hookQueue: Promise.resolve()};
      this.workers.set(index, worker);
    }

    return worker;
  }

  /**
   * Context of the worker that runs a test, falling back to the first worker
   *
   * @param caseId identifier for case
   */
  private getWorkerOfCase(caseId: string): WorkerContext {
    return this.caseToWorker.get(caseId) ?? this.getWorker({parallelIndex: 0} as TestResult);
  }

  /**
   * Point the browser connection to the debugging port of the worker
   *
   * @param browserDetails project settings of playwright
   * @param result result of the test, which contains the parallel index of the worker
   */
  private withDebuggingPort(browserDetails: Record<string, any>, result: TestResult): Record<string, any> {
    const {debuggingPort} = this.options;
    if (!debuggingPort?.perWorker) {
      return browserDetails;
    }

    const launchOptions = browserDetails.launchOptions as {args?: string[]} | undefined;
    const args = launchOptions?.args ?? [];
    const configuredPort = args.find(argument => argument.startsWith('--remote-debugging-port='))?.split('=')[1];
    const base = debuggingPort.base ?? (configuredPort ? Number(configuredPort) : defaultDebuggingPort);

    return {
      ...browserDetails,
      launchOptions: {
        ...launchOptions,
        args: [...args.filter(argument => !argument.startsWith('--remote-debugging-port')), `--remote-debugging-port=${base + result.parallelIndex}`],
      },
    };
  }
}

