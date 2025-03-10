import {MetricsEngine} from '../src/engines/index.js';
import {type OnStartMeasure} from '../src/types/index.js';
import {BrowserClientFixture} from './fixtures/index.js';

describe('Metrics engine', () => {
  let metricsEngine: MetricsEngine;
  let mockBrowserClient: BrowserClientFixture;

  beforeEach(() => {
    metricsEngine = new MetricsEngine();
    mockBrowserClient = new BrowserClientFixture();
  });

  it('should select the correct browser from input', () => {
    metricsEngine.setupBrowser('chromium', {});
    expect(metricsEngine.getBrowser()).toEqual('chromium');

    metricsEngine.setupBrowser('firefox', {});
    expect(metricsEngine.getBrowser()).toEqual('firefox');

    metricsEngine.setupBrowser('webkit', {});
    expect(metricsEngine.getBrowser()).toEqual('webkit');

    metricsEngine.setupBrowser('chrome', {});
    expect(metricsEngine.getBrowser()).toEqual(undefined);
  });

  it('should not invoke the destroy hook if no browser is setted up', () => {
    metricsEngine.destroy();
    expect(mockBrowserClient.destroy).not.toHaveBeenCalled();
  });

  it('should invoke the destroy hook in the browser client', () => {
    (metricsEngine as any).browser = mockBrowserClient;
    metricsEngine.destroy();
    expect(mockBrowserClient.destroy).toHaveBeenCalled();
  });

  it('should propagate metric to collect', async () => {
    (metricsEngine as any).browser = mockBrowserClient;
    await metricsEngine.getMetric('usedJsHeapSize', 'onStart');
    expect(mockBrowserClient.getMetric).toHaveBeenCalledWith('usedJsHeapSize', 'onStart');
  });

  it('should return undefined when getMetric failed in browser', async () => {
    (metricsEngine as any).browser = mockBrowserClient;
    (metricsEngine as any).browser.getMetric = () => {throw new Error('error')};
    const response = await metricsEngine.getMetric('usedJsHeapSize', 'onStart');
    expect(response).toEqual(undefined);
  });

  it('should return undefined when runCustomMetric failed in browser', async () => {
    (metricsEngine as any).browser = mockBrowserClient;
    (metricsEngine as any).browser.runCustomObserver = () => {throw new Error('error')};
    const onStart: OnStartMeasure = async () => {};
    const response = await metricsEngine.runCustomMetric({onStart} as any, 'onStart');
    expect(response).toEqual(undefined);
  });

  it('should collect all metric by browser', async () => {
    (metricsEngine as any).browser = mockBrowserClient;
    (metricsEngine as any).browser.getMetric.mockResolvedValue(Promise.resolve([{metric1: 123}, {metric2: 456}]));
    const metric = await metricsEngine.getMetric('jsHeapSizeLimit', 'onStop');

    expect(metric).toEqual([{metric1: 123}, {metric2: 456}]);
  });

  it('should skip custom metric in browser client', async () => {
    const onStart: OnStartMeasure = async () => {};
    const metric = await metricsEngine.runCustomMetric({onStart} as any, 'onStart');

    expect(metric).toEqual(undefined);
  });

  it('should run custom metric in browser client', async () => {
    (metricsEngine as any).browser = mockBrowserClient;
    const onStart: OnStartMeasure = async (accumulator, _) => {
      Object.assign(accumulator, {metric: 123});
    };

    mockBrowserClient.runCustomObserver.mockResolvedValue([{metric: 123}]);
    const metric = await metricsEngine.runCustomMetric({onStart} as any, 'onStart');

    expect(metric).toEqual([{metric: 123}]);
  });
});
