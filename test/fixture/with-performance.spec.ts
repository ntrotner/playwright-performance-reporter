import {
  withPerformance,
} from '../../src/fixture/index.js';
import {
  type Options,
} from '../../src/types/index.js';

const mockCollector = {
  observeContext: jest.fn(),
  testBegin: jest.fn(),
  testEnd: jest.fn(),
  stepBegin: jest.fn(),
  stepEnd: jest.fn(),
};

jest.mock('../../src/fixture/collector.js', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  PerformanceCollector: jest.fn(() => mockCollector),
}));

type CollectorFixture = [
  (fixtures: {context: unknown; browserName: string}, use: () => Promise<void>, testInfo: {attach: jest.Mock}) => Promise<void>,
  {auto: boolean},
];

/**
 * Test type of Playwright that records the fixtures it's extended with
 */
function createBase() {
  const originalStep = Object.assign(jest.fn(async (_title: string, body: (stepInfo: unknown) => Promise<unknown>) => body({})), {skip: jest.fn()});
  const extended = {step: originalStep as any};
  let fixtures: Record<string, unknown> = {};
  const base = {
    extend: jest.fn((extension: Record<string, unknown>) => {
      fixtures = extension;
      return extended;
    }),
  };

  return {base, originalStep, collectorFixture: () => fixtures.performanceCollector as CollectorFixture};
}

const options: Options = {deleteOnFailure: false, mode: 'fixture', browsers: {}};

describe('withPerformance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollector.testEnd.mockResolvedValue([{case: {}}]);
  });

  it('should measure the test and its steps in chromium and attach the measurements', async () => {
    const {base, originalStep, collectorFixture} = createBase();
    const test = withPerformance(base as any, options);
    const [fixture, settings] = collectorFixture();
    const testInfo = {attach: jest.fn()};
    const context = {};

    await fixture({context, browserName: 'chromium'}, async () => {
      expect(await test.step('Open profile', async () => 'done')).toBe('done');
    }, testInfo);

    expect(settings).toEqual({auto: true});
    expect(mockCollector.observeContext).toHaveBeenCalledWith(context);
    expect(mockCollector.testBegin).toHaveBeenCalled();
    expect(mockCollector.stepBegin).toHaveBeenCalledWith('Open profile');
    expect(mockCollector.stepEnd).toHaveBeenCalled();
    expect(testInfo.attach).toHaveBeenCalledWith('playwright-performance-reporter', {body: '[{"case":{}}]', contentType: 'application/json'});
    expect(test.step.skip).toBe(originalStep.skip);
  });

  it('should end the step and attach the measurements when the step or test fails', async () => {
    const {base, collectorFixture} = createBase();
    const test = withPerformance(base as any, options);
    const [fixture] = collectorFixture();
    const testInfo = {attach: jest.fn()};

    await expect(fixture({context: {}, browserName: 'chromium'}, async () => {
      await test.step('Failing step', async () => {
        throw new Error('assertion failed');
      });
    }, testInfo)).rejects.toThrow('assertion failed');

    expect(mockCollector.stepEnd).toHaveBeenCalled();
    expect(testInfo.attach).toHaveBeenCalled();
  });

  it('should not measure browsers without CDP sessions', async () => {
    const {base, collectorFixture} = createBase();
    const test = withPerformance(base as any, options);
    const [fixture] = collectorFixture();
    const testInfo = {attach: jest.fn()};

    await fixture({context: {}, browserName: 'firefox'}, async () => {
      await test.step('Open profile', async () => undefined);
    }, testInfo);

    expect(mockCollector.testBegin).not.toHaveBeenCalled();
    expect(mockCollector.stepBegin).not.toHaveBeenCalled();
    expect(testInfo.attach).not.toHaveBeenCalled();
  });
});
