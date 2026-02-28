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
} from '../types/index.js';
import {
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
   * Reference to the unsubscribe function for a hook and test id
   */
  private readonly samplingRunner = new Map<Hooks, Map<string, () => void>>([
    ['onTest', new Map()],
    ['onTestStep', new Map()],
  ]);

  constructor(private readonly options: Options) {
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
    let closeStatus: boolean;

    try {
      closeStatus = await this.closePresenters();
    } catch {
      closeStatus = false;
    }

    if (!closeStatus) {
      Logger.error('Error writing report');
      return;
    }

    if (result.status !== 'passed' && this.options.deleteOnFailure) {
      await this.deleteFromPresenters();
      Logger.info('Test failed and file deleted');
    } else {
      Logger.info('Successfully closed presenters');
    }
  }

  async onTestBegin(test: TestCase, result: TestResult) {
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

    const results = this.createTestPerformance(id, testCaseParent, name);
    await this.executeMetrics(results, id, testCaseParent, 'onTest', 'onStart', browserName);
    await this.writeToPresenters(results);

    const samplingResults = this.createTestPerformance(id, testCaseParent, name);
    await this.executeMetrics(samplingResults, id, testCaseParent, 'onTest', 'onSampling', browserName);
  }

  async onTestEnd(test: TestCase, result: TestResult) {
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
    this.metricsEngine.destroy();
    await this.writeToPresenters(results);
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

    const results = this.createTestPerformance(caseIdentifier.id, stepIdentifier.id, stepIdentifier.name);
    await this.executeMetrics(results, caseIdentifier.id, stepIdentifier.id, 'onTestStep', 'onStart', browserName);
    await this.writeToPresenters(results);

    const samplingResults = this.createTestPerformance(caseIdentifier.id, stepIdentifier.id, stepIdentifier.name);
    await this.executeMetrics(samplingResults, caseIdentifier.id, stepIdentifier.id, 'onTestStep', 'onSampling', browserName);
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

    this.destroySamplingRunner(caseIdentifier.id, stepIdentifier.id, 'onTestStep');
    const results = this.createTestPerformance(caseIdentifier.id, stepIdentifier.id, stepIdentifier.name);
    await this.executeMetrics(results, caseIdentifier.id, stepIdentifier.id, 'onTestStep', 'onStop', browserName);
    await this.writeToPresenters(results);
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

        if (metricsResponse) {
          results[caseId][stepId][HookOrderToMeasurementOrder.onStop] = endOfTrigger;
          results[caseId][stepId][HookOrderToMeasurementOffsetOrder.onStop] = endOfTrigger - startOfTrigger;
          const clonedResults = structuredClone(results);
          clonedResults[caseId][stepId].samplingMetrics.push(...metricsResponse);
          await this.writeToPresenters(clonedResults);
        }
      },
      delay: samplingItem.samplingTimeoutInMilliseconds,
    }));

    for (const sampling of samplingArguments) {
      if (!sampling) {
        continue;
      }

      const interval = setInterval(sampling.callback, sampling.delay);
      this.samplingRunner.get(hook)?.set(caseId + stepId, () => {
        clearInterval(interval);
      });
    }
  }
}

