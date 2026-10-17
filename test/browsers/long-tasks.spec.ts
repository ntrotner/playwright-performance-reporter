import vm from 'node:vm';
import type CDP from 'chrome-remote-interface';
import {
  nativeChromiumObservers,
} from '../../src/index.js';
import {
  ChromiumCDPFixture,
} from '../fixtures/chromium-cdp.fixture.js';

type Callback = (...arguments_: unknown[]) => void;

type Page = {
  context: vm.Context;
  emit: (durations: number[]) => void;
  observe: jest.Mock;
};

/**
 * Minimal page context with a controllable PerformanceObserver
 */
function createPage(supportsLongTasks = true): Page {
  const callbacks: Array<(list: {getEntries: () => Array<{duration: number}>}) => void> = [];
  const observe = jest.fn(() => {
    if (!supportsLongTasks) {
      throw new TypeError('longtask is not supported');
    }
  });
  const context = vm.createContext({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    PerformanceObserver: class {
      observe = observe;

      constructor(callback: (list: {getEntries: () => Array<{duration: number}>}) => void) {
        callbacks.push(callback);
      }
    },
  });
  context.window = context;

  return {
    context,
    observe,
    emit(durations) {
      for (const callback of callbacks) {
        callback({getEntries: () => durations.map(duration => ({duration}))});
      }
    },
  };
}

/**
 * Let the mocked client evaluate the expressions in the page context
 */
function evaluateIn(page: Page, client: ChromiumCDPFixture) {
  client.send.mockImplementation((_command: string, parameters: {expression: string}, callback: Callback) => {
    callback(false, {result: {type: 'object', value: vm.runInContext(parameters.expression, page.context) as unknown}});
  });
}

describe('LongTasksObserver', () => {
  let client: ChromiumCDPFixture;
  let cdp: CDP.Client;
  let observer: InstanceType<typeof nativeChromiumObservers.longTasks>;

  beforeEach(() => {
    client = new ChromiumCDPFixture();
    cdp = client as unknown as CDP.Client;
    observer = new nativeChromiumObservers.longTasks();
  });

  it('should only use Runtime.evaluate without plugins', async () => {
    const accumulator = {};
    evaluateIn(createPage(), client);

    await observer.onStart(accumulator, cdp);
    await observer.onSampling(accumulator, cdp);
    await observer.onStop(accumulator, cdp);

    expect(observer.name).toEqual('longTasks');
    expect(observer.plugins).toEqual([]);
    expect(client.send.mock.calls.map(call => call[0] as string)).toEqual(['Runtime.evaluate', 'Runtime.evaluate', 'Runtime.evaluate']);
    expect(client.send.mock.calls[0][1]).toEqual(expect.objectContaining({returnByValue: true}));
  });

  it('should compute the long task aggregates and the total blocking time', async () => {
    const page = createPage();
    evaluateIn(page, client);
    const start = {};
    const stop: Record<string, number> = {};

    await observer.onStart(start, cdp);
    page.emit([312.4, 87.2]);
    await observer.onStop(stop, cdp);

    expect(start).toEqual({
      longTaskCount: 0, totalLongTasksDuration: 0, totalBlockingTime: 0, maxLongTaskDuration: 0,
    });
    expect(stop.longTaskCount).toEqual(2);
    expect(stop.totalLongTasksDuration).toBeCloseTo(399.6);
    expect(stop.totalBlockingTime).toBeCloseTo(299.6);
    expect(stop.maxLongTaskDuration).toEqual(312.4);
  });

  it('should install the observer once without buffered entries and reset on every start', async () => {
    const page = createPage();
    evaluateIn(page, client);
    const stop = {};

    await observer.onStart({}, cdp);
    page.emit([100]);
    await observer.onStart({}, cdp);
    page.emit([60]);
    await observer.onStop(stop, cdp);

    expect(page.observe).toHaveBeenCalledTimes(1);
    expect(page.observe).toHaveBeenCalledWith({type: 'longtask', buffered: false});
    expect(stop).toEqual(expect.objectContaining({longTaskCount: 1, totalBlockingTime: 10}));
  });

  it('should accumulate on sampling without resetting', async () => {
    const page = createPage();
    evaluateIn(page, client);
    const firstSample = {};
    const secondSample = {};

    await observer.onStart({}, cdp);
    page.emit([70]);
    await observer.onSampling(firstSample, cdp);
    page.emit([80]);
    await observer.onSampling(secondSample, cdp);

    expect(firstSample).toEqual(expect.objectContaining({longTaskCount: 1, totalBlockingTime: 20}));
    expect(secondSample).toEqual(expect.objectContaining({longTaskCount: 2, totalBlockingTime: 50, maxLongTaskDuration: 80}));
  });

  it('should install the observer with buffered entries when reading a new document', async () => {
    const page = createPage();
    evaluateIn(page, client);

    await observer.onStop({}, cdp);

    expect(page.observe).toHaveBeenCalledWith({type: 'longtask', buffered: true});
  });

  it('should report zeros if long tasks are not supported', async () => {
    evaluateIn(createPage(false), client);
    const accumulator = {};

    await expect(observer.onStop(accumulator, cdp)).resolves.toBeUndefined();
    expect(accumulator).toEqual({
      longTaskCount: 0, totalLongTasksDuration: 0, totalBlockingTime: 0, maxLongTaskDuration: 0,
    });
  });

  it.each([
    ['a protocol error', [new Error('Target closed')]],
    ['an exception in the page', [false, {result: {type: 'object', subtype: 'error'}, exceptionDetails: {text: 'Uncaught'}}]],
    ['an empty value', [false, {result: {type: 'object', subtype: 'null', value: null}}]],
    ['a missing response', [false, undefined]],
  ])('should leave the accumulator untouched on %s', async (_, response) => {
    client.send.mockImplementation((_command: string, _parameters: unknown, callback: Callback) => {
      callback(...response);
    });
    const accumulator = {};

    await expect(observer.onStop(accumulator, cdp)).resolves.toBeUndefined();
    expect(accumulator).toEqual({});
  });
});
