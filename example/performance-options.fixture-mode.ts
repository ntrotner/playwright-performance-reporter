import type {Options} from '../lib';
import {nativeChromiumObservers, nativePresenters} from '../lib';

// Shared by the reporter and the fixture: the fixture measures inside the workers, the reporter writes the output
export const performanceOptions: Options = {
  deleteOnFailure: false,
  mode: 'fixture',
  presenters: [
    new nativePresenters.jsonAggregatePresenter({outputDir: './', outputFile: 'example-fixture-mode.json'}),
  ],
  budgets: {
    rules: [{metric: 'largestContentfulPaint', max: 10_000}],
  },
  browsers: {
    chromium: {
      onTest: {
        metrics: [new nativeChromiumObservers.allPerformanceMetrics()],
      },
      onTestStep: {
        metrics: [
          new nativeChromiumObservers.allPerformanceMetrics(),
          new nativeChromiumObservers.cpuProfiler({triggerGarbageCollectionOnObserve: false}),
          new nativeChromiumObservers.webVitals(),
          new nativeChromiumObservers.networkActivity({includeDetailsInSampling: false, triggerGarbageCollectionOnObserve: false}),
        ],
      },
      sampling: {
        metrics: [
          {samplingTimeoutInMilliseconds: 500, metric: new nativeChromiumObservers.usedJsHeapSize()},
        ],
      },
    },
  },
};
