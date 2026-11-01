import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  parseArgs,
} from 'node:util';
import {
  createAttributionContext,
} from './agent/context.js';
import {
  type Complete,
  defaultModel,
  resolveComplete,
} from './agent/complete.js';
import {
  type RunAttribution,
  runAttribution as defaultRunAttribution,
} from './agent/run-attribution.js';
import {
  createAttributionTools,
} from './agent/tools.js';
import {
  type AttributionCaps,
  BundleError,
  capBundle,
  defaultCaps,
  parseBundle,
} from './analysis/bundle.js';
import {
  renderMarkdown,
} from './markdown.js';
import type {
  AttributionResult,
  RegressionResult,
  RegressionVerdict,
} from './result.js';
import {
  bundleFileName,
} from './types.js';

export type * from './result.js';
export {
  renderMarkdown,
} from './markdown.js';

/**
 * Input and output of the CLI, injectable for tests
 */
export type CliIo = {
  env?: Record<string, string | undefined>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;

  /**
   * Model call, instead of the Messages API
   */
  complete?: Complete;

  /**
   * The agent seam, replaced by a scripted agent in tests
   */
  runAttribution?: RunAttribution;
};

/**
 * Options of `attribute`
 */
export type AttributeOptions = {
  reportDir: string;

  /**
   * Defaults to `<report-dir>/attribution-bundle.json`
   */
  bundle?: string;

  /**
   * Markdown file. Defaults to `attribution.md` next to the bundle.
   */
  out?: string;

  /**
   * Machine-readable result file, written if set
   */
  json?: string;
  caps: AttributionCaps;
};

const usage = `Usage: performance-attribution attribute <report-dir> [options]

Attributes the regressions of the attribution bundle in <report-dir> to the changed hunks of the commit range.

Options:
  --bundle <file>              bundle file (default: <report-dir>/${bundleFileName})
  --out <file>                 markdown file (default: attribution.md next to the bundle)
  --json <file>                write the machine-readable result
  --max-regressions <n>        default ${defaultCaps.maxRegressions}
  --max-changed-files <n>      default ${defaultCaps.maxChangedFiles}
  --max-prompt-bytes <n>       default ${defaultCaps.maxPromptBytes}

Environment: ANTHROPIC_API_KEY enables the agent (otherwise the run is no-agent), ATTRIBUTION_MODEL (default ${defaultModel}).
Exit codes: 2 for a missing or malformed bundle, 1 for wrong arguments, otherwise 0.`;

/**
 * Exit code of a missing or malformed bundle
 */
export const bundleExitCode = 2;

/**
 * Short message of an error
 *
 * @param error error
 */
function describeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 400);
}

/**
 * Model call of an injected agent seam that didn't bring one
 */
const noModel: Complete = async () => {
  throw new Error('No model call is configured');
};

/**
 * Verdict of a regression from its validated culprits
 *
 * @param result regression without its verdict
 */
function verdictOf(result: Pick<RegressionResult, 'culprits'>): RegressionVerdict {
  if (result.culprits.some(culprit => culprit.confidence === 'high')) {
    return 'attributed';
  }

  return result.culprits.length > 0 ? 'low-confidence' : 'no-culprit';
}

/**
 * Attribute the regressions of a bundle: cap it, analyze the artifacts, let the agent pick culprits, validate them
 * against the changed hunks, and write `attribution.md`. Throws a `BundleError` for a missing or malformed bundle;
 * every other failure ends up in the result.
 *
 * @param options report directory, files and caps
 * @param io environment and seams
 */
export async function attribute(options: AttributeOptions, io: CliIo = {}): Promise<AttributionResult> {
  const env = io.env ?? process.env;
  const stderr = io.stderr ?? (text => process.stderr.write(`${text}\n`));
  const bundlePath = path.resolve(options.bundle ?? path.join(options.reportDir, bundleFileName));
  let text: string;
  try {
    text = await fs.promises.readFile(bundlePath, 'utf8');
  } catch (error) {
    throw new BundleError(`No attribution bundle at ${bundlePath}: ${describeError(error)}`);
  }

  const {bundle, truncated} = capBundle(parseBundle(text), options.caps);
  const model = env.ATTRIBUTION_MODEL ?? defaultModel;
  const result: AttributionResult = {
    schemaVersion: 1, status: 'no-culprit', message: bundle.message, run: bundle.run, truncated, regressions: [],
  };
  const baseRegression = (regression: (typeof bundle.regressions)[number]): RegressionResult => ({
    entityKey: regression.entityKey,
    name: regression.name,
    status: regression.status,
    changes: regression.changes.map(change => ({
      metric: change.metric, unit: change.unit, baselineMedian: change.baselineMedian, current: change.current, relativeChange: change.relativeChange,
    })),
    verdict: 'not-analyzed',
    culprits: [],
    candidates: [],
    dropped: [],
    problems: [],
  });

  try {
    if (bundle.status !== 'ok') {
      // No changed hunks to attribute to: the reason of the bundle, verbatim
      result.status = bundle.status;
      result.regressions = bundle.regressions.map(regression => baseRegression(regression));
      return result;
    }

    if (bundle.changedFiles.length === 0) {
      // Nothing to attribute to, so the agent could only answer no-culprit
      result.status = 'no-culprit';
      result.message = truncated.changedFiles > 0
        ? `Every changed file was left out by --max-changed-files (${options.caps.maxChangedFiles}), so nothing can be attributed.`
        : `No lines were added between the baseline ${bundle.run.baselineCommit?.slice(0, 7) ?? 'commit'} and the run commit ${bundle.run.commit?.slice(0, 7) ?? ''}, so nothing can be attributed.`;
      result.regressions = bundle.regressions.map(regression => ({...baseRegression(regression), verdict: 'no-culprit'}));
      return result;
    }

    const context = createAttributionContext({bundle, bundleDir: path.dirname(bundlePath), maxPromptBytes: options.caps.maxPromptBytes});
    const complete = resolveComplete(env, io.complete);
    // An injected agent seam brings its own model, if it needs one
    const agentAvailable = complete !== undefined || io.runAttribution !== undefined;
    // Why no agent result can be used, and why the agent ended early while its verdicts still count
    let agentFailure: string | undefined;
    let agentError: string | undefined;
    if (agentAvailable && bundle.regressions.length > 0) {
      result.model = model;
      try {
        const run = io.runAttribution ?? defaultRunAttribution;
        result.agent = await run({
          bundle, tools: createAttributionTools(context), complete: complete ?? noModel, maxPromptBytes: options.caps.maxPromptBytes, model,
        });
        if (result.agent.stopReason && context.verdicts.size === 0) {
          agentFailure = `The agent stopped before any verdict: ${result.agent.stopReason}.`;
        }
      } catch (error) {
        agentError = `The agent failed: ${describeError(error)}`;
        stderr(`[performance-attribution] ${agentError}`);
        // Verdicts submitted before the failure passed validation and are kept
        if (context.verdicts.size === 0) {
          agentFailure = agentError;
        }
      }
    }

    const agentRan = agentAvailable && agentFailure === undefined;
    for (const regression of bundle.regressions) {
      // eslint-disable-next-line no-await-in-loop
      const {candidates, problems} = await context.analyzer.attribute(regression.entityKey);
      const verdict = context.verdicts.get(regression.entityKey);
      const entry: RegressionResult = {
        ...baseRegression(regression), candidates, problems, culprits: agentRan ? verdict?.culprits ?? [] : [], dropped: agentRan ? verdict?.dropped ?? [] : [],
      };
      entry.verdict = agentRan ? verdictOf(entry) : 'no-agent';
      result.regressions.push(entry);
    }

    if (agentRan) {
      const verdicts = new Set(result.regressions.map(regression => regression.verdict));
      result.status = verdicts.has('attributed') ? 'attributed' : (verdicts.has('low-confidence') ? 'low-confidence' : 'no-culprit');
      const attributed = result.regressions.filter(regression => regression.culprits.length > 0).length;
      result.message = `${attributed} of ${result.regressions.length} regression(s) attributed to changed lines between ${bundle.run.baselineCommit?.slice(0, 7) ?? 'the baseline'} and ${bundle.run.commit?.slice(0, 7) ?? 'the run commit'}.${result.agent?.stopReason ? ` The agent stopped early: ${result.agent.stopReason}.` : ''}${agentError ? ` ${agentError}` : ''}`;
    } else {
      result.status = 'no-agent';
      result.message = agentFailure ?? 'No agent ran: set ANTHROPIC_API_KEY to attribute the regressions. The evidence inside the changed hunks is listed unverified.';
    }
  } catch (error) {
    result.status = 'error';
    result.message = `The attribution failed: ${describeError(error)}`;
    stderr(`[performance-attribution] ${result.message}`);
  }

  return result;
}

/**
 * Run the CLI
 *
 * @param argv arguments after the binary
 * @param io environment, output and seams
 * @returns exit code
 */
export async function runCli(argv: string[], io: CliIo = {}): Promise<number> {
  const stdout = io.stdout ?? (text => process.stdout.write(`${text}\n`));
  const stderr = io.stderr ?? (text => process.stderr.write(`${text}\n`));
  const env = io.env ?? process.env;
  let options: AttributeOptions;
  try {
    const {values, positionals} = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        bundle: {type: 'string'},
        out: {type: 'string'},
        json: {type: 'string'},
        'max-regressions': {type: 'string'},
        'max-changed-files': {type: 'string'},
        'max-prompt-bytes': {type: 'string'},
      },
    });
    const count = (value: string | undefined, fallback: number) => {
      if (value === undefined) {
        return fallback;
      }

      if (!/^\d+$/.test(value)) {
        throw new TypeError(`Not a count: ${value}`);
      }

      return Number(value);
    };

    if (positionals[0] !== 'attribute' || positionals.length !== 2) {
      throw new TypeError('Expected: attribute <report-dir>');
    }

    options = {
      reportDir: positionals[1],
      bundle: values.bundle,
      out: values.out,
      json: values.json,
      caps: {
        maxRegressions: count(values['max-regressions'], defaultCaps.maxRegressions),
        maxChangedFiles: count(values['max-changed-files'], defaultCaps.maxChangedFiles),
        maxPromptBytes: count(values['max-prompt-bytes'], defaultCaps.maxPromptBytes),
      },
    };
  } catch (error) {
    stderr(`${describeError(error)}\n\n${usage}`);
    return 1;
  }

  let result: AttributionResult;
  try {
    result = await attribute(options, {...io, env, stderr});
  } catch (error) {
    if (error instanceof BundleError) {
      stderr(`[performance-attribution] ${error.message}`);
      return bundleExitCode;
    }

    stderr(`[performance-attribution] The attribution failed: ${describeError(error)}`);
    return 0;
  }

  try {
    const markdown = renderMarkdown(result);
    const bundlePath = path.resolve(options.bundle ?? path.join(options.reportDir, bundleFileName));
    const out = path.resolve(options.out ?? path.join(path.dirname(bundlePath), 'attribution.md'));
    if (options.json) {
      await fs.promises.mkdir(path.dirname(path.resolve(options.json)), {recursive: true});
      await fs.promises.writeFile(options.json, JSON.stringify(result, null, 2));
    }

    await fs.promises.mkdir(path.dirname(out), {recursive: true});
    await fs.promises.writeFile(out, markdown);
    if (env.GITHUB_STEP_SUMMARY) {
      await fs.promises.appendFile(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    }

    stdout(`performance-attribution: ${result.status}: ${result.message}`);
    for (const regression of result.regressions) {
      const [culprit] = regression.culprits;
      stdout(`  ${regression.name}: ${regression.verdict}${culprit ? ` ${culprit.file}:${culprit.line} (${culprit.confidence})` : ''}`);
    }

    stdout(`Wrote ${out}`);
  } catch (error) {
    stderr(`[performance-attribution] Writing the attribution failed: ${describeError(error)}`);
  }

  return 0;
}
