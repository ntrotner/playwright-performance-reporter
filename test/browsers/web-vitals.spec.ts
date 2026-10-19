import vm from 'node:vm';
import type CDP from 'chrome-remote-interface';
import {
  nativeChromiumObservers,
} from '../../src/index.js';
import {
  ChromiumCDPFixture,
} from '../fixtures/chromium-cdp.fixture.js';

type Entry = Record<string, unknown>;
type Callback = (...arguments_: unknown[]) => void;

/**
 * Page whose PerformanceObserver keeps the buffered entries until they are delivered or taken
 */
function createPage(bufferedEntries: Entry[]) {
  const observers: Array<{callback: (list: {getEntries: () => Entry[]}) => void; pending: Entry[]}> = [];
  const context = vm.createContext({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    PerformanceObserver: class {
      private readonly state: {callback: (list: {getEntries: () => Entry[]}) => void; pending: Entry[]};

      constructor(callback: (list: {getEntries: () => Entry[]}) => void) {
        this.state = {callback, pending: []};
        observers.push(this.state);
      }

      observe({type}: {type: string}) {
        this.state.pending.push(...bufferedEntries.filter(entry => entry.entryType === type));
      }

      takeRecords() {
        return this.state.pending.splice(0);
      }
    },
  });
  context.window = context;

  return {
    context,
    deliver(entries: Entry[]) {
      for (const observer of observers) {
        observer.callback({getEntries: () => [...observer.pending.splice(0), ...entries]});
      }
    },
  };
}

describe('Web vitals observer', () => {
  let client: ChromiumCDPFixture;
  let cdp: CDP.Client;

  beforeEach(() => {
    client = new ChromiumCDPFixture();
    cdp = client as unknown as CDP.Client;
  });

  const evaluateIn = (page: ReturnType<typeof createPage>) => {
    client.send.mockImplementation((_command: string, parameters: {expression: string}, callback: Callback) => {
      callback(false, {result: {type: 'object', value: vm.runInContext(parameters.expression, page.context) as unknown}});
    });
  };

  it('should report buffered entries on the first read of a document', async () => {
    const page = createPage([
      {entryType: 'paint', name: 'first-contentful-paint', startTime: 800},
      {entryType: 'largest-contentful-paint', startTime: 1200},
      {entryType: 'layout-shift', value: 0.05, hadRecentInput: false},
    ]);
    evaluateIn(page);
    const accumulator = {};

    await new nativeChromiumObservers.webVitals().onStop(accumulator, cdp);

    expect(accumulator).toEqual({
      largestContentfulPaint: 1200, firstContentfulPaint: 800, cumulativeLayoutShift: 0.05, interactionToNextPaint: 0,
    });
  });

  it('should count delivered and taken entries once and keep them across reads', async () => {
    const page = createPage([{entryType: 'largest-contentful-paint', startTime: 1000}]);
    evaluateIn(page);
    const observer = new nativeChromiumObservers.webVitals();
    const first: Record<string, number> = {};
    const second: Record<string, number> = {};

    await observer.onStart(first, cdp);
    page.deliver([
      {entryType: 'largest-contentful-paint', startTime: 1500},
      {entryType: 'layout-shift', value: 0.1, hadRecentInput: false},
      {entryType: 'layout-shift', value: 0.3, hadRecentInput: true},
      {entryType: 'event', name: 'click', duration: 120, processingEnd: 90, startTime: 0},
      {entryType: 'event', name: 'pointermove', duration: 400, processingEnd: 400, startTime: 0},
    ]);
    await observer.onStop(second, cdp);

    expect(first.largestContentfulPaint).toBe(1000);
    expect(second).toEqual({
      largestContentfulPaint: 1500, firstContentfulPaint: 0, cumulativeLayoutShift: 0.1, interactionToNextPaint: 120,
    });
  });

  it('should leave the accumulator empty if the evaluation fails', async () => {
    client.send.mockImplementation((_command: string, _parameters: unknown, callback: Callback) => {
      callback(new Error('Execution context was destroyed'), undefined);
    });
    const accumulator = {};

    await new nativeChromiumObservers.webVitals().onSampling(accumulator, cdp);

    expect(accumulator).toEqual({});
  });
});
