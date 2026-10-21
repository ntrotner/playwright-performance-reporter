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
type Frame = Record<string, unknown>;

/**
 * Page with a PerformanceObserver that keeps frames until they are delivered or taken
 */
function createPage(supported = true) {
  const states: Array<{callback: (list: {getEntries: () => Frame[]}) => void; pending: Frame[]}> = [];
  const observe = jest.fn();
  const context = vm.createContext({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    PerformanceObserver: Object.assign(class {
      private readonly state: {callback: (list: {getEntries: () => Frame[]}) => void; pending: Frame[]};

      constructor(callback: (list: {getEntries: () => Frame[]}) => void) {
        this.state = {callback, pending: []};
        states.push(this.state);
      }

      observe(options: unknown) {
        observe(options);
      }

      takeRecords() {
        return this.state.pending.splice(0);
      }
    }, {supportedEntryTypes: supported ? ['longtask', 'long-animation-frame'] : ['longtask']}),
  });
  context.window = context;

  return {
    context,
    observe,
    // Frames that are queued but not delivered to the callback yet
    queue(frames: Frame[]) {
      for (const state of states) {
        state.pending.push(...frames);
      }
    },
    deliver(frames: Frame[]) {
      for (const state of states) {
        state.callback({getEntries: () => frames});
      }
    },
  };
}

const script = (sourceURL: string, duration: number, extra: Frame = {}) => ({
  sourceURL, sourceFunctionName: 'render', invoker: 'BUTTON.onclick', invokerType: 'event-listener', duration, forcedStyleAndLayoutDuration: 0, ...extra,
});

describe('Long animation frames observer', () => {
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

  it('should aggregate the frames and rank the scripts since the start', async () => {
    const page = createPage();
    evaluateIn(page);
    const observer = new nativeChromiumObservers.longAnimationFrames({topScripts: 2});
    const start: Record<string, string | number> = {};
    const stop: Record<string, string | number> = {};

    page.queue([{startTime: 1, duration: 500, blockingDuration: 450, scripts: [script('before.js', 400)]}]);
    await observer.onStart(start, cdp);
    page.deliver([
      {startTime: 10, duration: 120, blockingDuration: 70, scripts: [script('app.js', 80, {forcedStyleAndLayoutDuration: 15}), script('ads.js', 10)]},
      {startTime: 200, duration: 90, blockingDuration: 40, scripts: [script('app.js', 60)]},
    ]);
    page.queue([{startTime: 400, duration: 60, blockingDuration: 10, scripts: [script('widget.js', 30)]}]);
    await observer.onStop(stop, cdp);

    expect(observer.name).toBe('longAnimationFrames');
    expect(page.observe).toHaveBeenCalledWith({type: 'long-animation-frame', buffered: false});
    expect(start).toEqual(expect.objectContaining({loafSupported: 1, loafCount: 0, loafTopScripts: '[]'}));
    expect(stop).toEqual({
      loafSupported: 1,
      loafCount: 3,
      totalLoafDuration: 270,
      totalLoafBlockingDuration: 120,
      maxLoafDuration: 120,
      totalForcedStyleAndLayoutDuration: 15,
      loafTopScripts: expect.any(String) as string,
    });
    expect(JSON.parse(String(stop.loafTopScripts))).toEqual([
      {...script('app.js', 140, {forcedStyleAndLayoutDuration: 15}), count: 2},
      {...script('widget.js', 30), count: 1},
    ]);
  });

  it('should include the frames on request and install buffered on a new document', async () => {
    const page = createPage();
    evaluateIn(page);
    const accumulator: Record<string, string | number> = {};

    const observer = new nativeChromiumObservers.longAnimationFrames({includeFrames: true});
    await observer.onSampling({}, cdp);
    page.queue([{startTime: 5, duration: 70}]);
    await observer.onSampling(accumulator, cdp);

    expect(page.observe).toHaveBeenCalledWith({type: 'long-animation-frame', buffered: true});
    expect(JSON.parse(String(accumulator.loafFrames))).toEqual([{startTime: 5, duration: 70, blockingDuration: 0, scripts: []}]);
  });

  it('should report zeros without support', async () => {
    const page = createPage(false);
    evaluateIn(page);
    const accumulator = {};

    await new nativeChromiumObservers.longAnimationFrames().onStop(accumulator, cdp);

    expect(page.observe).not.toHaveBeenCalled();
    expect(accumulator).toEqual({
      loafSupported: 0,
      loafCount: 0,
      totalLoafDuration: 0,
      totalLoafBlockingDuration: 0,
      maxLoafDuration: 0,
      totalForcedStyleAndLayoutDuration: 0,
      loafTopScripts: '[]',
    });
  });

  it('should leave the accumulator untouched if the evaluation fails', async () => {
    client.send.mockImplementation((_command: string, _parameters: unknown, callback: Callback) => {
      callback(new Error('Target closed'));
    });
    const accumulator = {};

    await new nativeChromiumObservers.longAnimationFrames().onStop(accumulator, cdp);

    expect(accumulator).toEqual({});
  });

  it.each([
    ['loafCount', 'cumulative', 'count'],
    ['totalLoafDuration', 'cumulative', 'ms'],
    ['totalLoafBlockingDuration', 'cumulative', 'ms'],
    ['maxLoafDuration', 'cumulative', 'ms'],
    ['totalForcedStyleAndLayoutDuration', 'cumulative', 'ms'],
  ])('should classify %s as %s in %s', (metric, kind, unit) => {
    expect(classifyMetric(metric)).toBe(kind);
    expect(metricUnit(metric)).toBe(unit);
  });

  it('should not compare the support flag', () => {
    expect(ignoredMetrics.has('loafSupported')).toBe(true);
  });
});
