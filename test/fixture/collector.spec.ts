import {EventEmitter} from 'node:events';
import {
  PerformanceCollector,
} from '../../src/fixture/collector.js';
import {
  nativeChromiumObservers,
  type Options,
  type ResultAccumulator,
} from '../../src/index.js';

class PageFixture extends EventEmitter {
  public readonly frame = {url: () => this.currentUrl};

  constructor(private currentUrl: string) {
    super();
  }

  url() {
    return this.currentUrl;
  }

  mainFrame() {
    return this.frame;
  }

  navigate(url: string) {
    this.currentUrl = url;
    this.emit('framenavigated', this.frame);
  }
}

class ContextFixture extends EventEmitter {
  public readonly session = Object.assign(new EventEmitter(), {
    send: jest.fn(async () => ({metrics: [{name: 'JSHeapUsedSize', value: 42}]})),
  });

  public newCDPSession = jest.fn(async () => this.session);

  constructor(private readonly openPages: PageFixture[]) {
    super();
  }

  pages() {
    return this.openPages;
  }
}

const testInfo = {
  testId: 'test-1',
  titlePath: ['example.spec.ts', 'suite', 'test'],
  project: {name: 'chromium'},
};

const options: Options = {
  deleteOnFailure: false,
  budgets: {rules: [{metric: 'usedJsHeapSize', max: 1}]},
  browsers: {
    chromium: {
      onTest: {metrics: [new nativeChromiumObservers.usedJsHeapSize()]},
      onTestStep: {metrics: [new nativeChromiumObservers.usedJsHeapSize()]},
    },
  },
};

describe('Performance collector', () => {
  it('should measure the test and its nested steps on the pages of the context', async () => {
    const page = new PageFixture('about:blank');
    const context = new ContextFixture([page]);
    const collector = new PerformanceCollector(options, testInfo as any);

    collector.observeContext(context as any);
    await collector.testBegin();
    page.navigate('https://example.com');
    await collector.stepBegin('outer');
    await collector.stepBegin('inner');
    await collector.stepEnd();
    await collector.stepEnd();
    await collector.stepEnd();
    const chunks = await collector.testEnd();

    const entries = chunks.flatMap((chunk: ResultAccumulator) => Object.entries(chunk['test-1']));
    expect(entries.map(([, performance]) => performance.name)).toEqual([
      ' > chromium > example.spec.ts > suite > test',
      'outer',
      'outer > inner',
      'outer > inner',
      'outer',
      ' > chromium > example.spec.ts > suite > test',
    ]);
    const [, stop] = entries.at(-1)!;
    expect(stop.stopMetrics).toEqual([{metric: {usedJsHeapSize: 42}, id: 'page-1', type: 'page', url: 'https://example.com'}]);
  });

  it('should measure pages opened later and skip pages without session', async () => {
    const context = new ContextFixture([]);
    const collector = new PerformanceCollector(options, testInfo as any);
    collector.observeContext(context as any);

    context.newCDPSession.mockRejectedValueOnce(new Error('Target closed'));
    context.emit('page', new PageFixture('https://closed.com'));
    context.emit('page', new PageFixture('https://example.com'));
    await collector.stepBegin('step');
    await collector.stepEnd();
    const chunks = await collector.testEnd();

    const urls = chunks.flatMap(chunk => Object.values(chunk['test-1']).flatMap(performance => performance.stopMetrics.map(metric => metric.url)));
    expect(urls).toEqual(['https://example.com', 'https://example.com']);
  });
});

describe('Performance collector without CDP', () => {
  it('should evaluate the observers in the page of Firefox and WebKit', async () => {
    const page = Object.assign(new PageFixture('https://example.com'), {
      evaluate: jest.fn(async () => ({navigationType: 'navigate', timeToFirstByte: 120})),
    });
    const context = new ContextFixture([page]);
    const collector = new PerformanceCollector({
      deleteOnFailure: false,
      browsers: {webkit: {onTestStep: {metrics: [new nativeChromiumObservers.navigationTiming()]}}},
    }, testInfo as any, 'webkit');

    collector.observeContext(context as any);
    await collector.stepBegin('Open');
    await collector.stepEnd();
    const chunks = await collector.testEnd();

    expect(context.newCDPSession).not.toHaveBeenCalled();
    const stop = chunks.flatMap(chunk => Object.values(chunk['test-1'])).find(performance => performance.stopMetrics.length > 0);
    expect(stop?.stopMetrics).toEqual([{id: 'page-1', type: 'page', url: 'https://example.com', metric: expect.objectContaining({timeToFirstByte: 120}) as unknown}]);
  });
});
