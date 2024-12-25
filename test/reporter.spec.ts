import {
  type FullProject,
  type Suite,
  type TestCase,
  type TestResult,
  type TestStep,
} from '@playwright/test/reporter';
import PlaywrightPerformanceReporter from '../src/index.js';
import {type Options} from '../src/types/options.js';
import {MetricsEngineFixture} from './fixtures/metrics.fixture.js';

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
jest.spyOn(global, 'setInterval');

describe('Playwright Performance Reporter', () => {
  let options: Options;
  let playwrightPerformanceReporter: PlaywrightPerformanceReporter;
  let mockMetricsEngine: MetricsEngineFixture;

  beforeEach(() => {
    options = {
      outputDir: './',
      outputFile: 'output.json',
      browsers: {
        chromium: {
          onTest: {
            metrics: ['usedJsHeapSize', 'totalJsHeapSize'],
          },
        },
      },
    };
    playwrightPerformanceReporter = new PlaywrightPerformanceReporter(structuredClone(options));
    mockMetricsEngine = new MetricsEngineFixture();
    (playwrightPerformanceReporter as any).metricsEngine = mockMetricsEngine;
  });

  it('should create reporter with passed options', () => {
    expect((playwrightPerformanceReporter as any).options).toEqual(options);
  });

  describe('browserName', () => {
    it('should ignore metrics fetch when browser client is not setup for onTestBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onTestBegin(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should ignore metrics fetch when browser client is not setup for onTestEnd', () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onTestEnd(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should ignore metrics fetch when browser client is not setup for onStepBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onStepBegin(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should ignore metrics fetch when browser client is not setup for onStepEnd', () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onStepEnd(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });
  });

  describe('buildIdentifier', () => {
    it('should skip TestPerformance creation when identifier is empty in onTestBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onTestBegin(mockTestCaseRoot, mockTestResult);

      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should create TestPerformance when identifier is filled in onTestBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onTestBegin(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).createTestPerformance).toHaveBeenCalledWith('1f', 'TEST_CASE_PARENT', 'title > path');
      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith(undefined, '1f', 'TEST_CASE_PARENT', 'onTest', 'onStart', 'chromium');
    });

    it('should skip TestPerformance creation when identifier is empty in onTestEnd', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onTestEnd(mockTestCaseRoot, mockTestResult);

      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should create TestPerformance when identifier is filled in onTestEnd', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onTestEnd(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith(expect.anything(), '1f', 'TEST_CASE_PARENT', 'onTest', 'onStop', 'chromium');
    });

    it('should skip TestPerformance creation when identifier is empty in onStepBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onStepBegin(mockTestCaseRoot, mockTestResult, mockTestStepEmptyStepName);

      expect((playwrightPerformanceReporter as any).createTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should create TestPerformance when identifier is filled in onStepBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).createTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onStepBegin(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).createTestPerformance).toHaveBeenCalledWith('1f', expect.anything(), 'file > path');
      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith(undefined, '1f', expect.anything(), 'onTestStep', 'onStart', 'chromium');
    });

    it('should skip TestPerformance creation when identifier is empty in onStepEnd', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onStepEnd(mockTestCaseRoot, mockTestResult, mockTestStepEmptyStepName);

      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should create TestPerformance when identifier is filled in onStepEnd', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onStepEnd(mockTestCase, mockTestResult, mockTestStep);

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
      (playwrightPerformanceReporter as any).options = structuredClone(options);
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

    it('should propagate custom metrics to the metricsEngine', async () => {
      const pivot = 'Test';
      const customTest = 'Test - Case';
      const customName = 'customName';

      const optionsWithCustomMetrics = {
        ...options,
        browsers: {
          ...options.browsers,
          chromium: {
            ...options.browsers.chromium,
            onTest: {
              metrics: options.browsers.chromium?.onTest?.metrics,
              customMetrics: {
                metric1: {
                  name: 'metric1',
                  async onStart(accumulator) {
                    Object.assign(accumulator, {metric: 123});
                  },
                  async onSampling(accumulator) {
                    Object.assign(accumulator, {metric: 123});
                  },
                  async onStop(accumulator) {
                    Object.assign(accumulator, {metric: 456});
                  },
                },
              },
            },
          },
        },
      } as Options;
      (playwrightPerformanceReporter as any).options = optionsWithCustomMetrics;
      const results = (playwrightPerformanceReporter as any).createTestPerformance(pivot, customTest, customName);
      await (playwrightPerformanceReporter as any).executeMetrics(results, pivot, customTest, 'onTest', 'onStart', 'chromium');
      await (playwrightPerformanceReporter as any).executeMetrics(results, pivot, customTest, 'onTest', 'onStop', 'chromium');

      expect(mockMetricsEngine.runCustomMetric).toHaveBeenCalledTimes(2);
      expect(mockMetricsEngine.runCustomMetric).toHaveBeenCalledWith(optionsWithCustomMetrics.browsers.chromium?.onTest?.customMetrics?.metric1.onStart);
      expect(mockMetricsEngine.runCustomMetric).toHaveBeenCalledWith(optionsWithCustomMetrics.browsers.chromium?.onTest?.customMetrics?.metric1.onStop);
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
            onTest: {
              metrics: ['allPerformanceMetrics'],
              sampleMetrics: {
                allPerformanceMetrics: {
                  samplingTimeoutInMilliseconds: 10
                }
              }
            },
          },
        },
      } as Options;
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
});
