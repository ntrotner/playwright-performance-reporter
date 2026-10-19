import {defineConfig, devices} from '@playwright/test';
import type {Options} from '../lib';
import {nativeChromiumObservers, nativePresenters} from '../lib';

const PlaywrightPerformanceReporterOptions: Options = {
  deleteOnFailure: false,
  // Connect to port 9222 + parallelIndex, matching the fixture in tests-multi-worker/fixtures.ts
  debuggingPort: {perWorker: true, base: 9222},
  presenters: [
    new nativePresenters.jsonAggregatePresenter({outputDir: './', outputFile: 'example-multi-worker.json'}),
  ],
  browsers: {
    chromium: {
      onTestStep: {
        metrics: [
          new nativeChromiumObservers.allPerformanceMetrics(),
          new nativeChromiumObservers.navigationTiming(),
        ],
      },
      sampling: {
        metrics: [
          {
            samplingTimeoutInMilliseconds: 500,
            metric: new nativeChromiumObservers.usedJsHeapSize(),
          },
        ],
      },
    },
  },
};

export default defineConfig({
  testDir: './tests-multi-worker',
  fullyParallel: true,
  workers: 3,
  reporter: [
    ['list'],
    ['../lib', PlaywrightPerformanceReporterOptions],
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
