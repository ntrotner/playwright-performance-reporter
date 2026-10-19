import type {
  Fixtures,
  PlaywrightWorkerOptions,
} from '@playwright/test';

/**
 * Fixtures without own test or worker fixtures
 */
type NoFixtures = Record<never, never>;

/**
 * Port the first worker's browser listens on, unless configured otherwise
 */
export const defaultDebuggingPort = 9222;

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
