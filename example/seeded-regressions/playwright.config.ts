import path from 'node:path';
import process from 'node:process';
import {defineConfig, devices} from '@playwright/test';
import type {Options} from '../../lib';
import {nativeChromiumObservers, nativePresenters} from '../../lib';
// The presenter's source, so the suite always runs the current presenter and needs no build of packages/attribution.
// Only the presenter is loaded here, never the analysis or the agent.
import {attributionPresenter} from '../../packages/attribution/src/index.js';

// Outputs are resolved from this folder, so the suite writes into example/seeded-regressions/ wherever it runs from.
// Playwright loads this config as CommonJS, so __dirname is the folder of the config.
const suiteDir = __dirname;
const reportDir = path.join(suiteDir, 'report');
// `npm run eval` of packages/attribution points the runs of both states at one shared history
const historyDir = process.env.PERF_HISTORY_DIR ?? path.join(suiteDir, 'performance-history');

const comparisonPresenter = new nativePresenters.comparisonPresenter({
  historyDir,
  outputDir: reportDir,
  // Metrics of allPerformanceMetrics, the only observer on every test
  requiredMetrics: ['JSHeapUsedSize', 'TaskDuration', 'ScriptDuration'],
  recentRuns: 3,
  minBaselineRuns: 3,
  zScoreThreshold: 2,
});

const PlaywrightPerformanceReporterOptions: Options = {
  // Keep the reports of a failed run, and enforce no budgets: the suite measures, it doesn't gate
  deleteOnFailure: false,
  presenters: [
    comparisonPresenter,
    // After the comparison presenter, whose report it hands off. Analyze it with `performance-attribution attribute seeded-regressions/report`
    new attributionPresenter({outputDir: reportDir, comparison: comparisonPresenter, historyDir}),
  ],
  browsers: {
    chromium: {
      onTest: {
        metrics: [new nativeChromiumObservers.allPerformanceMetrics()],
      },
      // The page is closed before the stop of a test, so its heap snapshot and trace are taken per step
      onTestStep: {
        metrics: [
          new nativeChromiumObservers.allPerformanceMetrics(),
          new nativeChromiumObservers.heapDiff({topClasses: 50, writeSnapshots: true, outputDir: path.join(suiteDir, 'heap')}),
          new nativeChromiumObservers.traceCapture({outputDir: path.join(suiteDir, 'traces')}),
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
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['../../lib', PlaywrightPerformanceReporterOptions],
  ],
  use: {
    baseURL: 'http://localhost:4321',
  },
  webServer: {
    // Runs in the folder of this config
    command: 'node app/server.mjs',
    port: 4321,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--remote-debugging-port=9222'],
        },
      },
    },
  ],
});
