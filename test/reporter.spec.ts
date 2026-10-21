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
      Object.assign((playwrightPerformanceReporter as any).getWorkerOfCase('1f'), {latestStepId: 'Test', latestCaseId: 'Case', latestName: 'Test'});
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

    it('should end nested steps concurrently and end the test after them', async () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      const flushMicrotasks = async () => {
        for (let index = 0; index < 20; index++) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.resolve();
        }
      };

      const calls: string[] = [];
      const pending: Array<() => void> = [];
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn(async (_results: unknown, _caseId: string, stepId: string, hook: string) => {
        calls.push(`${hook}:${stepId}`);
        await new Promise<void>(resolve => {
          pending.push(resolve);
        });
      });
      const outer = {...mockTestStep, titlePath: () => ['outer']} as TestStep;
      const inner = {...mockTestStep, titlePath: () => ['outer', 'inner']} as TestStep;

      const hooks = [
        playwrightPerformanceReporter.onStepEnd(mockTestCase, mockTestResult, inner),
        playwrightPerformanceReporter.onStepEnd(mockTestCase, mockTestResult, outer),
        playwrightPerformanceReporter.onTestEnd(mockTestCase, mockTestResult),
      ];
      await flushMicrotasks();

      expect(calls).toHaveLength(2);

      for (const resolve of pending.splice(0)) {
        resolve();
      }

      await flushMicrotasks();
      expect(calls).toHaveLength(3);
      expect(calls[2]).toBe('onTest:TEST_CASE_PARENT');
      pending[0]();
      await Promise.all(hooks);
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

  describe('workers', () => {
    const resultOf = (parallelIndex: number): TestResult => ({...mockTestResult, parallelIndex});
    const projectTest = (id: string, args: string[]) => ({
      ...mockTestCase,
      id,
      parent: {...mockSuite, project: () => ({use: {defaultBrowserType: 'chromium', launchOptions: {args: ['--headless', ...args]}}})},
    }) as unknown as TestCase;

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should measure every worker with its own browser connection and port', async () => {
      const reporter = new PlaywrightPerformanceReporter({...options, debuggingPort: {perWorker: true}});
      const firstEngine = new MetricsEngineFixture();
      const secondEngine = new MetricsEngineFixture();
      (reporter as any).metricsEngine = firstEngine;
      (reporter as any).workers.set(1, {metricsEngine: secondEngine});
      for (const engine of [firstEngine, secondEngine]) {
        engine.getBrowser.mockReturnValue('chromium');
        engine.getMetric.mockResolvedValue([{metric: {}}]);
      }

      await reporter.onTestBegin(projectTest('first', ['--remote-debugging-port=9300']), resultOf(0));
      await reporter.onTestBegin(projectTest('second', ['--remote-debugging-port=9300']), resultOf(1));

      expect(firstEngine.setupBrowser).toHaveBeenCalledWith('chromium', {defaultBrowserType: 'chromium', launchOptions: {args: ['--headless', '--remote-debugging-port=9300']}}, undefined);
      expect(secondEngine.setupBrowser).toHaveBeenCalledWith('chromium', {defaultBrowserType: 'chromium', launchOptions: {args: ['--headless', '--remote-debugging-port=9301']}}, undefined);
      expect(firstEngine.getMetric).toHaveBeenCalledTimes(2);
      expect(secondEngine.getMetric).toHaveBeenCalledTimes(2);

      // Steps of the second test are measured in the browser of the second worker
      firstEngine.getMetric.mockClear();
      secondEngine.getMetric.mockClear();
      await reporter.onStepBegin(projectTest('second', []), resultOf(1), {...mockTestStep, category: 'test.step'} as TestStep);
      expect(firstEngine.getMetric).not.toHaveBeenCalled();
      expect((reporter as any).workers.get(1).latestCaseId).toBe('second');
    });

    it('should use the configured base port', () => {
      const reporter = new PlaywrightPerformanceReporter({...options, debuggingPort: {perWorker: true, base: 10_000}});

      expect((reporter as any).withDebuggingPort({launchOptions: {args: []}}, resultOf(2))).toEqual({launchOptions: {args: ['--remote-debugging-port=10002']}});
      expect((reporter as any).withDebuggingPort({}, resultOf(0))).toEqual({launchOptions: {args: ['--remote-debugging-port=10000']}});
    });

    it('should share the connection of the first worker without perWorker', () => {
      const reporter = new PlaywrightPerformanceReporter(options);
      const details = {launchOptions: {args: ['--remote-debugging-port=9222']}};

      expect((reporter as any).getWorker(resultOf(3))).toBe((reporter as any).getWorker(resultOf(0)));
      expect((reporter as any).withDebuggingPort(details, resultOf(3))).toBe(details);
    });

    it('should stop every sampling interval of a step', async () => {
      jest.useFakeTimers();
      const reporter = new PlaywrightPerformanceReporter({
        ...options,
        browsers: {
          chromium: {
            sampling: {
              metrics: [
                {samplingTimeoutInMilliseconds: 10, metric: new nativeChromiumObservers.usedJsHeapSize()},
                {samplingTimeoutInMilliseconds: 10, metric: new nativeChromiumObservers.totalJsHeapSize()},
              ],
            },
          },
        },
      });
      (reporter as any).metricsEngine = mockMetricsEngine;
      mockMetricsEngine.getMetric.mockResolvedValue([]);
      const results = (reporter as any).createTestPerformance('1f', '2f', 'step');

      await (reporter as any).executeSamplingMetrics(results, '1f', '2f', 'onTestStep', 'chromium');
      (reporter as any).destroySamplingRunner('1f', '2f', 'onTestStep');
      await jest.advanceTimersByTimeAsync(100);

      expect(mockMetricsEngine.getMetric).not.toHaveBeenCalled();
    });
  });

  describe('fixture mode', () => {
    const chunk = (stepId: string, value: number) => ({
      '1f': {
        [stepId]: {
          name: stepId, startMetrics: [], stopMetrics: [{metric: {largestContentfulPaint: value}}], samplingMetrics: [], startMeasurement: 0, endMeasurement: 0,
        },
      },
    });
    const withAttachment = (body: string | undefined): TestResult => ({
      ...mockTestResult,
      attachments: [{name: 'playwright-performance-reporter', contentType: 'application/json', body: body === undefined ? undefined : Buffer.from(body)}],
    });

    let presenter: {write: jest.Mock; close: jest.Mock; delete: jest.Mock};
    let reporter: PlaywrightPerformanceReporter;

    beforeEach(() => {
      presenter = {
        write: jest.fn().mockResolvedValue(true),
        close: jest.fn().mockResolvedValue(true),
        delete: jest.fn().mockResolvedValue(true),
      };
      reporter = new PlaywrightPerformanceReporter({
        ...options, mode: 'fixture', presenters: [presenter], budgets: {rules: [{metric: 'largestContentfulPaint', max: 2500}]},
      });
      (reporter as any).metricsEngine = mockMetricsEngine;
      jest.spyOn(Logger, 'info').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should not measure in the test runner', async () => {
      const testCase = {...mockTestCase, parent: {...mockSuite, project: () => ({use: {defaultBrowserType: 'chromium'}})}} as unknown as TestCase;

      await reporter.onTestBegin(testCase, mockTestResult);
      await reporter.onStepBegin(testCase, mockTestResult, mockTestStep);
      await reporter.onStepEnd(testCase, mockTestResult, mockTestStep);

      expect(mockMetricsEngine.setupBrowser).not.toHaveBeenCalled();
      expect(mockMetricsEngine.getMetric).not.toHaveBeenCalled();
      expect(presenter.write).not.toHaveBeenCalled();
    });

    it('should forward the attached chunks in order and evaluate budgets on them', async () => {
      const chunks = [chunk('a', 1000), chunk('b', 3000)];

      await reporter.onTestEnd(mockTestCase, withAttachment(JSON.stringify(chunks)));
      const {status} = await reporter.onEnd({status: 'passed', startTime: new Date(0), duration: 0}) as {status: string};

      expect(presenter.write.mock.calls).toEqual([[chunks[0]], [chunks[1]]]);
      expect(status).toBe('failed');
      expect(mockMetricsEngine.destroy).not.toHaveBeenCalled();
    });

    it('should group the budget samples of the attached chunks by the test name', async () => {
      await reporter.onTestEnd(mockTestCase, withAttachment(JSON.stringify([chunk('a', 1000)])));

      expect((reporter as any).budgetStore).toEqual([{name: 'a', testName: 'title > path', metric: {largestContentfulPaint: 1000}}]);
    });

    it('should ignore tests without measurements and log invalid ones', async () => {
      const errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => {});

      await reporter.onTestEnd(mockTestCase, mockTestResult);
      await reporter.onTestEnd(mockTestCase, withAttachment(undefined));
      await reporter.onTestEnd(mockTestCase, withAttachment('{not json'));
      await reporter.onTestEnd(mockTestCase, withAttachment('{"a": 1}'));

      expect(presenter.write).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(2);
    });

    it('should finish running hooks before closing the presenters', async () => {
      let releaseWrite = () => {};
      presenter.write.mockImplementationOnce(async () => new Promise(resolve => {
        releaseWrite = () => {
          resolve(true);
        };
      }));

      // Playwright doesn't await onTestEnd, e.g. when merging reports
      void reporter.onTestEnd(mockTestCase, withAttachment(JSON.stringify([chunk('a', 1000)])));
      const end = reporter.onEnd({status: 'passed', startTime: new Date(0), duration: 0});
      await new Promise(setImmediate);
      expect(presenter.close).not.toHaveBeenCalled();

      releaseWrite();
      await end;
      expect(presenter.close).toHaveBeenCalled();
    });
  });

  describe('conditions', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const createReporter = (browsers: Options['browsers']) => {
      const reporter = new PlaywrightPerformanceReporter({...options, browsers});
      (reporter as any).metricsEngine = mockMetricsEngine;
      return reporter;
    };

    it('should throw on invalid conditions', () => {
      expect(() => createReporter({chromium: {conditions: {cpuSlowdown: 0}}})).toThrow('Invalid conditions');
    });

    it('should ignore conditions for other browsers than chromium', () => {
      const warningSpy = jest.spyOn(Logger, 'warning').mockImplementation(() => {});
      const reporter = createReporter({webkit: {conditions: {cpuSlowdown: 4}}});

      expect((reporter as any).conditions).toEqual({});
      expect(warningSpy).toHaveBeenCalledWith('Conditions are only supported for chromium and are ignored for webkit');
    });

    it('should pass the conditions to the browser and record them on the test', async () => {
      const reporter = createReporter({chromium: {conditions: {cpuSlowdown: 4}}});
      const testCase = {...mockTestCase, parent: {...mockSuite, project: () => ({use: {defaultBrowserType: 'chromium'}})}} as unknown as TestCase;
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      mockMetricsEngine.getMetric.mockResolvedValue([]);

      await reporter.onTestBegin(testCase, mockTestResult);

      const conditions = (reporter as any).conditions.chromium;
      expect(conditions).toEqual(expect.objectContaining({cpuSlowdown: 4, description: 'CPU 4x slowdown'}));
      expect(mockMetricsEngine.setupBrowser).toHaveBeenCalledWith('chromium', {defaultBrowserType: 'chromium'}, conditions);
      const [[chunk]] = (options.presenters![0].write as jest.Mock).mock.calls as Array<[Record<string, Record<string, {conditions?: unknown}>>]>;
      expect(chunk['1f'].TEST_CASE_PARENT.conditions).toBe(conditions);
    });
  });

  describe('step selection', () => {
    it('should throw on invalid steps', () => {
      expect(() => new PlaywrightPerformanceReporter({...options, steps: {categories: ['unknown' as 'hook']}})).toThrow('Invalid steps');
    });

    it('should warn about categories the fixture mode does not measure', () => {
      const warningSpy = jest.spyOn(Logger, 'warning').mockImplementation(() => {});

      new PlaywrightPerformanceReporter({...options, mode: 'fixture', steps: {categories: ['test.step', 'pw:api']}});

      expect(warningSpy).toHaveBeenCalledWith('The fixture mode only measures test.step(), the step categories pw:api are ignored');
      warningSpy.mockRestore();
    });

    it('should measure the selected Playwright API steps', async () => {
      const reporter = new PlaywrightPerformanceReporter({...options, steps: {categories: ['pw:api'], titlePattern: 'Navigate to *'}});
      (reporter as any).metricsEngine = mockMetricsEngine;
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (reporter as any).executeMetrics = jest.fn();
      const navigation = {...mockTestStep, category: 'pw:api', title: 'Navigate to "/"', titlePath: () => ['Navigate to "/"']} as TestStep;
      const click = {...mockTestStep, category: 'pw:api', title: 'Click button', titlePath: () => ['Click button']} as TestStep;

      await reporter.onStepBegin(mockTestCase, mockTestResult, navigation);
      await reporter.onStepBegin(mockTestCase, mockTestResult, click);
      await reporter.onStepBegin(mockTestCase, mockTestResult, {...mockTestStep, category: 'test.step'} as TestStep);

      expect((reporter as any).executeMetrics).toHaveBeenCalledTimes(2);
      expect((reporter as any).executeMetrics).toHaveBeenCalledWith(expect.anything(), '1f', expect.any(String), 'onTestStep', 'onStart', 'chromium');
    });
  });

  describe('executions', () => {
    it('should record the execution of a test and group its budget samples by the test name', async () => {
      const reporter = new PlaywrightPerformanceReporter({...options, budgets: {rules: [{metric: 'value', max: 1}]}});
      (reporter as any).metricsEngine = mockMetricsEngine;
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      mockMetricsEngine.getMetric.mockResolvedValue([{metric: {value: 2}}]);

      await reporter.onTestBegin({...mockTestCase, repeatEachIndex: 2} as TestCase, {...mockTestResult, retry: 1});
      await reporter.onTestEnd(mockTestCase, mockTestResult);

      const [[chunk]] = (options.presenters![0].write as jest.Mock).mock.calls as Array<[Record<string, Record<string, {execution?: unknown}>>]>;
      expect(chunk['1f'].TEST_CASE_PARENT.execution).toEqual({repeatEachIndex: 2, retry: 1});
      expect((reporter as any).budgetStore).toContainEqual({name: 'title > path', testName: 'title > path', metric: {value: 2}});
    });
  });
});
