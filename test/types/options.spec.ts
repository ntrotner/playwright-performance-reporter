import {defaultOptions, type Options, type MetricSampling} from '../../src/types/options.js';
import {nativeChromiumObservers} from "../../src";

describe('Options Type', () => {
  describe('defaultOptions', () => {
    it('should have correct default structure', () => {
      expect(defaultOptions).toEqual({
        deleteOnFailure: false,
        browsers: {
          chromium: {
            onTest: {
              metrics: expect.arrayContaining([
                expect.objectContaining({
                  name: 'allPerformanceMetrics',
                }),
              ]),
            },
            sampling: {
              metrics: expect.arrayContaining([
                expect.objectContaining({
                  samplingTimeoutInMilliseconds: 1000,
                  metric: expect.objectContaining({
                    name: 'usedJsHeapSize',
                  }),
                }),
              ]),
            },
          },
        },
      });
    });

    it('should have MetricObserver instances in metrics array', () => {
      expect(defaultOptions.browsers.chromium?.onTest?.metrics).toBeDefined();
      expect(defaultOptions.browsers.chromium?.onTest?.metrics.length).toBeGreaterThan(0);
      expect(defaultOptions.browsers.chromium?.onTest?.metrics[0]).toBeInstanceOf(nativeChromiumObservers.allPerformanceMetrics);
    });
  });

  describe('Options type', () => {
    it('should accept MetricObserver instances in metrics array', () => {
      const options: Options = {
        deleteOnFailure: false,
        browsers: {
          chromium: {
            onTest: {
              metrics: [new nativeChromiumObservers.usedJsHeapSize(), new nativeChromiumObservers.totalJsHeapSize()],
            },
          },
        },
      };
      expect(options).toBeDefined();
    });

    it('should accept sampling configuration with MetricObserver instances', () => {
      const options: Options = {
        deleteOnFailure: false,
        browsers: {
          chromium: {
            sampling: {
              metrics: [
                {
                  samplingTimeoutInMilliseconds: 1000,
                  metric: new nativeChromiumObservers.usedJsHeapSize(),
                },
              ],
            },
          },
        },
      };
      expect(options).toBeDefined();
    });
  });

  describe('MetricSampling type', () => {
    it('should require metric property of type MetricObserver', () => {
      const sampling: MetricSampling<any> = {
        samplingTimeoutInMilliseconds: 1000,
        metric: new nativeChromiumObservers.usedJsHeapSize(),
      };
      expect(sampling.metric).toBeInstanceOf(nativeChromiumObservers.usedJsHeapSize);
    });

    it('should accept different MetricObserver instances', () => {
      const sampling1: MetricSampling<any> = {
        samplingTimeoutInMilliseconds: 1000,
        metric: new nativeChromiumObservers.usedJsHeapSize(),
      };
      const sampling2: MetricSampling<any> = {
        samplingTimeoutInMilliseconds: 2000,
        metric: new nativeChromiumObservers.totalJsHeapSize(),
      };
      expect(sampling1.metric).toBeInstanceOf(nativeChromiumObservers.usedJsHeapSize);
      expect(sampling2.metric).toBeInstanceOf(nativeChromiumObservers.totalJsHeapSize);
    });
  });
});
