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
  type Metrics,
  type ResultAccumulator,
  type JsonWriter,
} from '../types/index.js';
import {
  buildTestCaseIdentifier,
  buildTestPerformance,
  buildTestStepIdentifier,
  JsonChunkWriter,
  Logger,
} from '../helpers/index.js';
import {MetricsEngine} from './index.js';

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

  onEnd(result: FullResult) {
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
      this.jsonChunkWriter.delete();
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
    await this.executeMetrics(results, id, testCaseParent, 'onTest', 'onSampling', browserName);
    this.jsonChunkWriter.write(results);
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
    this.jsonChunkWriter.write(results);
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
    await this.executeMetrics(results, caseIdentifier.id, stepIdentifier.id, 'onTestStep', 'onSampling', browserName);
    this.jsonChunkWriter.write(results);
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
    this.jsonChunkWriter.write(results);
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
   * Execute metrics gathering for existing metrics and custom metrics
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

    if (this.options.browsers[browser]?.[hook]?.metrics.length) {
      Logger.info('Fetching predefined metrics', ...this.options.browsers[browser][hook].metrics);
    }

    const startOfTrigger = Date.now();
    const metrics = Promise.all(
      this.options.browsers[browser]?.[hook]?.metrics.map(async metric => this.metricsEngine.getMetric(metric, hookOrder)) ?? [],
    );

    if (this.options.browsers[browser]?.[hook]?.customMetrics) {
      Logger.info('Fetching custom metrics', ...Object.values(this.options.browsers[browser][hook].customMetrics).map(({name}) => name));
    }

    const customMetrics = Promise.all(
      Object.values(this.options.browsers[browser]?.[hook]?.customMetrics ?? {})
        .map(async customMetric =>
          this.metricsEngine.runCustomMetric(customMetric, hookOrder),
        ) || [],
    );

    const resolvedMetrics = await metrics;
    const resolvedCustomMetrics = await customMetrics;
    const endOfTrigger = Date.now();

    results[caseId][stepId][HookOrderToMeasurementOrder[hookOrder]] = endOfTrigger;
    results[caseId][stepId][HookOrderToMeasurementOffsetOrder[hookOrder]] = endOfTrigger - startOfTrigger;
    results[caseId][stepId][HookOrderToMetricOrder[hookOrder]].push(
      ...resolvedMetrics.filter(m => m !== undefined).flat(),
      ...resolvedCustomMetrics.filter(m => m !== undefined).flat(),
    );
  }

  /**
   * Setup sampling for existing metrics and custom metrics
   *
   * @param results result accumulator
   * @param caseId identifier for case
   * @param stepId identifier for step
   * @param hook playwright hook
   * @param browser which settings and metrics to use
   */
  private async executeSamplingMetrics(results: ResultAccumulator, caseId: string, stepId: string, hook: Hooks, browser: SupportedBrowsers) {
    const sampleMetrics = this.options.browsers[browser]?.[hook]?.sampleMetrics;
    if (!sampleMetrics) {
      return;
    }

    const samplingArguments: Array<[() => Promise<void>, number] | undefined> = Object.entries(sampleMetrics).map(([metricName, metricSampling]) => {
      const registeredMetrics = this.options.browsers[browser]?.[hook]?.metrics;
      const customMetrics = this.options.browsers[browser]?.[hook]?.customMetrics;
      const isPredefinedMetric = (registeredMetrics ?? []).find(registeredMetric => registeredMetric === metricName);
      const isCustomMetric = Object.values(customMetrics ?? {}).find(value => value.name === metricName);

      if (registeredMetrics && isPredefinedMetric) {
        return [
          async () => {
            const metricsResponse = await this.metricsEngine.getMetric(metricName as Metrics, 'onSampling');

            if (metricsResponse) {
              results[caseId][stepId].samplingMetrics.push(...metricsResponse);
            }
          },
          metricSampling.samplingTimeoutInMilliseconds,
        ];
      }

      if (customMetrics && isCustomMetric) {
        return [
          async () => {
            const metricsResponse = await this.metricsEngine.runCustomMetric(customMetrics[metricName], 'onSampling');

            if (metricsResponse) {
              results[caseId][stepId].samplingMetrics.push(...metricsResponse);
            }
          },
          metricSampling.samplingTimeoutInMilliseconds,
        ];
      }

      return undefined;
    });

    for (const sampling of samplingArguments) {
      if (!sampling) {
        continue;
      }

      const interval = setInterval(...sampling);
      this.samplingRunner.get(hook)?.set(caseId + stepId, () => {
        clearInterval(interval);
      });
    }
  }
}

