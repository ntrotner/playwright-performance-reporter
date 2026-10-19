import vm from 'node:vm';
import type CDP from 'chrome-remote-interface';
import {
  nativeChromiumObservers,
} from '../../src/index.js';
import {
  classifyMetric,
  ignoredMetrics,
  metricUnit,
} from '../../src/presenters/comparison-presenter/constants.js';
import {
  ChromiumCDPFixture,
} from '../fixtures/chromium-cdp.fixture.js';

type Callback = (...arguments_: unknown[]) => void;
type Entry = Record<string, unknown>;

/**
 * Page with a PerformanceObserver per type, which keeps entries until they are delivered or taken
 */
function createPage(unsupported: string[] = []) {
  const observers: Array<{type?: string; callback: (list: {getEntries: () => Entry[]}) => void; pending: Entry[]}> = [];
  const observe = jest.fn();
  const context = vm.createContext({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    PerformanceObserver: class {
      private readonly state: {type?: string; callback: (list: {getEntries: () => Entry[]}) => void; pending: Entry[]};

      constructor(callback: (list: {getEntries: () => Entry[]}) => void) {
        this.state = {callback, pending: []};
        observers.push(this.state);
      }

      observe(options: {type: string}) {
        observe(options);
        if (unsupported.includes(options.type)) {
          throw new TypeError(`${options.type} is not supported`);
        }

        this.state.type = options.type;
      }

      takeRecords() {
        return this.state.pending.splice(0);
      }
    },
  });
  context.window = context;

  return {
    context,
    observe,
    queue(entries: Entry[]) {
      for (const entry of entries) {
        observers.find(observer => observer.type === entry.entryType)?.pending.push(entry);
      }
    },
    deliver(entries: Entry[]) {
      for (const observer of observers) {
        const own = entries.filter(entry => entry.entryType === observer.type);
        if (own.length > 0) {
          observer.callback({getEntries: () => own});
        }
      }
    },
  };
}

describe('User timing observer', () => {
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

  it('should collect marks, measures and element timings since the start', async () => {
    const page = createPage();
    evaluateIn(page);
    const observer = new nativeChromiumObservers.userTiming();
    const stop: Record<string, string | number> = {};

    await observer.onStart({}, cdp);
    page.deliver([
      {entryType: 'mark', name: 'route-start', startTime: 1200},
      {entryType: 'measure', name: 'editor ready', duration: 340, startTime: 1200},
      {entryType: 'measure', name: 'editor ready', duration: 360, startTime: 2000},
    ]);
    page.queue([{entryType: 'element', identifier: 'hero', renderTime: 0, loadTime: 1500}]);
    await observer.onStop(stop, cdp);

    expect(observer.name).toBe('userTiming');
    expect(page.observe.mock.calls.map(([options]) => options as unknown)).toEqual([
      {type: 'mark', buffered: false}, {type: 'measure', buffered: false}, {type: 'element', buffered: false},
    ]);
    expect(stop).toEqual({
      'userTiming:mark:route-start': 1200,
      'userTiming:measure:editor_ready': 360,
      'userTiming:element:hero': 1500,
      userTimingMarkCount: 1,
      userTimingMeasureCount: 2,
      userTimingElementCount: 1,
      userTimingDroppedNames: 0,
    });
  });

  it('should filter by name and type, use a prefix and bound the names', async () => {
    const page = createPage(['element']);
    evaluateIn(page);
    const observer = new nativeChromiumObservers.userTiming({
      namePattern: 'api:*', entryTypes: ['measure'], prefix: 'app', maxNames: 2,
    });
    const accumulator: Record<string, string | number> = {};

    await observer.onSampling({}, cdp);
    page.deliver([
      {entryType: 'measure', name: 'api:users', duration: 10},
      {entryType: 'measure', name: 'api:posts', duration: 20},
      {entryType: 'measure', name: 'api:tags', duration: 30},
      {entryType: 'measure', name: 'render', duration: 40},
      {entryType: 'mark', name: 'api:mark', startTime: 1},
    ]);
    await observer.onSampling(accumulator, cdp);

    expect(page.observe).toHaveBeenCalledWith({type: 'mark', buffered: true});
    expect(accumulator).toEqual({
      'app:measure:api:users': 10,
      'app:measure:api:posts': 20,
      appMarkCount: 0,
      appMeasureCount: 3,
      appElementCount: 0,
      appDroppedNames: 1,
    });
  });

  it('should leave the accumulator untouched if the evaluation fails', async () => {
    client.send.mockImplementation((_command: string, _parameters: unknown, callback: Callback) => {
      callback(new Error('Target closed'));
    });
    const accumulator = {};

    await new nativeChromiumObservers.userTiming().onStop(accumulator, cdp);

    expect(accumulator).toEqual({});
  });

  it.each([
    ['userTiming:measure:editor-ready', 'total', 'ms'],
    ['userTiming:measure:fontSize', 'total', 'ms'],
    ['userTiming:element:hero', 'total', 'ms'],
    ['userTimingMeasureCount', 'cumulative', 'count'],
  ])('should classify %s as %s in %s', (metric, kind, unit) => {
    expect(classifyMetric(metric)).toBe(kind);
    expect(metricUnit(metric)).toBe(unit);
  });

  it('should not compare the dropped names', () => {
    expect(ignoredMetrics.has('userTimingDroppedNames')).toBe(true);
  });
});
