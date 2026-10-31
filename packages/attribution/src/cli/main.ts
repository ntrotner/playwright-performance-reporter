import fs from 'node:fs';
import process from 'node:process';
import {
  parseArgs,
} from 'node:util';
import {
  attribute,
} from './attribute.js';

const usage = `Usage: performance-attribution attribute <report-dir> [options]

Attributes the regressions in <report-dir>/performance-attribution.json to the changed lines
and writes attribution.md and attribution.json next to it.

Options:
  --bundle <file>              bundle file, defaults to <report-dir>/performance-attribution.json
  --output <file>              markdown file, defaults to <report-dir>/attribution.md
  --model <id>                 model, defaults to $ATTRIBUTION_MODEL or claude-opus-5
  --max-steps <n>              maximum model calls, defaults to 30
  --max-regressions <n>        defaults to the bundle, 25
  --max-changed-files <n>      defaults to the bundle, 200
  --max-prompt-bytes <n>       defaults to the bundle, 200000
  --time-budget <seconds>      wall-clock limit of the agent incl. retries, defaults to 300
  --source-root <url>=<path>   the app serves <path> (relative to the repository root) at <url>, repeatable
  --no-agent                   skip the agent, every regression is marked no-agent
  --help                       show this help

Environment: ANTHROPIC_API_KEY enables the agent, GITHUB_STEP_SUMMARY receives the markdown.`;

/**
 * Parse a positive integer flag
 *
 * @param name name of the flag
 * @param value value of the flag
 */
function positiveInteger(name: string, value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new TypeError(`--${name} must be a positive integer, got ${value}`);
  }

  return number;
}

/**
 * Parse `<url>=<path>` of `--source-root`
 *
 * @param value value of the flag
 */
function parseSourceRoot(value: string): {url: string; path: string} {
  const separator = value.lastIndexOf('=');
  const url = value.slice(0, separator);
  if (separator <= 0 || !/^[a-z][\w+.-]*:\/\//i.test(url)) {
    throw new TypeError(`--source-root must be <url>=<path>, got ${value}`);
  }

  return {url, path: value.slice(separator + 1).replace(/^\.\//, '')};
}

/**
 * Run the CLI
 *
 * @param argv arguments after the executable
 * @param env environment
 * @returns exit code: 0 for every analysis outcome, 2 for usage errors
 */
export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let options: Parameters<typeof attribute>[0];
  try {
    const {values, positionals} = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        bundle: {type: 'string'},
        output: {type: 'string'},
        model: {type: 'string'},
        'max-steps': {type: 'string'},
        'max-regressions': {type: 'string'},
        'max-changed-files': {type: 'string'},
        'max-prompt-bytes': {type: 'string'},
        'time-budget': {type: 'string'},
        'source-root': {type: 'string', multiple: true},
        agent: {type: 'boolean', default: true},
        help: {type: 'boolean', default: false},
      },
    });
    if (values.help) {
      console.log(usage);
      return 0;
    }

    const [command, reportDir, ...rest] = positionals;
    if (command !== 'attribute' || !reportDir || rest.length > 0) {
      throw new TypeError('Expected: attribute <report-dir>');
    }

    if (!fs.statSync(reportDir, {throwIfNoEntry: false})?.isDirectory()) {
      throw new TypeError(`${reportDir} is not a directory`);
    }

    options = {
      reportDir,
      bundle: values.bundle,
      output: values.output,
      model: values.model,
      maxSteps: positiveInteger('max-steps', values['max-steps']),
      maxRegressions: positiveInteger('max-regressions', values['max-regressions']),
      maxChangedFiles: positiveInteger('max-changed-files', values['max-changed-files']),
      maxPromptBytes: positiveInteger('max-prompt-bytes', values['max-prompt-bytes']),
      timeBudgetSeconds: positiveInteger('time-budget', values['time-budget']),
      sourceRoots: (values['source-root'] ?? []).map(value => parseSourceRoot(value)),
      agent: values.agent,
      env,
    };
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
    return 2;
  }

  const result = await attribute(options);
  if (result.writeErrors.length > 0) {
    // Keep the result in the log of the CI job
    console.log(result.markdown);
  }

  const count = (status: string) => result.verdicts.filter(verdict => verdict.status === status).length;
  const target = result.writeErrors.length > 0 ? 'Attribution (not all files written)' : `Attribution written to ${result.markdownFile}`;
  console.log(`${target}: ${result.verdicts.length} regression(s), ${count('attributed')} attributed, ${count('no-culprit')} no-culprit, ${count('no-agent')} no-agent`);
  return 0;
}
