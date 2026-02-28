import {defineConfig, devices} from '@playwright/test';
import type {Options, ResultAccumulator} from '../lib';
import {nativeChromiumObservers, nativePresenters} from '../lib';

const PlaywrightPerformanceReporterOptions: Options = {
  deleteOnFailure: false,
  presenters: [
    new nativePresenters.jsonChunkPresenter({outputDir: './', outputFile: 'example-json-writer.json'}),
    new nativePresenters.chartPresenter({outputDir: './', outputFile: 'example-chart-presenter.html'}),
  ],
  browsers: {
    chromium: {
      onTest: {
        metrics: [new nativeChromiumObservers.allPerformanceMetrics()],
      },
      onTestStep: {
        metrics: [new nativeChromiumObservers.allPerformanceMetrics()],
      },
      sampling: {
        metrics: [
          {
            samplingTimeoutInMilliseconds: 1000,
            metric: new nativeChromiumObservers.allPerformanceMetrics(),
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
            '--js-flags="--predictable-gc-schedule --gc-interval=1000"'
          ]
        }
      },
    },
  ],
});
