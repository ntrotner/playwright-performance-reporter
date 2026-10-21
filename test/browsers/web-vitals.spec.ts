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
      largestContentfulPaint: 1500, cumulativeLayoutShift: 0.1, interactionToNextPaint: 120,
    });
  });

  it('should leave out paints that were not recorded yet', async () => {
    const page = createPage([]);
    evaluateIn(page);
    const observer = new nativeChromiumObservers.webVitals();
    const accumulator: Record<string, number> = {};

    await observer.onStop(accumulator, cdp);

    expect(Object.keys(accumulator)).toEqual(['cumulativeLayoutShift', 'interactionToNextPaint']);
  });

  it('should leave the accumulator empty if the evaluation fails', async () => {
    client.send.mockImplementation((_command: string, _parameters: unknown, callback: Callback) => {
      callback(new Error('Execution context was destroyed'), undefined);
    });
    const accumulator = {};

    await new nativeChromiumObservers.webVitals().onSampling(accumulator, cdp);

    expect(accumulator).toEqual({});
  });

  describe('attribution', () => {
    const element = (tagName: string, id = '', classes: string[] = []) => ({nodeType: 1, tagName, id, classList: classes});

    it('should only emit the attribution with the option', async () => {
      const entries = [{entryType: 'largest-contentful-paint', startTime: 1200, element: element('IMG'), url: 'hero.png'}];
      const withoutAttribution: Record<string, string | number> = {};
      const withAttribution: Record<string, string | number> = {};

      evaluateIn(createPage(entries));
      await new nativeChromiumObservers.webVitals().onStop(withoutAttribution, cdp);
      evaluateIn(createPage(entries));
      await new nativeChromiumObservers.webVitals({attribution: true}).onStop(withAttribution, cdp);

      expect(Object.keys(withoutAttribution)).toEqual(['largestContentfulPaint', 'cumulativeLayoutShift', 'interactionToNextPaint']);
      expect(withAttribution).toEqual(expect.objectContaining({lcpElement: 'img', lcpUrl: 'hero.png'}));
    });

    it('should describe the elements that caused LCP, CLS and INP', async () => {
      const page = createPage([
        {entryType: 'largest-contentful-paint', startTime: 900, element: element('H1'), url: '', renderTime: 900, loadTime: 0, size: 2000},
        {entryType: 'largest-contentful-paint', startTime: 1200, element: element('IMG', 'hero', ['banner', 'wide', 'extra']), url: 'https://example.com/hero.png', renderTime: 1200, loadTime: 1000, size: 50_000},
        {entryType: 'layout-shift', value: 0.02, hadRecentInput: false, sources: [{node: element('P')}]},
        // A text node moved, so its parent element is described
        {entryType: 'layout-shift', value: 0.08, hadRecentInput: false, sources: [{node: null}, {node: {nodeType: 3, parentElement: element('DIV', 'ad')}}]},
      ]);
      evaluateIn(page);
      const observer = new nativeChromiumObservers.webVitals({attribution: true});
      const accumulator: Record<string, string | number> = {};

      await observer.onStart({}, cdp);
      page.deliver([
        {entryType: 'event', name: 'keydown', duration: 80, startTime: 100, processingStart: 110, processingEnd: 150, target: element('INPUT', 'search')},
        {entryType: 'event', name: 'click', duration: 200, startTime: 1000, processingStart: 1030, processingEnd: 1150, target: element('BUTTON', '', ['buy'])},
      ]);
      await observer.onStop(accumulator, cdp);

      expect(accumulator).toEqual({
        largestContentfulPaint: 1200,
        cumulativeLayoutShift: 0.1,
        interactionToNextPaint: 200,
        lcpElement: 'img#hero.banner.wide',
        lcpUrl: 'https://example.com/hero.png',
        lcpRenderDelay: 200,
        lcpSize: 50_000,
        clsLargestShiftSource: 'div#ad',
        clsLargestShiftValue: 0.08,
        inpTarget: 'button.buy',
        inpEventType: 'click',
        inpInputDelay: 30,
        inpProcessingDuration: 120,
        inpPresentationDelay: 50,
      });
    });

    it('should leave out the attribution of Web Vitals that did not occur', async () => {
      evaluateIn(createPage([{entryType: 'largest-contentful-paint', startTime: 500, element: null}]));
      const accumulator: Record<string, string | number> = {};

      await new nativeChromiumObservers.webVitals({attribution: true}).onStop(accumulator, cdp);

      expect(accumulator).toEqual(expect.objectContaining({lcpElement: '', lcpUrl: '', lcpRenderDelay: 0}));
      expect(accumulator).not.toHaveProperty('clsLargestShiftSource');
      expect(accumulator).not.toHaveProperty('inpTarget');
    });
  });
});
