import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type {
  RunAttribution,
} from '../src/agent/index.js';
import {
  type AttributionResult,
  runCli,
} from '../src/cli.js';
import {
  temporaryDirectory,
} from './helpers.js';
import {
  appFile,
  createReportDir,
} from './fixtures/report.js';

/**
 * Run the CLI with captured output
 *
 * @param argv arguments after the binary
 * @param options environment and agent seam
 */
async function cli(argv: string[], options: {env?: Record<string, string | undefined>; runAttribution?: RunAttribution} = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(argv, {
    env: options.env ?? {},
    runAttribution: options.runAttribution,
    stdout: text => stdout.push(text),
    stderr: text => stderr.push(text),
  });
  return {exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n')};
}

/**
 * Agent that submits the given culprits for the first regression, through the tools like a model would
 *
 * @param culprits submitted culprits
 */
function scriptedAgent(culprits: Array<{file: string; line: number; basis?: 'cpu' | 'heap'; confidence?: number}>): RunAttribution {
  return async ({tools}) => {
    await tools.read_bundle.execute!({}, {});
    await tools.attribute_to_hunks.execute!({entityKey: 'case1|Render rows|0'}, {});
    await tools.submit_verdict.execute!({entityKey: 'case1|Render rows|0', culprits}, {});
    return {steps: 2};
  };
}

const readResult = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as AttributionResult;

describe('performance-attribution attribute', () => {
  let stepSummary: string | undefined;

  beforeEach(() => {
    stepSummary = process.env.GITHUB_STEP_SUMMARY;
  });

  afterEach(() => {
    if (stepSummary === undefined) {
      delete process.env.GITHUB_STEP_SUMMARY;
    } else {
      process.env.GITHUB_STEP_SUMMARY = stepSummary;
    }
  });

  it('attributes a regression to a changed hunk, recomputing the confidence the agent submitted', async () => {
    const {dir} = createReportDir();
    const json = path.join(dir, 'result.json');

    const {exitCode, stdout} = await cli(['attribute', dir, '--json', json], {
      runAttribution: scriptedAgent([{
        file: appFile, line: 55, basis: 'cpu', confidence: 0.01,
      }]),
    });

    const result = readResult(json);
    expect(exitCode).toBe(0);
    expect(result.status).toBe('attributed');
    expect(result.regressions[0]).toMatchObject({entityKey: 'case1|Render rows|0', verdict: 'attributed'});
    expect(result.regressions[0].culprits.map(culprit => [culprit.file, culprit.line, culprit.confidence])).toEqual([[appFile, 55, 'high']]);
    expect(result.regressions[1]).toMatchObject({entityKey: 'case2|Idle|0', verdict: 'no-culprit'});
    expect(stdout).toContain(`${appFile}:55`);
    const markdown = fs.readFileSync(path.join(dir, 'attribution.md'), 'utf8');
    expect(markdown).toContain(`\`${appFile}:55\``);
    expect(markdown).toContain('high');
  });

  it('drops culprits outside of the changed hunks, which leaves no culprit', async () => {
    const {dir} = createReportDir();
    const json = path.join(dir, 'result.json');

    await cli(['attribute', dir, '--json', json], {runAttribution: scriptedAgent([{file: 'vendor/lib.js', line: 3}, {file: appFile, line: 99}])});

    const result = readResult(json);
    expect(result.status).toBe('no-culprit');
    expect(result.regressions[0].culprits).toEqual([]);
    expect(result.regressions[0].dropped.map(culprit => culprit.file)).toEqual(['vendor/lib.js', appFile]);
  });

  it('marks the run no-agent without an api key, and still lists the evidence inside the hunks', async () => {
    const {dir} = createReportDir();
    const json = path.join(dir, 'result.json');
    const summary = path.join(temporaryDirectory('attribution-summary-'), 'summary.md');
    fs.writeFileSync(summary, '# Earlier step\n');
    process.env.GITHUB_STEP_SUMMARY = summary;

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const {exitCode} = await cli(['attribute', dir, '--json', json], {env: {GITHUB_STEP_SUMMARY: summary}});

    const result = readResult(json);
    expect(exitCode).toBe(0);
    expect(result.status).toBe('no-agent');
    expect(result.regressions[0].culprits).toEqual([]);
    expect(result.regressions[0].candidates.map(candidate => `${candidate.file}:${candidate.line}`)).toEqual([`${appFile}:55`]);
    const markdown = fs.readFileSync(path.join(dir, 'attribution.md'), 'utf8');
    expect(markdown).toContain('no-agent');
    expect(fs.readFileSync(summary, 'utf8')).toBe(`# Earlier step\n${markdown}\n`);
  });

  it('marks the run no-agent if the agent fails, and keeps exit code 0', async () => {
    const {dir} = createReportDir();
    const json = path.join(dir, 'result.json');

    const {exitCode, stderr} = await cli(['attribute', dir, '--json', json], {
      async runAttribution() {
        throw new Error('The Messages API answered 529: Overloaded');
      },
    });

    expect(exitCode).toBe(0);
    expect(readResult(json).status).toBe('no-agent');
    expect(readResult(json).message).toContain('529');
    expect(stderr).toContain('529');
  });

  it('keeps the verdicts the agent submitted before its model call failed', async () => {
    const {dir} = createReportDir();
    const json = path.join(dir, 'result.json');
    const submitThenFail: RunAttribution = async options => {
      await scriptedAgent([{file: appFile, line: 55, basis: 'cpu'}])(options);
      throw new Error('The Messages API answered 529: Overloaded');
    };

    const {exitCode, stderr} = await cli(['attribute', dir, '--json', json], {runAttribution: submitThenFail});

    const result = readResult(json);
    expect(exitCode).toBe(0);
    expect(result.status).toBe('attributed');
    expect(result.message).toContain('529');
    expect(result.regressions.map(regression => regression.verdict)).toEqual(['attributed', 'no-culprit']);
    expect(stderr).toContain('529');
  });

  it('skips the agent if no lines were added between the baseline and the run', async () => {
    const {dir} = createReportDir({changedFiles: []});
    const json = path.join(dir, 'result.json');
    let agentRan = false;

    await cli(['attribute', dir, '--json', json], {
      async runAttribution() {
        agentRan = true;
        return {steps: 0};
      },
    });

    const result = readResult(json);
    expect([agentRan, result.status]).toEqual([false, 'no-culprit']);
    expect(result.message).toContain('No lines were added');
    expect(result.regressions.map(regression => regression.verdict)).toEqual(['no-culprit', 'no-culprit']);
  });

  it.each([
    ['no-revision-metadata', 'The run recorded no commit (metadata.commit), so its changes are unknown.'],
    ['git-unavailable', 'The run commit abc is not available in /repo, e.g. git is missing or the clone is shallow: fatal'],
    ['baseline-not-an-ancestor', 'The baseline commit a is not an ancestor of the run commit b.'],
  ] as const)('reproduces the reason %s of the bundle verbatim, never guessing a culprit', async (status, message) => {
    const {dir} = createReportDir({status, message, changedFiles: []});
    const json = path.join(dir, 'result.json');
    let agentRan = false;

    const {exitCode} = await cli(['attribute', dir, '--json', json], {
      async runAttribution() {
        agentRan = true;
        return {steps: 0};
      },
    });

    expect([exitCode, agentRan]).toEqual([0, false]);
    expect(readResult(json)).toMatchObject({status, message});
    const markdown = fs.readFileSync(path.join(dir, 'attribution.md'), 'utf8');
    expect(markdown).toContain(`\`${status}\``);
    expect(markdown).toContain(message);
  });

  it('applies the caps from the flags', async () => {
    const {dir} = createReportDir();
    const json = path.join(dir, 'result.json');

    await cli(['attribute', dir, '--json', json, '--max-regressions', '1', '--max-changed-files', '0', '--max-prompt-bytes', '50000']);

    const result = readResult(json);
    expect(result.truncated).toEqual({regressions: 1, changedFiles: 1});
    expect(result.regressions.map(regression => regression.entityKey)).toEqual(['case1|Render rows|0']);
    expect(result.regressions[0].candidates).toEqual([]);
  });

  it('writes the markdown to --out and reads the bundle from --bundle', async () => {
    const {bundlePath} = createReportDir();
    const other = temporaryDirectory('attribution-out-');
    const out = path.join(other, 'nested', 'out.md');

    const {exitCode} = await cli(['attribute', other, '--bundle', bundlePath, '--out', out]);

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toContain('Performance attribution');
  });

  it('exits 2 only for a missing or malformed bundle', async () => {
    const missing = temporaryDirectory('attribution-missing-');
    const {dir, bundlePath} = createReportDir();
    fs.writeFileSync(bundlePath, '{"schemaVersion": 1}');

    const results = [await cli(['attribute', missing]), await cli(['attribute', dir])];

    expect(results.map(result => result.exitCode)).toEqual([2, 2]);
    expect(results[0].stderr).toContain('attribution-bundle.json');
    expect(results[1].stderr).toContain('malformed');
    expect(fs.existsSync(path.join(dir, 'attribution.md'))).toBe(false);
  });

  it('logs an internal error to stderr and exits 0', async () => {
    const {dir} = createReportDir();
    const blocked = path.join(dir, 'blocked');
    fs.writeFileSync(blocked, '');

    const {exitCode, stderr} = await cli(['attribute', dir, '--out', path.join(blocked, 'attribution.md')]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('blocked');
  });

  it('prints the usage for unknown commands and flags', async () => {
    const results = [await cli(['explain']), await cli(['attribute']), await cli(['attribute', '.', '--max-regressions', 'many'])];

    expect(results.map(result => result.exitCode)).toEqual([1, 1, 1]);
  });
});
