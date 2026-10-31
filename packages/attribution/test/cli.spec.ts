import {
  execFileSync,
} from 'node:child_process';
import {
  Buffer,
} from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  jest,
} from '@jest/globals';
import {
  attribute,
  type AttributionTools,
  type CompletionPrompt,
  type CompletionResult,
  createAnthropicComplete,
  main,
  needsHeapFlag,
  reexecArguments,
  type RunAttribution,
} from '../src/cli/index.js';
import type {
  AttributionBundle,
  BundleRegression,
} from '../src/types.js';
import {
  createStep,
  leakyApp as fixture,
  leakyAppHunk,
  leakyAppLine,
  temporaryDirectory,
  writeTrace,
} from './helpers.js';

const pushLine = leakyAppLine('cache.push(record);');
const appUrl = 'http://localhost:4321/server.mjs?session=secret-session-token';

/**
 * Regression of a step with the given increased metric and artifacts
 *
 * @param key entity key
 * @param metric increased metric
 * @param artifacts trace and heap snapshot of the step
 */
function regression(key: string, metric: string, artifacts: BundleRegression['artifacts']): BundleRegression {
  const step = createStep(key, 'regressed', [{metric, status: 'increased'}]);
  return {
    entityKey: step.key, name: step.name, kind: step.kind, testId: step.testId, testName: step.testName, stepName: step.stepName, status: 'regressed', duration: step.duration, changes: step.changes, basis: [/heap/i.test(metric) ? 'heap' : 'cpu'], artifacts,
    ...(/heap/i.test(metric) ? {heapDiffTopClasses: JSON.stringify([{name: 'LeakedRecord', count: 2000, selfSize: 40_000}, {name: '(string)', count: 2000, selfSize: 90_000}])} : {}),
  };
}

/**
 * Report dir of a run with a CPU regression in `render` and a leak in `leak`:
 * changed lines 50-60 of `example/app/server.mjs` and line 13 of the leaky app
 *
 * @param overrides changes of the bundle
 */
function createReportDir(overrides: Partial<AttributionBundle> = {}): {dir: string; bundle: AttributionBundle} {
  const dir = temporaryDirectory('attribution-report-');
  writeTrace(path.join(dir, 'traces/render.json.gz'), [
    {
      functionName: 'heavyRender', url: appUrl, lineNumber: 44, samples: [[59, 60], [46, 20]],
    },
    {
      functionName: 'vendor', url: 'http://localhost:4321/vendor.js', lineNumber: 0, samples: [[1, 20]],
    },
  ]);
  fs.mkdirSync(path.join(dir, 'heap'));
  execFileSync(process.execPath, [fixture, path.join(dir, 'heap/leak.heapsnapshot')]);
  const bundle: AttributionBundle = {
    schemaVersion: 1,
    generatedAt: '2026-10-31T00:00:00.000Z',
    run: {commit: 'b'.repeat(40), branch: 'feature', baselineCommit: 'a'.repeat(40)},
    hunks: [
      {file: 'example/app/server.mjs', absoluteFile: '/repo/example/app/server.mjs', addedRanges: [{start: 50, end: 60}]},
      leakyAppHunk([pushLine]),
    ],
    sourceRoots: [{url: 'http://localhost:4321/', path: 'example/app'}],
    regressions: [
      // Recorded relative to the report dir, and with a stale absolute path, as if the run happened elsewhere
      regression('case1|Render|0', 'TaskDuration', {traceFile: {file: 'traces/render.json.gz', absoluteFile: '/elsewhere/traces/render.json.gz'}}),
      regression('case2|Leak|0', 'heapDiffAddedBytes', {heapDiffFile: {file: 'heap/leak.heapsnapshot', absoluteFile: path.join(dir, 'heap/leak.heapsnapshot')}}),
    ],
    caps: {maxRegressions: 25, maxChangedFiles: 200, maxPromptBytes: 200_000},
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, 'performance-attribution.json'), JSON.stringify(bundle));
  return {dir, bundle};
}

/**
 * Agent that submits the strongest candidate of every regression, plus a culprit outside of the changed lines
 *
 * @param tools tools of the attribution
 * @param bundle bundle of the run
 */
const scriptedAgent: RunAttribution = async (bundle, tools) => {
  await tools.read_bundle.execute!({}, {});
  // The tools run one after another, like an agent
  /* eslint-disable no-await-in-loop */
  for (const {entityKey} of bundle.regressions) {
    const result = await tools.attribute_to_hunks.execute!({entityKey}, {}) as {candidates: Array<{file: string; startLine: number; basis: 'cpu' | 'heap'; symbol?: string}>};
    await tools.submit_verdict.execute!({
      entityKey,
      culprits: [
        ...result.candidates.slice(0, 1).map(candidate => ({
          file: candidate.file, line: candidate.startLine, basis: candidate.basis, symbol: candidate.symbol, evidence: ['strongest candidate'], confidence: 0.01,
        })),
        {
          file: 'src/unchanged.ts', line: 3, basis: 'cpu', evidence: ['a guess'],
        },
      ],
    }, {});
  }
  /* eslint-enable no-await-in-loop */
};

/**
 * Model that calls the tools like the scripted agent, one call per turn
 */
function scriptedModel(): {complete: (prompt: CompletionPrompt) => Promise<CompletionResult>; prompts: string[]} {
  const prompts: string[] = [];
  const turns: Array<(prompt: CompletionPrompt) => CompletionResult> = [
    () => ({
      stopReason: 'tool_use', content: [{
        type: 'tool_use', id: 't1', name: 'read_bundle', input: {},
      }],
    }),
    () => ({
      stopReason: 'tool_use', content: [{
        type: 'tool_use', id: 't2', name: 'trace_self_time', input: {entityKey: 'case1|Render|0'},
      }, {
        type: 'tool_use', id: 't3', name: 'heap_growth', input: {entityKey: 'case2|Leak|0'},
      }],
    }),
    () => ({
      stopReason: 'tool_use', content: [{
        type: 'tool_use', id: 't4', name: 'attribute_to_hunks', input: {entityKey: 'case1|Render|0'},
      }],
    }),
    () => ({
      stopReason: 'tool_use', content: [
        {type: 'text', text: 'heavyRender on line 59 is the culprit.'},
        {
          type: 'tool_use', id: 't5', name: 'submit_verdict', input: {
            entityKey: 'case1|Render|0', culprits: [{
              file: 'example/app/server.mjs', line: 59, basis: 'cpu', symbol: 'heavyRender', evidence: ['60 ms on line 59'],
            }],
          },
        },
      ],
    }),
    () => ({stopReason: 'end_turn', content: [{type: 'text', text: 'Done.'}]}),
  ];
  return {
    prompts,
    async complete(prompt) {
      prompts.push(JSON.stringify(prompt));
      return turns[Math.min(prompts.length - 1, turns.length - 1)](prompt);
    },
  };
}

/**
 * Wrap every tool to record its results
 *
 * @param agent agent to run with the wrapped tools
 * @param results recorded results
 */
function spyOnTools(agent: RunAttribution, results: string[]): RunAttribution {
  return async (bundle, tools) => {
    const wrapped = Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, {
      ...tool,
      async execute(input: unknown, context: unknown) {
        const result = await (tool.execute as (input: unknown, context: unknown) => Promise<unknown>)(input, context);
        results.push(JSON.stringify(result));
        return result;
      },
    }])) as unknown as AttributionTools;
    await agent(bundle, wrapped);
  };
}

/**
 * Raw content of the artifacts that must never leave them
 */
const rawArtifactContent = ['secret-session-token', 'secret-heap-token', 'traceEvents', 'ProfileChunk', 'node_fields'];

describe('performance-attribution attribute', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('attributes every regression to the changed lines, drops culprits outside of them and recomputes the confidence', async () => {
    const {dir} = createReportDir();
    const toolResults: string[] = [];

    const result = await attribute({reportDir: dir, runAttribution: spyOnTools(scriptedAgent, toolResults), env: {}});

    expect(result.verdicts.map(verdict => [verdict.entityKey, verdict.status, verdict.culprits.map(culprit => `${culprit.file}:${culprit.startLine}`), verdict.confidence])).toEqual([
      ['case1|Render|0', 'attributed', ['example/app/server.mjs:59'], 0.72],
      ['case2|Leak|0', 'attributed', [`test/fixtures/leaky-app.mjs:${pushLine}`], 0.96],
    ]);
    expect(result.verdicts[0].evidence.join('\n')).toContain('src/unchanged.ts:3');
    for (const content of rawArtifactContent) {
      expect(toolResults.join('\n')).not.toContain(content);
    }
  });

  it('marks a regression without a culprit on the changed lines as no-culprit', async () => {
    const {dir} = createReportDir();
    const guessingAgent: RunAttribution = async (bundle, tools) => {
      await tools.submit_verdict.execute!({
        entityKey: 'case1|Render|0', culprits: [{
          file: 'example/app/server.mjs', line: 46, basis: 'cpu', evidence: ['declared here'],
        }],
      }, {});
    };

    const {verdicts} = await attribute({reportDir: dir, runAttribution: guessingAgent, env: {}});

    // The leak was never analyzed, so it isn't claimed to have no culprit
    expect(verdicts.map(verdict => [verdict.status, verdict.culprits, verdict.confidence])).toEqual([['no-culprit', [], 0], ['no-agent', [], 0]]);
    expect(verdicts[0].evidence.join('\n')).toContain('example/app/server.mjs:46');
  });

  it('runs the agent loop on the injected model, and never sends a raw artifact to it', async () => {
    const {dir} = createReportDir();
    const model = scriptedModel();

    const {verdicts} = await attribute({reportDir: dir, complete: model.complete, env: {}});

    expect(verdicts.map(verdict => [verdict.status, verdict.culprits[0]?.startLine])).toEqual([['attributed', 59], ['no-culprit', undefined]]);
    expect(model.prompts).toHaveLength(5);
    for (const content of rawArtifactContent) {
      expect(model.prompts.join('\n')).not.toContain(content);
    }
  });

  it('stops the agent after max steps', async () => {
    const {dir} = createReportDir();
    const prompts: string[] = [];
    const endless = async (prompt: CompletionPrompt): Promise<CompletionResult> => {
      prompts.push(JSON.stringify(prompt));
      return {
        stopReason: 'tool_use', content: [{
          type: 'tool_use', id: `t${prompts.length}`, name: 'read_bundle', input: {},
        }],
      };
    };

    const {verdicts} = await attribute({
      reportDir: dir, complete: endless, maxSteps: 3, env: {},
    });

    expect(prompts).toHaveLength(3);
    // The agent never got to a verdict, which says nothing about the changed lines
    expect(verdicts.map(verdict => [verdict.status, verdict.reason])).toEqual([
      ['no-agent', 'the agent stopped before a verdict: the agent reached maxSteps (3)'],
      ['no-agent', 'the agent stopped before a verdict: the agent reached maxSteps (3)'],
    ]);
  });

  it('marks every regression no-agent with the error if the model API stays unavailable', async () => {
    const {dir} = createReportDir();
    let calls = 0;
    const unavailable = createAnthropicComplete('test-key', {
      async fetch() {
        calls++;
        return new Response('{"type":"error","error":{"type":"overloaded_error"}}', {status: 529});
      },
      sleep: async () => undefined,
    });

    const {verdicts} = await attribute({reportDir: dir, complete: unavailable, env: {}});

    expect(calls).toBe(5);
    expect(verdicts.map(verdict => verdict.status)).toEqual(['no-agent', 'no-agent']);
    expect(verdicts[0].reason).toContain('Anthropic API responded 529');
  });

  it('stops a model call that outlasts the time budget, and marks the regressions no-agent', async () => {
    const {dir} = createReportDir();
    const started = Date.now();
    // Ignores the abort signal, like a hanging connection
    const hanging = async (): Promise<CompletionResult> => new Promise(() => {
      // Never settles
    });

    const {verdicts} = await attribute({
      reportDir: dir, complete: hanging, timeBudgetSeconds: 1, env: {},
    });

    expect(Date.now() - started).toBeLessThan(5000);
    expect(verdicts.map(verdict => [verdict.status, verdict.reason])).toEqual([
      ['no-agent', 'the agent stopped before a verdict: the agent reached its time budget (1 s)'],
      ['no-agent', 'the agent stopped before a verdict: the agent reached its time budget (1 s)'],
    ]);
  });

  it('lists a culprit once, even if the agent claims it twice', async () => {
    const {dir} = createReportDir();
    const repeatingAgent: RunAttribution = async (bundle, tools) => {
      await tools.submit_verdict.execute!({
        entityKey: 'case1|Render|0',
        culprits: [{file: 'example/app/server.mjs', line: 59, basis: 'cpu'}, {
          file: 'example/app/server.mjs', line: 58, endLine: 60, basis: 'cpu',
        }, {file: 'example/app/server.mjs', line: 59, basis: 'cpu'}],
      }, {});
    };

    const {verdicts, markdown} = await attribute({reportDir: dir, runAttribution: repeatingAgent, env: {}});

    expect(verdicts[0].culprits.map(culprit => `${culprit.file}:${culprit.startLine}`)).toEqual(['example/app/server.mjs:59']);
    expect(markdown.match(/`example\/app\/server\.mjs:59`/g)).toHaveLength(2);
  });

  it('keeps every request to the model within max prompt bytes', async () => {
    const {dir} = createReportDir();
    const sizes: number[] = [];
    const model = scriptedModel();

    await attribute({
      reportDir: dir,
      maxPromptBytes: 12_000,
      async complete(prompt, options) {
        sizes.push(Buffer.byteLength(JSON.stringify({prompt, tools: options.tools})));
        return model.complete(prompt);
      },
      env: {},
    });

    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(12_000);
  });

  it('writes the bundle-derived report as no-agent without an API key, and appends it to the job summary', async () => {
    const {dir} = createReportDir();
    const summary = path.join(temporaryDirectory(), 'summary.md');
    fs.writeFileSync(summary, '# Earlier step\n');

    // Name of the environment variable
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const exitCode = await main(['attribute', dir], {GITHUB_STEP_SUMMARY: summary});

    const markdown = fs.readFileSync(path.join(dir, 'attribution.md'), 'utf8');
    expect(exitCode).toBe(0);
    expect(markdown).toContain('## Performance attribution');
    expect(markdown).toContain('| test > Render | TaskDuration (+100 %) | 100 ms | 200 ms | – | – | ⚪ no-agent |');
    expect(fs.readFileSync(summary, 'utf8')).toBe(`# Earlier step\n${markdown}\n`);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'attribution.json'), 'utf8')) as {verdicts: Array<{status: string}>};
    expect(written.verdicts.map(verdict => verdict.status)).toEqual(['no-agent', 'no-agent']);
  });

  it('renders the culprits, their confidence and evidence', async () => {
    const {dir} = createReportDir();

    await attribute({reportDir: dir, runAttribution: scriptedAgent, env: {}});

    const markdown = fs.readFileSync(path.join(dir, 'attribution.md'), 'utf8');
    expect(markdown).toContain('| test > Render | TaskDuration (+100 %) | 100 ms | 200 ms | `example/app/server.mjs:59` heavyRender | 0.72 | 🎯 attributed |');
    expect(markdown).toContain('`bbbbbbb` against baseline `aaaaaaa`');
  });

  it('states why nothing can be attributed if the changed lines are unknown', async () => {
    const {dir} = createReportDir({unresolved: 'baseline commit is not an ancestor', hunks: []});

    const {verdicts, markdown} = await attribute({reportDir: dir, runAttribution: scriptedAgent, env: {}});

    expect(verdicts.map(verdict => [verdict.status, verdict.reason])).toEqual([
      ['no-culprit', 'changed lines unknown: baseline commit is not an ancestor'],
      ['no-culprit', 'changed lines unknown: baseline commit is not an ancestor'],
    ]);
    expect(markdown).toContain('fetch-depth');
  });

  it('never analyzes an artifact after the agent finished, and marks what it left out as no-agent', async () => {
    const {dir} = createReportDir();
    // Parsing it would fail and show up as evidence
    fs.writeFileSync(path.join(dir, 'heap/leak.heapsnapshot'), 'not a snapshot');
    const renderOnly: RunAttribution = async (bundle, tools) => {
      await tools.attribute_to_hunks.execute!({entityKey: 'case1|Render|0'}, {});
      await tools.submit_verdict.execute!({entityKey: 'case1|Render|0', culprits: [{file: 'example/app/server.mjs', line: 59, basis: 'cpu'}]}, {});
    };

    const {verdicts} = await attribute({reportDir: dir, runAttribution: renderOnly, env: {}});

    expect(verdicts.map(verdict => [verdict.status, verdict.reason, verdict.evidence])).toEqual([
      ['attributed', undefined, []],
      ['no-agent', 'the agent finished without analyzing it', []],
    ]);
  });

  it('skips the agent and says so if nothing changed since the baseline commit', async () => {
    const {dir} = createReportDir({unresolved: 'no changes since the baseline commit', unresolvedDetail: 'every baseline run is of the current commit bbbbbbb', hunks: []});
    let called = false;

    const {verdicts, markdown} = await attribute({
      reportDir: dir,
      async runAttribution() {
        called = true;
      },
      env: {},
    });

    expect(called).toBe(false);
    expect(verdicts.map(verdict => [verdict.status, verdict.reason])).toEqual([
      ['no-culprit', 'no changed lines to attribute to: every baseline run is of the current commit bbbbbbb'],
      ['no-culprit', 'no changed lines to attribute to: every baseline run is of the current commit bbbbbbb'],
    ]);
    expect(markdown).toContain('> No lines changed since the baseline commit (every baseline run is of the current commit bbbbbbb), so there is nothing to attribute to.');
    expect(markdown).not.toContain('fetch-depth');
  });

  it('degrades a missing or unreadable artifact to a stated reason', async () => {
    const {dir} = createReportDir();
    fs.writeFileSync(path.join(dir, 'traces/render.json.gz'), 'not a trace');
    fs.rmSync(path.join(dir, 'heap/leak.heapsnapshot'));

    const {verdicts} = await attribute({reportDir: dir, runAttribution: scriptedAgent, env: {}});

    expect(verdicts.map(verdict => verdict.status)).toEqual(['no-culprit', 'no-culprit']);
    expect(verdicts[0].evidence.join('\n')).toMatch(/trace .*unreadable/);
    expect(verdicts[1].evidence.join('\n')).toMatch(/heap snapshot .*missing/);
  });

  it('applies the caps of the bundle and of the flags', async () => {
    const {dir} = createReportDir();

    const {verdicts, markdown} = await attribute({
      reportDir: dir, maxRegressions: 1, agent: false, env: {},
    });

    expect(verdicts.map(verdict => verdict.entityKey)).toEqual(['case1|Render|0']);
    expect(markdown).toContain('1 more regression(s) not analyzed');
  });

  it('says the comparison was unavailable instead of claiming no regressions', async () => {
    const {dir} = createReportDir({regressions: [], note: 'comparison-unavailable', noteDetail: 'comparison report unavailable: history is corrupt'});

    const {markdown} = await attribute({reportDir: dir, agent: false, env: {}});

    expect(markdown).toContain('> The comparison of this run is unavailable (comparison report unavailable: history is corrupt), so nothing could be attributed.');
    expect(markdown).not.toContain('No regressions');
  });

  it('reports a missing bundle and exits 0', async () => {
    const dir = temporaryDirectory();

    expect(await main(['attribute', dir], {})).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'attribution.md'), 'utf8')).toContain('No attribution bundle');
  });

  it('keeps going if the job summary or the output are not writable, and prints the markdown instead', async () => {
    const {dir} = createReportDir();
    const summary = path.join(temporaryDirectory(), 'summary.md');
    fs.writeFileSync(summary, '');
    fs.chmodSync(summary, 0o444);
    const readOnlyDir = temporaryDirectory();
    fs.chmodSync(readOnlyDir, 0o555);
    const log = jest.spyOn(console, 'log');

    try {
      // Name of the environment variable
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const exitCode = await main(['attribute', dir, '--no-agent', '--output', path.join(readOnlyDir, 'attribution.md')], {GITHUB_STEP_SUMMARY: summary});
      // Name of the environment variable
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const result = await attribute({reportDir: dir, agent: false, env: {GITHUB_STEP_SUMMARY: summary}});

      expect(exitCode).toBe(0);
      expect(log.mock.calls.some(([message]) => String(message).startsWith('## Performance attribution'))).toBe(true);
      expect(result.writeErrors).toEqual([expect.stringContaining(`the job summary ${summary}`)]);
      expect(fs.readFileSync(path.join(dir, 'attribution.md'), 'utf8')).toContain('no-agent');
    } finally {
      fs.chmodSync(readOnlyDir, 0o755);
    }
  });

  it('exits 2 on usage errors', async () => {
    expect(await main([], {})).toBe(2);
    expect(await main(['attribute'], {})).toBe(2);
    expect(await main(['attribute', '/does/not/exist'], {})).toBe(2);
    expect(await main(['attribute', '.', '--max-steps', 'many'], {})).toBe(2);
    expect(await main(['attribute', '.', '--source-root', 'server.mjs'], {})).toBe(2);
  });
});

describe('default complete over the Anthropic Messages API', () => {
  const prompt: CompletionPrompt = {system: 'system', messages: [{role: 'user', content: 'hello'}]};
  const options = {model: 'claude-opus-5', maxTokens: 100, tools: []};

  it('retries rate limits and server errors with backoff, honouring retry-after', async () => {
    const responses = [
      new Response('{}', {status: 429, headers: {'retry-after': '2'}}),
      new Response('{}', {status: 500}),
      // Field of the Messages API
      // eslint-disable-next-line @typescript-eslint/naming-convention
      Response.json({content: [{type: 'text', text: 'hi'}], stop_reason: 'end_turn'}),
    ];
    const delays: number[] = [];
    const complete = createAnthropicComplete('test-key', {
      fetch: async () => responses.shift()!,
      async sleep(milliseconds) {
        delays.push(milliseconds);
      },
      random: () => 0,
    });

    const result = await complete(prompt, options);

    expect(result).toEqual({content: [{type: 'text', text: 'hi'}], stopReason: 'end_turn'});
    // Retry-after of 2 s, then 2 s of exponential backoff at the lowest jitter
    expect(delays).toEqual([2000, 1000]);
  });

  it('retries a failed connection, but not a rejected request', async () => {
    let calls = 0;
    const flaky = createAnthropicComplete('test-key', {
      async fetch() {
        calls++;
        if (calls === 1) {
          throw new TypeError('fetch failed');
        }

        return new Response('{"error":"invalid model"}', {status: 400});
      },
      sleep: async () => undefined,
    });

    await expect(flaky(prompt, options)).rejects.toThrow('Anthropic API responded 400');
    expect(calls).toBe(2);
  });
});

describe('heap flag of the bin', () => {
  it('re-executes node with a raised heap unless one is set', () => {
    expect(needsHeapFlag([], '')).toBe(true);
    expect(needsHeapFlag(['--max-old-space-size=4096'], '')).toBe(false);
    expect(needsHeapFlag([], '--max-old-space-size=2048')).toBe(false);
    expect(reexecArguments(['--enable-source-maps'], '/bin/cli.js', ['attribute', 'dir'])).toEqual(['--max-old-space-size=8192', '--enable-source-maps', '/bin/cli.js', 'attribute', 'dir']);
  });
});
