import type {
  Fixtures,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from '@playwright/test';
import {
  defaultDebuggingPort,
  fixtureAttachmentName,
} from '../types/constants.js';
import {
  type Options,
} from '../types/index.js';
import {
  PerformanceCollector,
} from './collector.js';

/**
 * Fixtures without own test or worker fixtures
 */
type NoFixtures = Record<never, never>;

/**
 * Options for the per worker debugging port
 */
export type PerWorkerDebuggingPortOptions = {
  /**
   * Port of the worker with parallel index 0. Worker `n` uses `base + n`. Defaults to 9222.
   */
  base?: number;
};

/**
 * Worker fixtures that launch the browser of every worker with its own remote debugging port,
 * so the reporter can measure multiple workers in parallel.
 * Use together with the reporter option `debuggingPort: {perWorker: true}`.
 *
 * @example
 * import {test as base} from '@playwright/test';
 * import {perWorkerDebuggingPort} from 'playwright-performance-reporter/fixture';
 *
 * export const test = base.extend(perWorkerDebuggingPort());
 *
 * @param options first port
 */
export function perWorkerDebuggingPort(options: PerWorkerDebuggingPortOptions = {}): Fixtures<NoFixtures, NoFixtures, NoFixtures, PlaywrightWorkerOptions> {
  const base = options.base ?? defaultDebuggingPort;

  return {
    launchOptions: [async ({launchOptions}, use, workerInfo) => {
      const args = (launchOptions.args ?? []).filter(argument => !argument.startsWith('--remote-debugging-port'));
      await use({...launchOptions, args: [...args, `--remote-debugging-port=${base + workerInfo.parallelIndex}`]});
    }, {scope: 'worker'}],
  };
}

export {
  defaultDebuggingPort,
} from '../types/constants.js';

/**
 * Collector of the test that currently runs in this worker. A worker runs one test at a time.
 */
let activeCollector: PerformanceCollector | undefined;

/**
 * Default test type of Playwright
 */
type BaseTestType = TestType<PlaywrightTestArgs & PlaywrightTestOptions, PlaywrightWorkerArgs & PlaywrightWorkerOptions>;

/**
 * Measure every test inside its worker on Playwright's CDP session, for the reporter option `mode: 'fixture'`.
 * Works with any amount of workers and with sharding, as no debugging port is needed.
 * `test.step()` of the returned test type measures the step, so apply it after all other `extend` calls.
 *
 * @example
 * import {test as base} from '@playwright/test';
 * import {withPerformance} from 'playwright-performance-reporter/fixture';
 * import {performanceOptions} from './performance-options';
 *
 * export const test = withPerformance(base, performanceOptions);
 *
 * @param base test type to extend
 * @param options same options as passed to the reporter
 */
export function withPerformance<T extends BaseTestType>(base: T, options: Options): T {
  const test = (base as BaseTestType).extend<{performanceCollector: PerformanceCollector | undefined}>({
    // The requests of the API request context are recorded for `requestTiming`
    async request({request, performanceCollector}, use) {
      await use(performanceCollector ? performanceCollector.wrapApiRequest(request) : request);
    },
    performanceCollector: [async ({context, browserName}, use, testInfo) => {
      if (browserName !== 'chromium') {
        // CDP sessions are only available in Chromium
        await use(undefined);
        return;
      }

      const collector = new PerformanceCollector(options, testInfo);
      collector.observeContext(context);
      activeCollector = collector;
      try {
        await collector.testBegin();
        await use(collector);
      } finally {
        activeCollector = undefined;
        const chunks = await collector.testEnd();
        await testInfo.attach(fixtureAttachmentName, {body: JSON.stringify(chunks), contentType: 'application/json'});
      }
    }, {auto: true}],
  });

  const originalStep = test.step;
  const step: typeof test.step = async (title, body, stepOptions) => originalStep(title, async stepInfo => {
    const collector = activeCollector;
    if (!collector) {
      return body(stepInfo);
    }

    await collector.stepBegin(title);
    try {
      return await body(stepInfo);
    } finally {
      await collector.stepEnd();
    }
  }, stepOptions);
  step.skip = originalStep.skip;
  test.step = step;

  return test as unknown as T;
}
