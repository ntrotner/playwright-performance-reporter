import {MetricsEngine} from '../src/engines';
import {type OnStartMeasure} from '../src/types';
import {BrowserClientFixture} from './fixtures';

describe('Playwright Performance Reporter', () => {
  let metricsEngine: MetricsEngine;
  let mockBrowserClient: BrowserClientFixture;

  beforeEach(() => {
    metricsEngine = new MetricsEngine();
    mockBrowserClient = new BrowserClientFixture();
  });

  it('should select the correct browser from input', () => {
    metricsEngine.setupBrowser('chromium');
    expect(metricsEngine.getBrowser()).toEqual('chromium');

    metricsEngine.setupBrowser('firefox');
    expect(metricsEngine.getBrowser()).toEqual('firefox');

    metricsEngine.setupBrowser('webkit');
    expect(metricsEngine.getBrowser()).toEqual('webkit');

    metricsEngine.setupBrowser('chrome');
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
    await metricsEngine.getMetric('usedJsHeapSize');
    expect(mockBrowserClient.getMetric).toHaveBeenCalledWith('usedJsHeapSize');
  });

  it('should only collect first metric by browser', async () => {
    (metricsEngine as any).browser = mockBrowserClient;
    (metricsEngine as any).browser.getMetric.mockResolvedValue(Promise.resolve([{metric1: 123}, {metric2: 456}]));
    const metric = await metricsEngine.getMetric('jsHeapSizeLimit');

    expect(metric).toEqual({metric1: 123});
  });

  it('should skip custom metric in browser client', async () => {
    const onStart: OnStartMeasure = async () => ({metric: 123});
    const metric = await metricsEngine.runCustomMetric(onStart);

    expect(metric).toEqual(undefined);
  });

  it('should run custom metric in browser client', async () => {
    (metricsEngine as any).browser = mockBrowserClient;
    const onStart: OnStartMeasure = async () => ({metric: 123});
    const metric = await metricsEngine.runCustomMetric(onStart);

    expect(metric).toEqual({metric: 123});
  });
});
