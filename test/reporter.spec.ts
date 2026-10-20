import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  type FullProject,
  type FullResult,
  type Suite,
  type TestCase,
  type TestResult,
  type TestStep,
} from '@playwright/test/reporter';
import PlaywrightPerformanceReporter, {
  nativeChromiumObservers,
  nativePresenters,
} from '../src/index.js';
import {
  type Options,
  type PresenterWriter,
} from '../src/types/options.js';
import {
  type BudgetRule,
  type BudgetSample,
} from '../src/types/index.js';
import {
  Logger,
} from '../src/helpers/index.js';
import {
  MetricsEngineFixture,
} from './fixtures/metrics.fixture.js';

const mockSuite: Suite = {
  allTests(): TestCase[] {
    return [mockTestCase];
  },
  entries(): Array<TestCase | Suite> {
    return [mockTestCase];
  },
  project(): FullProject | undefined {
    return undefined;
  },
  titlePath(): string[] {
    return ['path'];
  },
  suites: [],
  tests: [],
  title: '',
  type: 'project',
};

const mockTestCaseRoot: TestCase = {
  ok(): boolean {
    return true;
  },
  outcome(): 'skipped' | 'expected' | 'unexpected' | 'flaky' {
    return 'expected';
  },
  titlePath(): string[] {
    return ['title', 'path'];
  },
  annotations: [],
  expectedStatus: 'passed',
  id: '',
  location: {
    column: 0,
    file: 'file/path',
    line: 0,
  },
  parent: mockSuite,
  repeatEachIndex: 0,
  results: [],
  retries: 0,
  tags: [],
  timeout: 0,
  title: '',
  type: 'test',
};

const mockTestCase: TestCase = {
  ok(): boolean {
    return true;
  },
  outcome(): 'skipped' | 'expected' | 'unexpected' | 'flaky' {
    return 'expected';
  },
  titlePath(): string[] {
    return ['title', 'path'];
  },
  annotations: [],
  expectedStatus: 'passed',
  id: '1f',
  location: {
    column: 0,
    file: 'file/path',
    line: 0,
  },
  parent: mockSuite,
  repeatEachIndex: 0,
  results: [],
  retries: 0,
  tags: [],
  timeout: 0,
  title: 'Parent Test Case',
  type: 'test',
};

const mockTestStep: TestStep = {
  annotations: [],
  attachments: [],
  titlePath(): string[] {
    return ['file', 'path'];
  },
  category: 'test.step',
  duration: 0,
  startTime: new Date(0),
  steps: [],
  title: 'Child Test Step',
};

const mockTestStepEmptyStepName: TestStep = {
  annotations: [],
  attachments: [],
  titlePath(): string[] {
    return ['file', 'path'];
  },
  category: '',
  duration: 0,
  startTime: new Date(0),
  steps: [],
  title: '',
};

const mockTestResult: TestResult = {
  annotations: [],
  attachments: [],
  duration: 0,
  errors: [],
  parallelIndex: 0,
  retry: 0,
  startTime: new Date(0),
  status: 'skipped',
  stderr: [],
  stdout: [],
  steps: [],
  workerIndex: 0,
};

jest.useFakeTimers();
jest.spyOn(globalThis, 'setInterval');

describe('Playwright Performance Reporter', () => {
  let options: Options;
  let playwrightPerformanceReporter: PlaywrightPerformanceReporter;
  let mockMetricsEngine: MetricsEngineFixture;

  beforeEach(() => {
    const presenter: PresenterWriter = {
      write: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(true),
    };
    options = {
      deleteOnFailure: false,
      presenters: [presenter],
      browsers: {
        chromium: {
          onTest: {
            metrics: [new nativeChromiumObservers.usedJsHeapSize(), new nativeChromiumObservers.totalJsHeapSize()],
          },
        },
      },
    };
    playwrightPerformanceReporter = new PlaywrightPerformanceReporter(options);
    mockMetricsEngine = new MetricsEngineFixture();
    (playwrightPerformanceReporter as any).metricsEngine = mockMetricsEngine;
  });

  it('should create reporter with passed options', () => {
    expect((playwrightPerformanceReporter as any).options).toEqual(options);
  });

  it('should fall back to json chunk presenter when no presenters are passed', async () => {
    const cwd = process.cwd();
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-'));
    process.chdir(outputDir);
    try {
      const reporter = new PlaywrightPerformanceReporter({...options, presenters: undefined});
      const [presenter] = (reporter as any).presenters as PresenterWriter[];
      await presenter.close();

      expect(presenter).toBeInstanceOf(nativePresenters.jsonChunkPresenter);
      expect(fs.readdirSync(outputDir)).toEqual([expect.stringMatching(/^performance-report-\d+\.json$/)]);
    } finally {
      process.chdir(cwd);
      fs.rmSync(outputDir, {recursive: true, force: true});
    }
  });

  describe('browserName', () => {
    it('should ignore metrics fetch when browser client is not setup for onTestBegin', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onTestBegin(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should ignore metrics fetch when browser client is not setup for onTestEnd', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onTestEnd(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should ignore metrics fetch when browser client is not setup for onStepBegin', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onStepBegin(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should ignore metrics fetch when browser client is not setup for onStepEnd', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onStepEnd(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });
  });

  describe('buildIdentifier', () => {
    it('should skip TestPerformance creation when identifier is empty in onTestBegin', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onTestBegin(mockTestCaseRoot, mockTestResult);

      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should create TestPerformance when identifier is filled in onTestBegin', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onTestBegin(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).createTestPerformance).toHaveBeenCalledWith('1f', 'TEST_CASE_PARENT', 'title > path');
      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith(undefined, '1f', 'TEST_CASE_PARENT', 'onTest', 'onStart', 'chromium');
    });

    it('should skip TestPerformance creation when identifier is empty in onTestEnd', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onTestEnd(mockTestCaseRoot, mockTestResult);

      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should create TestPerformance when identifier is filled in onTestEnd', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onTestEnd(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith(expect.anything(), '1f', 'TEST_CASE_PARENT', 'onTest', 'onStop', 'chromium');
    });

    it('should skip TestPerformance creation when identifier is empty in onStepBegin', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onStepBegin(mockTestCaseRoot, mockTestResult, mockTestStepEmptyStepName);

      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should create TestPerformance when identifier is filled in onStepBegin', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onStepBegin(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).createTestPerformance).toHaveBeenCalledWith('1f', expect.anything(), 'file > path');
      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith(undefined, '1f', expect.anything(), 'onTestStep', 'onStart', 'chromium');
    });

    it('should skip TestPerformance creation when identifier is empty in onStepEnd', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onStepEnd(mockTestCaseRoot, mockTestResult, mockTestStepEmptyStepName);

      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should create TestPerformance when identifier is filled in onStepEnd', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      await playwrightPerformanceReporter.onStepEnd(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith(expect.anything(), '1f', expect.anything(), 'onTestStep', 'onStop', 'chromium');
    });
  });

  describe('buildTestPerformance and createTestPerformance', () => {
    it('should register new TestPerformance with given name', () => {
      const pivot = 'Test';
      const customTest = 'Test - Case';
      const customName = 'customName';
      const results = (playwrightPerformanceReporter as any).createTestPerformance(pivot, customTest, customName);

      expect(results[pivot][customTest]).not.toBeUndefined();
    });
  });

  describe('executeMetrics', () => {
    afterEach(() => {
      (playwrightPerformanceReporter as any).options = options;
    });

    it('should propagate metrics to the metricsEngine', async () => {
      const pivot = 'Test';
      const customTest = 'Test - Case';
      const customName = 'customName';
      const results = (playwrightPerformanceReporter as any).createTestPerformance(pivot, customTest, customName);
      mockMetricsEngine.getMetric.mockReturnValue(Promise.resolve([{metric1: 123}]));
      await (playwrightPerformanceReporter as any).executeMetrics(results, pivot, customTest, 'onTest', 'onStart', 'chromium');
      expect(mockMetricsEngine.getMetric).toHaveBeenCalledTimes(2);
      expect(mockMetricsEngine.getMetric).toHaveBeenCalledWith(options.browsers.chromium?.onTest?.metrics[0], 'onStart');
      expect(mockMetricsEngine.getMetric).toHaveBeenCalledWith(options.browsers.chromium?.onTest?.metrics[1], 'onStart');
      expect(results[pivot][customTest].startMetrics.length).toEqual(2);
    });

    it('should ignore customMetrics if none are provided', async () => {
      const pivot = 'Test';
      const customTest = 'Test - Case';
      const customName = 'customName';
      const results = (playwrightPerformanceReporter as any).createTestPerformance(pivot, customTest, customName);
      await (playwrightPerformanceReporter as any).executeMetrics(results, pivot, customTest, 'onTest', 'onStart', 'chromium');
      await (playwrightPerformanceReporter as any).executeMetrics(results, pivot, customTest, 'onTest', 'onStop', 'chromium');

      expect(mockMetricsEngine.runCustomMetric).toHaveBeenCalledTimes(0);
    });

    it('should register sampling for static metrics and destroy afterwards', async () => {
      const pivot = 'Test';
      const customTest = 'Test - Case';
      const customName = 'customName';

      const optionsWithSamplingMetrics = {
        ...options,
        browsers: {
          ...options.browsers,
          chromium: {
            ...options.browsers.chromium,
            sampling: {
              metrics: [
                {
                  samplingTimeoutInMilliseconds: 10,
                  metric: new nativeChromiumObservers.usedJsHeapSize(),
                },
              ],
            },
          },
        },
      };
      (playwrightPerformanceReporter as any).latestStepId = 'Test';
      (playwrightPerformanceReporter as any).latestCaseId = 'Case';
      (playwrightPerformanceReporter as any).latestName = 'Test';
      (playwrightPerformanceReporter as any).options = optionsWithSamplingMetrics;
      mockMetricsEngine.getMetric.mockReturnValue(Promise.resolve([{metric1: 123}]));
      const results = (playwrightPerformanceReporter as any).createTestPerformance(pivot, customTest, customName);
      await (playwrightPerformanceReporter as any).executeSamplingMetrics(results, '1f', '2f', 'onTest', 'chromium');

      expect((playwrightPerformanceReporter as any).samplingRunner.get('onTest').size).toEqual(1);

      (playwrightPerformanceReporter as any).destroySamplingRunner('1f', '2f', 'onTest');

      expect((playwrightPerformanceReporter as any).samplingRunner.get('onTest').size).toEqual(0);

      expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 10);
      jest.advanceTimersByTime(1000);
      jest.runAllTimers();
    });

    it('should clear every sampling interval of a test', async () => {
      const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
      (playwrightPerformanceReporter as any).options = {
        ...options,
        browsers: {
          chromium: {
            ...options.browsers.chromium,
            sampling: {
              metrics: [
                {samplingTimeoutInMilliseconds: 10, metric: new nativeChromiumObservers.usedJsHeapSize()},
                {samplingTimeoutInMilliseconds: 20, metric: new nativeChromiumObservers.totalJsHeapSize()},
              ],
            },
          },
        },
      };
      const results = (playwrightPerformanceReporter as any).createTestPerformance('1f', '2f', 'name');
      await (playwrightPerformanceReporter as any).executeSamplingMetrics(results, '1f', '2f', 'onTest', 'chromium');
      clearIntervalSpy.mockClear();

      (playwrightPerformanceReporter as any).destroySamplingRunner('1f', '2f', 'onTest');

      expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
      clearIntervalSpy.mockRestore();
    });

    it('should not propagate tests to the metricsEngine if no metrics are registered', () => {
      const pivot = 'Test';
      const customTest = 'Test - Case';
      const customName = 'customName';
      const results = (playwrightPerformanceReporter as any).createTestPerformance(pivot, customTest, customName);
      (playwrightPerformanceReporter as any).executeMetrics(results, pivot, customTest, 'onTest', 'onStart', 'firefox');

      expect(mockMetricsEngine.getMetric).not.toHaveBeenCalled();
      expect(mockMetricsEngine.runCustomMetric).not.toHaveBeenCalled();
    });
  });

  describe('hook order', () => {
    it('should start a step only after the previous hook finished measuring', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      const calls: string[] = [];
      let finishStop = () => {};
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn(async (_results: unknown, _caseId: string, _stepId: string, _hook: string, hookOrder: string) => {
        calls.push(`${hookOrder}:begin`);
        if (hookOrder === 'onStop') {
          await new Promise<void>(resolve => {
            finishStop = resolve;
          });
        }

        calls.push(`${hookOrder}:end`);
      });

      const stepEnd = playwrightPerformanceReporter.onStepEnd(mockTestCase, mockTestResult, mockTestStep);
      const stepBegin = playwrightPerformanceReporter.onStepBegin(mockTestCase, mockTestResult, mockTestStep);
      await Promise.resolve();
      await Promise.resolve();

      expect(calls).toEqual(['onStop:begin']);

      finishStop();
      await Promise.all([stepEnd, stepBegin]);

      expect(calls).toEqual(['onStop:begin', 'onStop:end', 'onStart:begin', 'onStart:end', 'onSampling:begin', 'onSampling:end']);
    });

    it('should run the next hook when a hook failed', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn()
        .mockRejectedValueOnce(new Error('failed'))
        .mockResolvedValue(undefined);

      await expect(playwrightPerformanceReporter.onStepEnd(mockTestCase, mockTestResult, mockTestStep)).rejects.toThrow('failed');
      await playwrightPerformanceReporter.onStepEnd(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledTimes(2);
    });

    it('should close the presenters after the running hooks finished', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      const presenter = options.presenters![0];
      let finishStop = () => {};
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn(async () => new Promise<void>(resolve => {
        finishStop = resolve;
      }));

      void playwrightPerformanceReporter.onTestEnd(mockTestCase, mockTestResult);
      const end = playwrightPerformanceReporter.onEnd({status: 'passed'} as FullResult);
      await Promise.resolve();
      await Promise.resolve();

      expect(presenter.close).not.toHaveBeenCalled();

      finishStop();
      await end;

      expect(presenter.write).toHaveBeenCalled();
      expect(presenter.close).toHaveBeenCalled();
    });
  });

  describe('budgets', () => {
    let presenter: {write: jest.Mock; close: jest.Mock; delete: jest.Mock};
    let errorSpy: jest.SpyInstance;
    let warningSpy: jest.SpyInstance;

    const createReporter = (budgets: Options['budgets']) => {
      const reporter = new PlaywrightPerformanceReporter({...options, presenters: [presenter], budgets});
      (reporter as any).metricsEngine = mockMetricsEngine;
      return reporter;
    };

    const getBudgetStore = (reporter: PlaywrightPerformanceReporter) => (reporter as unknown as {budgetStore: BudgetSample[]}).budgetStore;
    const buildResult = (status: FullResult['status']): FullResult => ({status, startTime: new Date(0), duration: 0});

    beforeEach(() => {
      presenter = {
        write: jest.fn().mockResolvedValue(true),
        close: jest.fn().mockResolvedValue(true),
        delete: jest.fn().mockResolvedValue(true),
      };
      errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => {});
      warningSpy = jest.spyOn(Logger, 'warning').mockImplementation(() => {});
      jest.spyOn(Logger, 'info').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each<[string, BudgetRule]>([
      ['neither max nor min', {metric: 'value'}],
      ['max less than min', {metric: 'value', max: 1, min: 2}],
      ['empty metric', {metric: '', max: 1}],
    ])('should throw on invalid rule with %s', (_, rule) => {
      expect(() => createReporter({rules: [rule]})).toThrow();
    });

    it('should capture final metrics in onTestEnd and onStepEnd', async () => {
      const reporter = createReporter({rules: [{metric: 'largestContentfulPaint', max: 2500}]});
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      mockMetricsEngine.getMetric.mockResolvedValue([{metric: {largestContentfulPaint: 3000, heap: 'large'}}]);
      (reporter as any).options.browsers.chromium.onTestStep = {metrics: [new nativeChromiumObservers.usedJsHeapSize()]};

      await reporter.onTestEnd(mockTestCase, mockTestResult);
      await reporter.onStepEnd(mockTestCase, mockTestResult, mockTestStep);

      expect(getBudgetStore(reporter)).toEqual([
        {name: 'title > path', metric: {largestContentfulPaint: 3000}},
        {name: 'title > path', metric: {largestContentfulPaint: 3000}},
        {name: 'file > path', metric: {largestContentfulPaint: 3000}},
      ]);
    });

    it('should not capture metrics without budgets', async () => {
      const reporter = createReporter(undefined);
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      mockMetricsEngine.getMetric.mockResolvedValue([{metric: {largestContentfulPaint: 3000}}]);

      await reporter.onTestEnd(mockTestCase, mockTestResult);

      expect(getBudgetStore(reporter)).toHaveLength(0);
    });

    it('should fail the run on violation', async () => {
      const reporter = createReporter({rules: [{metric: 'value', max: 5}]});
      getBudgetStore(reporter).push({name: 'X', metric: {value: 10}});
      const result = buildResult('passed');

      expect(await reporter.onEnd(result)).toEqual({status: 'failed'});
      expect(result.status).toEqual('failed');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Budget violation'));
    });

    it('should keep the run passing when budgets are satisfied', async () => {
      const reporter = createReporter({rules: [{metric: 'value', max: 50}]});
      getBudgetStore(reporter).push({name: 'X', metric: {value: 10}});
      const result = buildResult('passed');

      expect(await reporter.onEnd(result)).toEqual({status: 'passed'});
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should skip evaluation without budgets', async () => {
      const reporter = createReporter(undefined);

      expect(await reporter.onEnd(buildResult('passed'))).toEqual({status: 'passed'});
    });

    it('should only warn on violation with onViolation warn', async () => {
      const reporter = createReporter({rules: [{metric: 'value', max: 5}], onViolation: 'warn'});
      getBudgetStore(reporter).push({name: 'X', metric: {value: 10}});
      const result = buildResult('passed');

      await reporter.onEnd(result);

      expect(result.status).toEqual('passed');
      expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('Budget violation'));
    });

    it('should not override an interrupted run', async () => {
      const reporter = createReporter({rules: [{metric: 'value', max: 5}]});
      getBudgetStore(reporter).push({name: 'X', metric: {value: 10}});
      const result = buildResult('interrupted');

      await reporter.onEnd(result);

      expect(result.status).toEqual('interrupted');
    });

    it('should enforce budgets when closing presenters fails', async () => {
      presenter.close.mockRejectedValue(new Error('close failed'));
      const reporter = createReporter({rules: [{metric: 'value', max: 5}]});
      getBudgetStore(reporter).push({name: 'X', metric: {value: 10}});
      const result = buildResult('passed');

      expect(await reporter.onEnd(result)).toEqual({status: 'failed'});
      expect(errorSpy).toHaveBeenCalledWith('Error writing report');
    });

    it('should delete reports on violation when deleteOnFailure is enabled', async () => {
      options.deleteOnFailure = true;
      const reporter = createReporter({rules: [{metric: 'value', max: 5}]});
      getBudgetStore(reporter).push({name: 'X', metric: {value: 10}});

      await reporter.onEnd(buildResult('passed'));

      expect(presenter.delete).toHaveBeenCalled();
    });

    it('should close presenters when evaluation fails', async () => {
      const reporter = createReporter({rules: [{metric: 'value', max: 5}]});
      getBudgetStore(reporter).push(null as unknown as BudgetSample);
      const result = buildResult('passed');

      await reporter.onEnd(result);

      expect(result.status).toEqual('passed');
      expect(errorSpy).toHaveBeenCalledWith('Error evaluating budgets', expect.any(String));
      expect(presenter.close).toHaveBeenCalled();
    });
  });
});
