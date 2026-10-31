import path from 'node:path';
import process from 'node:process';
import {defineConfig, devices} from '@playwright/test';
import type {Options} from '../../lib';
import {nativeChromiumObservers, nativePresenters} from '../../lib';
import {AttributionPresenter} from '../../packages/attribution/lib/index.js';

// Every output is resolved from this folder, so the suite writes into example/seeded-regressions/ wherever it runs from.
// Playwright loads this config as CommonJS, so __dirname is the folder of the config.
const outputDir = __dirname;
const historyDir = process.env.PERF_HISTORY_DIR ?? path.join(outputDir, 'performance-history');

const comparisonPresenter = new nativePresenters.comparisonPresenter({
  // `npm run eval` of packages/attribution shares one history between the worktrees of the base and the head commit
  historyDir,
  outputDir,
  jsonReportOutputFile: 'seeded-comparison.json',
  visualReportOutputFile: 'seeded-comparison.html',
  // Metrics of allPerformanceMetrics, the only required observer of this suite
  requiredMetrics: ['JSHeapUsedSize', 'TaskDuration', 'ScriptDuration'],
  // Compare the latest run alone, so a single run of the head commit is not smoothed out by runs of the base commit
  recentRuns: 1,
});

const PlaywrightPerformanceReporterOptions: Options = {
  deleteOnFailure: false,
  presenters: [
    new nativePresenters.jsonChunkPresenter({outputDir, outputFile: 'seeded-json-writer.json'}),
    comparisonPresenter,
    new nativePresenters.markdownSummaryPresenter({outputDir, outputFile: 'seeded-summary.md', comparison: comparisonPresenter, githubStepSummary: false}),
    // Registered after the comparison presenter, as it reads its report. Analyze it with `performance-attribution attribute seeded-regressions`
    // The app serves app/ at the root of its origin, so http://localhost:4321/server.mjs is app/server.mjs of the repository
    new AttributionPresenter({
      outputDir, comparison: comparisonPresenter, historyDir, sourceRoots: [{url: 'http://localhost:4321/', path: path.join(outputDir, 'app')}],
    }),
  ],
  browsers: {
    chromium: {
      // The page is closed before the stop of a test, so its heap snapshot and trace are taken per step
      onTest: {
        metrics: [new nativeChromiumObservers.allPerformanceMetrics()],
      },
      onTestStep: {
        metrics: [
          new nativeChromiumObservers.allPerformanceMetrics(),
          new nativeChromiumObservers.longTasks(),
          new nativeChromiumObservers.heapDiff({topClasses: 50, writeSnapshots: true, outputDir: path.join(outputDir, 'heap')}),
          // Chrome records one trace per target, so only the steps are traced
          new nativeChromiumObservers.traceCapture({outputDir: path.join(outputDir, 'traces')}),
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
