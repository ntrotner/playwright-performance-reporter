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
  type JsonWriter,
  type MetricObserver,
} from '../types/index.js';
import {
  buildTestCaseIdentifier,
  buildTestPerformance,
  buildTestStepIdentifier,
  JsonChunkWriter,
  Logger,
} from '../helpers/index.js';
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
   * Writer to stream json chunks
   */
  private readonly jsonChunkWriter: JsonWriter;

  /**
   * Reference to the unsubscribe function for a hook and test id
   */
  private readonly samplingRunner = new Map<Hooks, Map<string, () => void>>([
    ['onTest', new Map()],
    ['onTestStep', new Map()],
  ]);

  constructor(private readonly options: Options) {
    this.metricsEngine = new MetricsEngine();
    this.jsonChunkWriter = options.customJsonWriter ? options.customJsonWriter : new JsonChunkWriter();
    this.jsonChunkWriter.initialize(this.options);
  }

  onBegin(config: FullConfig, suite: Suite) {}

  async onEnd(result: FullResult) {
    try {
      this.jsonChunkWriter.close();
    } catch (error) {
      Logger.error(
        'Error writing json report',
        String(error),
      );
      return;
    }

    if (result.status !== 'passed' && this.options.deleteOnFailure) {
      await this.jsonChunkWriter.delete();
      Logger.info(
        'Test failed and file deleted',
        this.options.outputDir,
        this.options.outputFile,
      );
    } else {
      Logger.info(
        'Successfully written to json',
        this.options.outputDir,
        this.options.outputFile,
      );
    }
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

    const results = this.createTestPerformance(id, testCaseParent, name);
    await this.executeMetrics(results, id, testCaseParent, 'onTest', 'onStart', browserName);
    await this.jsonChunkWriter.write(results);

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
    await this.jsonChunkWriter.write(results);
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
    await this.jsonChunkWriter.write(results);

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
    await this.jsonChunkWriter.write(results);
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

    const metrics = this.options.browsers[browser]?.[hook]?.metrics ?? [];
    if (metrics.length > 0) {
      Logger.info('Fetching metrics', ...metrics.map(m => m.name));
    }

    const startOfTrigger = Date.now();
    const metricsPromises = metrics.map(async (metric: MetricObserver) =>
      this.metricsEngine.getMetric(metric, hookOrder),
    );

    const resolvedMetrics = await Promise.all(metricsPromises);
    const endOfTrigger = Date.now();

    results[caseId][stepId][HookOrderToMeasurementOrder[hookOrder]] = endOfTrigger;
    results[caseId][stepId][HookOrderToMeasurementOffsetOrder[hookOrder]] = endOfTrigger - startOfTrigger;
    results[caseId][stepId][HookOrderToMetricOrder[hookOrder]].push(
      ...resolvedMetrics.filter(m => m !== undefined).flat(),
    );
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
    const samplingConfig = this.options.browsers[browser]?.sampling?.metrics;
    if (!samplingConfig) {
      return;
    }

    const samplingArguments: Array<{callback: () => Promise<void>; delay: number}> = samplingConfig.map(samplingItem => ({
      callback: async () => {
        const metricsResponse = await this.metricsEngine.getMetric(samplingItem.metric, 'onSampling');

        if (metricsResponse) {
          const clonedResults = structuredClone(results);
          clonedResults[caseId][stepId].samplingMetrics.push(...metricsResponse);
          await this.jsonChunkWriter.write(clonedResults);
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

