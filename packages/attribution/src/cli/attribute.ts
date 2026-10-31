import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  type Complete,
  createAnthropicComplete,
  defaultModel,
} from '../agent/complete.js';
import {
  AttributionContext,
  type Verdict,
} from '../agent/context.js';
import {
  createAgentLoop,
  defaultTimeBudgetMs,
  type RunAttribution,
} from '../agent/loop.js';
import {
  createAttributionTools,
} from '../agent/tools.js';
import {
  capBundle,
  type CappedBundle,
  readBundle,
} from '../analysis/bundle.js';
import {
  bundleFileName,
  type SourceRoot,
} from '../types.js';
import {
  renderMarkdown,
} from './markdown.js';

/**
 * Options of an attribution
 */
export type AttributeOptions = {
  /**
   * Directory of the report, where the bundle is searched and the markdown is written
   */
  reportDir: string;

  /**
   * Bundle file. Defaults to `performance-attribution.json` in the report dir.
   */
  bundle?: string;

  /**
   * Markdown file. Defaults to `attribution.md` in the report dir. `attribution.json` is written next to it.
   */
  output?: string;
  maxRegressions?: number;
  maxChangedFiles?: number;
  maxPromptBytes?: number;

  /**
   * Maximum model calls. Defaults to 30.
   */
  maxSteps?: number;

  /**
   * Defaults to `ATTRIBUTION_MODEL`, or `claude-opus-5`
   */
  model?: string;

  /**
   * Wall-clock seconds the agent may take, model calls and retries included. Defaults to 300.
   */
  timeBudgetSeconds?: number;

  /**
   * Where the app serves files of the repository, added to the source roots of the bundle
   */
  sourceRoots?: SourceRoot[];

  /**
   * False skips the agent, every regression is marked `no-agent`. Defaults to true.
   */
  agent?: boolean;

  /**
   * Model call of the agent loop. Defaults to the Anthropic Messages API with `ANTHROPIC_API_KEY`.
   */
  complete?: Complete;

  /**
   * The whole agent, replacing the loop over `complete`
   */
  runAttribution?: RunAttribution;

  /**
   * Environment with `ANTHROPIC_API_KEY`, `ATTRIBUTION_MODEL` and `GITHUB_STEP_SUMMARY`. Defaults to the process environment.
   */
  env?: NodeJS.ProcessEnv;
};

/**
 * Outcome of an attribution
 */
export type AttributionResult = {
  verdicts: Verdict[];
  markdown: string;
  markdownFile: string;

  /**
   * Files that couldn't be written, e.g. a read-only output directory or job summary. The markdown is printed instead.
   */
  writeErrors: string[];
};

/**
 * Write a file, turning a failure into a message
 *
 * @param description what is written
 * @param write the write
 */
async function tryWrite(description: string, write: () => Promise<void>): Promise<string | undefined> {
  try {
    await write();
    return undefined;
  } catch (error: unknown) {
    return `Could not write ${description}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Verdict of every regression without a culprit
 *
 * @param bundle bundle within the caps
 * @param status status of every verdict
 * @param reason why there is no culprit
 */
function verdictsWithout(bundle: CappedBundle, status: Verdict['status'], reason: string): Verdict[] {
  return bundle.regressions.map(regression => ({
    entityKey: regression.entityKey, name: regression.name, status, culprits: [], confidence: 0, reason, evidence: [],
  }));
}

/**
 * Attribute the regressions of a run to its changed lines and write `attribution.md` and `attribution.json`.
 * Every analysis outcome resolves; problems with the bundle, the artifacts or the agent become stated reasons.
 *
 * @param options report dir, caps and agent
 */
export async function attribute(options: AttributeOptions): Promise<AttributionResult> {
  const env = options.env ?? process.env;
  const bundleFile = options.bundle ?? path.join(options.reportDir, bundleFileName);
  const markdownFile = options.output ?? path.join(options.reportDir, 'attribution.md');
  const notes: string[] = [];
  let bundle: CappedBundle | undefined;
  let verdicts: Verdict[] = [];

  try {
    bundle = capBundle(await readBundle(bundleFile), {maxRegressions: options.maxRegressions, maxChangedFiles: options.maxChangedFiles, maxPromptBytes: options.maxPromptBytes});
    if (options.sourceRoots?.length) {
      bundle.sourceRoots = [...options.sourceRoots, ...(bundle.sourceRoots ?? [])];
    }
  } catch (error) {
    notes.push(`No attribution bundle could be read from ${bundleFile}: ${error instanceof Error ? error.message : String(error)}. Add the AttributionPresenter to the reporter.`);
  }

  if (bundle) {
    if (bundle.omitted.regressions > 0) {
      notes.push(`${bundle.omitted.regressions} more regression(s) not analyzed (maxRegressions ${bundle.caps.maxRegressions}).`);
    }

    if (bundle.omitted.changedFiles > 0) {
      notes.push(`${bundle.omitted.changedFiles} more changed file(s) not considered (maxChangedFiles ${bundle.caps.maxChangedFiles}).`);
    }

    if (bundle.note === 'comparison-unavailable') {
      notes.push(`The comparison of this run is unavailable${bundle.noteDetail ? ` (${bundle.noteDetail})` : ''}, so nothing could be attributed.`);
    } else if (bundle.regressions.length === 0) {
      notes.push('No regressions in this run.');
    }

    verdicts = await attributeBundle(bundle, bundleFile, options, env);
  }

  const markdown = renderMarkdown(bundle, verdicts, notes);
  // Nothing of the analysis is lost if a file can't be written: the failure is reported and the markdown printed
  const writes = [
    await tryWrite(markdownFile, async () => {
      await fs.promises.mkdir(path.dirname(markdownFile), {recursive: true});
      await fs.promises.writeFile(markdownFile, markdown);
    }),
    await tryWrite(path.join(path.dirname(markdownFile), 'attribution.json'), async () => fs.promises.writeFile(path.join(path.dirname(markdownFile), 'attribution.json'), JSON.stringify({
      schemaVersion: 1, generatedAt: new Date().toISOString(), bundle: path.resolve(bundleFile), notes, verdicts,
    }, null, 2))),
    ...(env.GITHUB_STEP_SUMMARY ? [await tryWrite(`the job summary ${env.GITHUB_STEP_SUMMARY}`, async () => fs.promises.appendFile(env.GITHUB_STEP_SUMMARY!, `${markdown}\n`))] : []),
  ];
  const writeErrors = writes.filter((error): error is string => error !== undefined);
  for (const error of writeErrors) {
    console.error(`[PerformanceAttribution] ${error}`);
  }

  return {
    verdicts, markdown, markdownFile, writeErrors,
  };
}

/**
 * Verdicts of a bundle: without changed lines or agent there is nothing to validate, otherwise the agent runs
 *
 * @param bundle bundle within the caps
 * @param bundleFile path of the bundle
 * @param options options of the attribution
 * @param env environment
 */
async function attributeBundle(bundle: CappedBundle, bundleFile: string, options: AttributeOptions, env: NodeJS.ProcessEnv): Promise<Verdict[]> {
  if (bundle.regressions.length === 0) {
    return [];
  }

  if (bundle.unresolved) {
    return verdictsWithout(bundle, 'no-culprit', bundle.unresolved === 'no changes since the baseline commit'
      ? `no changed lines to attribute to: ${bundle.unresolvedDetail ?? bundle.unresolved}`
      : `changed lines unknown: ${bundle.unresolved}`);
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (options.agent === false) {
    return verdictsWithout(bundle, 'no-agent', 'the agent was switched off with --no-agent');
  }

  if (!options.runAttribution && !options.complete && !apiKey) {
    return verdictsWithout(bundle, 'no-agent', 'no agent configured, set ANTHROPIC_API_KEY to attribute');
  }

  let agentProblem: string | undefined;
  const timeBudgetMs = options.timeBudgetSeconds === undefined ? defaultTimeBudgetMs : options.timeBudgetSeconds * 1000;
  const runAttribution = options.runAttribution ?? createAgentLoop({
    complete: options.complete ?? createAnthropicComplete(apiKey!),
    model: options.model ?? env.ATTRIBUTION_MODEL ?? defaultModel,
    maxSteps: options.maxSteps ?? 30,
    maxPromptBytes: bundle.caps.maxPromptBytes,
    timeBudgetMs,
    onStop(reason) {
      agentProblem = reason;
    },
  });
  const context = new AttributionContext(bundle, bundleFile);
  let timer: NodeJS.Timeout | undefined;
  try {
    // Also bounds an injected agent; the loop above stops on its own at the same budget
    await Promise.race([
      runAttribution(bundle, createAttributionTools(context)),
      new Promise<void>(resolve => {
        timer = setTimeout(() => {
          agentProblem ??= `the agent reached its time budget (${Math.round(timeBudgetMs / 1000)} s)`;
          resolve();
        }, timeBudgetMs + 1000);
      }),
    ]);
  } catch (error) {
    agentProblem = `the agent failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
  }

  return context.verdicts(agentProblem);
}
