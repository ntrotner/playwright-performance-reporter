import {
  defaultDebuggingPort,
  perWorkerDebuggingPort,
} from '../../src/fixture/index.js';

type LaunchOptions = {args?: string[]; headless?: boolean};
type LaunchOptionsFixture = [
  (fixtures: {launchOptions: LaunchOptions}, use: (value: LaunchOptions) => Promise<void>, workerInfo: {parallelIndex: number}) => Promise<void>,
  {scope: string},
];

/**
 * Run the launch options fixture of a worker and return the launch options it provides
 */
async function launchOptionsOf(fixtures: ReturnType<typeof perWorkerDebuggingPort>, launchOptions: LaunchOptions, parallelIndex: number): Promise<LaunchOptions> {
  const [fixture, settings] = fixtures.launchOptions as unknown as LaunchOptionsFixture;
  expect(settings).toEqual({scope: 'worker'});

  let provided: LaunchOptions = {};
  await fixture({launchOptions}, async value => {
    provided = value;
  }, {parallelIndex});
  return provided;
}

describe('Per worker debugging port fixture', () => {
  it('should launch every worker with its own port and keep the other options', async () => {
    const launchOptions = {headless: true, args: ['--remote-debugging-port=9222', '--mute-audio']};

    expect(await launchOptionsOf(perWorkerDebuggingPort(), launchOptions, 0)).toEqual({headless: true, args: ['--mute-audio', `--remote-debugging-port=${defaultDebuggingPort}`]});
    expect(await launchOptionsOf(perWorkerDebuggingPort(), launchOptions, 3)).toEqual({headless: true, args: ['--mute-audio', '--remote-debugging-port=9225']});
  });

  it('should use the configured base port without arguments', async () => {
    expect(await launchOptionsOf(perWorkerDebuggingPort({base: 9400}), {}, 1)).toEqual({args: ['--remote-debugging-port=9401']});
  });
});
