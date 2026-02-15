import {MetricsEngine} from '../src/engines/index.js';
import {BrowserClientFixture} from './fixtures/index.js';
import {BrowserDeveloperToolsClient, MetricObserver, nativeChromiumObservers, SupportedBrowsers} from "../src/index.js";

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
    const metricObserver = new nativeChromiumObservers.usedJsHeapSize() as MetricObserver<BrowserDeveloperToolsClient[SupportedBrowsers]>;
    await metricsEngine.getMetric(metricObserver, 'onStart');
    expect(mockBrowserClient.getMetric).toHaveBeenCalledWith(metricObserver, 'onStart');
  });

  it('should return undefined when getMetric failed in browser', async () => {
    (metricsEngine as any).browser = mockBrowserClient;
    (metricsEngine as any).browser.getMetric = () => {throw new Error('error')};
    const metricObserver = new nativeChromiumObservers.usedJsHeapSize() as MetricObserver<BrowserDeveloperToolsClient[SupportedBrowsers]>;
    const response = await metricsEngine.getMetric(metricObserver, 'onStart');
    expect(response).toEqual(undefined);
  });

  it('should collect all metric by browser', async () => {
    (metricsEngine as any).browser = mockBrowserClient;
    (metricsEngine as any).browser.getMetric.mockResolvedValue(Promise.resolve([{metric1: 123}, {metric2: 456}]));
    const metricObserver = new nativeChromiumObservers.usedJsHeapSize() as MetricObserver<BrowserDeveloperToolsClient[SupportedBrowsers]>;
    const metric = await metricsEngine.getMetric(metricObserver, 'onStop');

    expect(metric).toEqual([{metric1: 123}, {metric2: 456}]);
  });
});
