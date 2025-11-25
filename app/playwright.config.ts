import {defineConfig, devices} from '@playwright/test';
import type {Options} from '../lib';

const PlaywrightPerformanceReporterOptions: Options = {
  outputDir: './',
  outputFile: `app-output.json`,
  deleteOnFailure: false,
  browsers: {
    chromium: {
      onTest: {
        metrics: ['allPerformanceMetrics'],
        sampleMetrics: {
          allPerformanceMetrics: {
            samplingTimeoutInMilliseconds: 1000,
          }
        }
      },
      onTestStep: {
        metrics: ['allPerformanceMetrics', 'heapObjectsTracking'],
        sampleMetrics: {
          allPerformanceMetrics: {
            samplingTimeoutInMilliseconds: 1000,
          }
        }
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
    baseURL: 'https://heap-insight.ttnr.me',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--remote-debugging-port=9222'
          ]
        }
      },
    },
  ],
});
