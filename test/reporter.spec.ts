import {
  type FullProject, type Suite, type TestCase, type TestResult, type TestStep,
} from '@playwright/test/reporter';
import PlaywrightPerformanceReporter from '../src/index';
import {type Options} from '../src/types/options';
import {MetricsEngineFixture} from './fixtures/metrics.fixture';

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
  title: 'Parent Test Case',
  type: 'test',
};

const mockTestStep: TestStep = {
  titlePath(): string[] {
    return ['file', 'path'];
  },
  category: '',
  duration: 0,
  startTime: new Date(),
  steps: [],
  title: 'Child Test Step',
};

const mockTestStepEmptyStepName: TestStep = {
  titlePath(): string[] {
    return ['file', 'path'];
  },
  category: '',
  duration: 0,
  startTime: new Date(),
  steps: [],
  title: '',
};

const mockTestResult: TestResult = {
  attachments: [],
  duration: 0,
  errors: [],
  parallelIndex: 0,
  retry: 0,
  startTime: new Date(),
  status: 'skipped',
  stderr: [],
  stdout: [],
  steps: [],
  workerIndex: 0,
};

describe('Playwright Performance Reporter', () => {
  let options: Options;
  let playwrightPerformanceReporter: PlaywrightPerformanceReporter;
  let mockMetricsEngine: MetricsEngineFixture;

  beforeEach(() => {
    options = {
      browsers: {
        chromium: {
          onTest: {
            metrics: ['usedJsHeapSize', 'totalJsHeapSize', 'jsHeapSizeLimit'],
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

  describe('onBegin', () => {
    it('should pass browser when test suite', () => {
      let suite = {
        entries: () => ([{title: 'chromium'}]),
      } as Suite;
      playwrightPerformanceReporter.onBegin({} as any, suite);

      expect(mockMetricsEngine.setupBrowser).toHaveBeenCalledWith('chromium');

      suite = {
        entries: () => ([{title: 'someBrowser'}]),
      } as Suite;
      playwrightPerformanceReporter.onBegin({} as any, suite);

      expect(mockMetricsEngine.setupBrowser).toHaveBeenCalledWith('someBrowser');
    });
  });

  describe('onEnd', () => {
    it('should destroy browser when test suite is done', () => {
      playwrightPerformanceReporter.onEnd({} as any);
      expect(mockMetricsEngine.destroy).toHaveBeenCalled();
    });
  });

  describe('browserName', () => {
    it('should ignore metrics fetch when browser client is not setup for onTestBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).registerTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onTestBegin(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).registerTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should ignore metrics fetch when browser client is not setup for onTestEnd', () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).registerTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onTestEnd(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).registerTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should ignore metrics fetch when browser client is not setup for onStepBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).registerTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onStepBegin(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).registerTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should ignore metrics fetch when browser client is not setup for onStepEnd', () => {
      mockMetricsEngine.getBrowser.mockReturnValue(undefined);
      (playwrightPerformanceReporter as any).buildIdentifier = jest.fn();
      (playwrightPerformanceReporter as any).registerTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onStepEnd(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).buildIdentifier).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).registerTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });
  });

  describe('buildIdentifier', () => {
    it('should skip TestPerformance creation when identifier is empty in onTestBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).registerTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onTestBegin(mockTestCaseRoot, mockTestResult);

      expect((playwrightPerformanceReporter as any).registerTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should create TestPerformance when identifier is filled in onTestBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).registerTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onTestBegin(mockTestCase, mockTestResult);

      expect((playwrightPerformanceReporter as any).registerTestPerformance).toHaveBeenCalledWith('Parent Test Case - ');
      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith('Parent Test Case - ', 'onTest', 'onStart', 'chromium');
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

      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith('Parent Test Case - ', 'onTest', 'onStop', 'chromium');
    });

    it('should skip TestPerformance creation when identifier is empty in onStepBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).registerTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onStepBegin(mockTestCaseRoot, mockTestResult, mockTestStepEmptyStepName);

      expect((playwrightPerformanceReporter as any).registerTestPerformance).not.toHaveBeenCalled();
      expect((playwrightPerformanceReporter as any).executeMetrics).not.toHaveBeenCalled();
    });

    it('should create TestPerformance when identifier is filled in onStepBegin', () => {
      mockMetricsEngine.getBrowser.mockReturnValue('chromium');
      (playwrightPerformanceReporter as any).registerTestPerformance = jest.fn();
      (playwrightPerformanceReporter as any).executeMetrics = jest.fn();
      playwrightPerformanceReporter.onStepBegin(mockTestCase, mockTestResult, mockTestStep);

      expect((playwrightPerformanceReporter as any).registerTestPerformance).toHaveBeenCalledWith('Child Test Step - ');
      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith('Child Test Step - ', 'onTestStep', 'onStart', 'chromium');
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

      expect((playwrightPerformanceReporter as any).executeMetrics).toHaveBeenCalledWith('Child Test Step - ', 'onTestStep', 'onStop', 'chromium');
    });
  });

  describe('buildTestPerformance and registerTestPerformance', () => {
    it('should register new TestPerformance with given name', () => {
      const customTest = 'Test - Case';
      (playwrightPerformanceReporter as any).registerTestPerformance(customTest);

      expect((playwrightPerformanceReporter as any).results[customTest]).not.toBeUndefined();
    });
  });

  describe('executeMetrics', () => {
    afterEach(() => {
      (playwrightPerformanceReporter as any).options = structuredClone(options);
    });

    it('should propagate metrics to the metricsEngine', async () => {
      const customTest = 'Test - Case';
      (playwrightPerformanceReporter as any).registerTestPerformance(customTest);
      mockMetricsEngine.getMetric.mockReturnValue(Promise.resolve([{metric1: 123}]));
      await (playwrightPerformanceReporter as any).executeMetrics(customTest, 'onTest', 'onStart', 'chromium');
      expect(mockMetricsEngine.getMetric).toHaveBeenCalledTimes(3);
      expect(mockMetricsEngine.getMetric).toHaveBeenCalledWith(options.browsers.chromium?.onTest?.metrics[0]);
      expect(mockMetricsEngine.getMetric).toHaveBeenCalledWith(options.browsers.chromium?.onTest?.metrics[1]);
      expect(mockMetricsEngine.getMetric).toHaveBeenCalledWith(options.browsers.chromium?.onTest?.metrics[2]);
      expect((playwrightPerformanceReporter as any).results[customTest].startMetrics.length).toEqual(3);
    });

    it('should propagate custom metrics to the metricsEngine', async () => {
      const customTest = 'Test - Case';

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
                  onStart: async () => ({metric: 123}),
                  onStop: async () => ({metric: 456}),
                },
              },
            },
          },
        },
      } as Options;
      (playwrightPerformanceReporter as any).options = optionsWithCustomMetrics;
      (playwrightPerformanceReporter as any).registerTestPerformance(customTest);
      await (playwrightPerformanceReporter as any).executeMetrics(customTest, 'onTest', 'onStart', 'chromium');
      await (playwrightPerformanceReporter as any).executeMetrics(customTest, 'onTest', 'onStop', 'chromium');

      expect(mockMetricsEngine.runCustomMetric).toHaveBeenCalledTimes(2);
      expect(mockMetricsEngine.runCustomMetric).toHaveBeenCalledWith(optionsWithCustomMetrics.browsers.chromium?.onTest?.customMetrics?.metric1.onStart);
      expect(mockMetricsEngine.runCustomMetric).toHaveBeenCalledWith(optionsWithCustomMetrics.browsers.chromium?.onTest?.customMetrics?.metric1.onStop);
    });

    it('should ignore customMetrics if none are provided', async () => {
      const customTest = 'Test - Case';
      (playwrightPerformanceReporter as any).registerTestPerformance(customTest);
      await (playwrightPerformanceReporter as any).executeMetrics(customTest, 'onTest', 'onStart', 'chromium');
      await (playwrightPerformanceReporter as any).executeMetrics(customTest, 'onTest', 'onStop', 'chromium');

      expect(mockMetricsEngine.runCustomMetric).toHaveBeenCalledTimes(0);
    });

    it('should not propagate tests to the metricsEngine if no metrics are registered', () => {
      const customTest = 'Test - Case';
      (playwrightPerformanceReporter as any).registerTestPerformance(customTest);
      (playwrightPerformanceReporter as any).executeMetrics(customTest, 'onTest', 'onStart', 'firefox');

      expect(mockMetricsEngine.getMetric).not.toHaveBeenCalled();
      expect(mockMetricsEngine.runCustomMetric).not.toHaveBeenCalled();
    });
  });
});
