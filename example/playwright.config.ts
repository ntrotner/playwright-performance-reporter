import {defineConfig, devices} from '@playwright/test';
import type {Options, ResultAccumulator} from '../lib';
import {nativeChromiumObservers, nativePresenters} from '../lib';

const comparisonPresenter = new nativePresenters.comparisonPresenter({
  historyDir: './performance-history',
  outputDir: './',
  visualReportOutputFile: 'example-comparison.html',
  jsonReportOutputFile: 'example-comparison.json',
  bandPercentile: 0.15
});

const PlaywrightPerformanceReporterOptions: Options = {
  deleteOnFailure: false,
  maxListeners: 10,
  presenters: [
    new nativePresenters.jsonChunkPresenter({outputDir: './', outputFile: 'example-json-writer.json'}),
    new nativePresenters.jsonAggregatePresenter({outputDir: './', outputFile: 'example-json-aggregate.json'}),
    new nativePresenters.chartPresenter({outputDir: './', outputFile: 'example-chart-presenter.html'}),
    comparisonPresenter,
    // Verdicts of the comparison as markdown, also appended to the GitHub Actions job summary
    new nativePresenters.markdownSummaryPresenter({outputDir: './', outputFile: 'example-summary.md', comparison: comparisonPresenter})
  ],
  budgets: {
    // Fails the run if any test or step exceeds the threshold, which is set high to keep the example green
    rules: [
      {metric: 'largestContentfulPaint', max: 10000},
    ],
  },
  browsers: {
    chromium: {
      onTest: {
        metrics: [
          new nativeChromiumObservers.allPerformanceMetrics(),
          new nativeChromiumObservers.webVitals(),
          new nativeChromiumObservers.navigationTiming(),
          new nativeChromiumObservers.resourceTiming()
        ],
      },
      onTestStep: {
        metrics: [
          new nativeChromiumObservers.allPerformanceMetrics(),
          new nativeChromiumObservers.cpuProfiler({triggerGarbageCollectionOnObserve: false}),
          new nativeChromiumObservers.webVitals(),
          new nativeChromiumObservers.navigationTiming(),
          new nativeChromiumObservers.resourceTiming(),
          new nativeChromiumObservers.longTasks(),
          new nativeChromiumObservers.traceCapture({outputDir: './traces'})
        ],
      },
      sampling: {
        metrics: [
          {
            samplingTimeoutInMilliseconds: 1000,
            metric: new nativeChromiumObservers.allPerformanceMetrics(),
          },
          {
            samplingTimeoutInMilliseconds: 1000,
            metric: new nativeChromiumObservers.networkActivity({includeDetailsInSampling: false, triggerGarbageCollectionOnObserve: false}),
          },
          {
            samplingTimeoutInMilliseconds: 1000,
            metric: new nativeChromiumObservers.longTasks(),
          }
        ]
      }
    }
  }
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['../lib', PlaywrightPerformanceReporterOptions]
  ],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--remote-debugging-port=9222',
            '--js-flags="--predictable-gc-schedule --gc-interval=250"'
          ]
        }
      },
    },
  ],
});
