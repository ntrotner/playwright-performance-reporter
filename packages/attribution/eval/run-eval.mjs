// Done-when of the attribution against the seeded regressions of example/seeded-regressions/:
// top-1 culprit correct on at least 2 of 3, and never a culprit outside of the changed lines.
//
// Worktrees the base commit (`seeded-regressions~1`, efficient handlers) and the head commit (`seeded-regressions`,
// degraded handlers), runs the base suite minBaselineRuns + 1 times into one shared history, the head suite once with
// the attribution presenter, then `performance-attribution attribute` on the head report. Cleans up in any case.
//
// Usage: npm run eval [-- --scripted] [-- --keep]
//   ANTHROPIC_API_KEY   runs the real agent (required unless --scripted)
//   --scripted          replaces the model with a scripted agent that submits the strongest candidate per regression,
//                       which checks the pipeline without a model
//   SEEDED_BRANCH       branch of the seeded regressions, defaults to seeded-regressions
import {
  execFileSync,
  spawnSync,
} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  fileURLToPath,
} from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripted = process.argv.includes('--scripted');
const keep = process.argv.includes('--keep');
const branch = process.env.SEEDED_BRANCH ?? 'seeded-regressions';
const minBaselineRuns = 3;

/**
 * Seeded regressions: the test and step they live in, and the handler in app/server.mjs that degrades
 */
const seeded = [
  {test: 'leak', step: 'Build reports', handler: 'leak'},
  {test: 'heavy render', step: 'Render rows', handler: 'heavyRender'},
  {test: 'unindexed query', step: 'Look up orders', handler: 'unindexedQuery'},
];

const git = (cwd, ...arguments_) => execFileSync('git', arguments_, {cwd, encoding: 'utf8'}).trim();
const log = message => console.log(`[eval] ${message}`);

/**
 * Run a command, inheriting the output, and fail on a non-zero exit code
 *
 * @param {string} command executable
 * @param {string[]} arguments_ arguments
 * @param {object} options cwd and env
 */
function run(command, arguments_, options) {
  const result = spawnSync(command, arguments_, {stdio: ['ignore', 'inherit', 'inherit'], ...options});
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(' ')} exited with ${result.status}`);
  }
}

/**
 * Lines of the functions of a source file, by function name
 *
 * @param {string} source source code
 */
function functionRanges(source) {
  const lines = source.split('\n');
  const ranges = new Map();
  for (const [index, line] of lines.entries()) {
    const name = /^export function (\w+)\(/.exec(line)?.[1];
    if (name) {
      const end = lines.findIndex((candidate, position) => position > index && candidate === '}');
      ranges.set(name, {start: index + 1, end: end + 1});
    }
  }

  return ranges;
}

const repoRoot = git(packageDir, 'rev-parse', '--show-toplevel');
const baseCommit = git(repoRoot, 'rev-parse', `${branch}~1`);
const headCommit = git(repoRoot, 'rev-parse', branch);
if (!scripted && !process.env.ANTHROPIC_API_KEY) {
  console.error('[eval] Set ANTHROPIC_API_KEY for the real agent, or pass --scripted to check the pipeline without a model.');
  // A script run by npm, which reports through its exit code
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(2);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'attribution-eval-'));
const historyDir = path.join(temporary, 'performance-history');
const worktrees = {base: path.join(temporary, 'base'), head: path.join(temporary, 'head')};
let exitCode = 1;

try {
  // The worktrees reuse the dependencies and builds of this checkout
  for (const dir of [path.join(repoRoot, 'lib'), path.join(packageDir, 'lib'), path.join(repoRoot, 'example/node_modules')]) {
    if (!fs.existsSync(dir)) {
      throw new Error(`${dir} is missing: run npm run build in the root and in packages/attribution, and npm install in example/`);
    }
  }

  for (const [name, commit] of [['base', baseCommit], ['head', headCommit]]) {
    git(repoRoot, 'worktree', 'add', '--detach', worktrees[name], commit);
    for (const linked of ['node_modules', 'lib', 'example/node_modules', 'packages/attribution/node_modules', 'packages/attribution/lib']) {
      const target = path.join(worktrees[name], linked);
      fs.rmSync(target, {recursive: true, force: true});
      // A commit from before packages/attribution has no folder for its links
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.symlinkSync(path.join(repoRoot, linked), target);
    }
  }

  const playwright = worktree => run(path.join(worktree, 'example/node_modules/.bin/playwright'), ['test', '--config', 'seeded-regressions/playwright.config.ts'], {
    cwd: path.join(worktree, 'example'),
    env: {...process.env, PERF_HISTORY_DIR: historyDir, CI: ''},
  });
  for (let index = 1; index <= minBaselineRuns + 1; index++) {
    log(`baseline run ${index} of ${minBaselineRuns + 1} at ${baseCommit.slice(0, 7)}`);
    playwright(worktrees.base);
  }

  log(`measured run at ${headCommit.slice(0, 7)}`);
  playwright(worktrees.head);

  const reportDir = path.join(worktrees.head, 'example/seeded-regressions');
  if (scripted) {
    const {attribute} = await import(path.join(packageDir, 'lib/cli/index.js'));
    // Submits the strongest candidate of every regression, like a model that trusts attribute_to_hunks
    await attribute({
      reportDir,
      async runAttribution(bundle, tools) {
        // The tools run one after another, like an agent
        /* eslint-disable no-await-in-loop */
        for (const {entityKey} of bundle.regressions) {
          const {candidates} = await tools.attribute_to_hunks.execute({entityKey}, {});
          await tools.submit_verdict.execute({
            entityKey, culprits: candidates.slice(0, 1).map(candidate => ({
              file: candidate.file, line: candidate.startLine, basis: candidate.basis, symbol: candidate.symbol,
            })),
          }, {});
        }
        /* eslint-enable no-await-in-loop */
      },
    });
  } else {
    run(process.execPath, [path.join(packageDir, 'bin/performance-attribution.js'), 'attribute', reportDir], {});
  }

  const bundle = JSON.parse(fs.readFileSync(path.join(reportDir, 'performance-attribution.json'), 'utf8'));
  const {verdicts} = JSON.parse(fs.readFileSync(path.join(reportDir, 'attribution.json'), 'utf8'));
  const handlers = functionRanges(fs.readFileSync(path.join(worktrees.head, 'example/seeded-regressions/app/server.mjs'), 'utf8'));
  const isChanged = culprit => bundle.hunks.some(hunk => hunk.file === culprit.file && hunk.addedRanges.some(range => culprit.startLine >= range.start && culprit.endLine <= range.end));

  const outside = verdicts.flatMap(verdict => verdict.culprits).filter(culprit => !isChanged(culprit));
  const results = seeded.map(({test, step, handler}) => {
    const verdict = verdicts.find(candidate => candidate.name.endsWith(`${test} > ${step}`));
    const top = verdict?.culprits[0];
    const range = handlers.get(handler);
    const correct = Boolean(top && range && top.file.endsWith('seeded-regressions/app/server.mjs') && top.startLine >= range.start && top.endLine <= range.end);
    return {
      test, verdict: verdict?.status ?? 'not regressed', top: top ? `${top.file}:${top.startLine} ${top.symbol ?? ''}` : '–', expected: `${handler} (lines ${range?.start}-${range?.end})`, correct,
    };
  });

  console.table(results);
  const correct = results.filter(result => result.correct).length;
  log(`top-1 correct: ${correct} of ${seeded.length}, culprits outside of the changed lines: ${outside.length}`);
  log(`markdown: ${path.join(reportDir, 'attribution.md')}`);
  exitCode = correct >= 2 && outside.length === 0 ? 0 : 1;
  log(exitCode === 0 ? 'PASS' : 'FAIL');
} catch (error) {
  console.error(`[eval] ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (keep) {
    log(`kept ${temporary}; remove it with git worktree remove --force ${worktrees.base} && git worktree remove --force ${worktrees.head}`);
  } else {
    for (const worktree of Object.values(worktrees)) {
      // Unlink the shared dependencies first, so nothing removes their content
      for (const linked of ['node_modules', 'lib', 'example/node_modules', 'packages/attribution/node_modules', 'packages/attribution/lib']) {
        if (fs.lstatSync(path.join(worktree, linked), {throwIfNoEntry: false})?.isSymbolicLink()) {
          fs.unlinkSync(path.join(worktree, linked));
        }
      }

      spawnSync('git', ['worktree', 'remove', '--force', worktree], {cwd: repoRoot, stdio: 'ignore'});
    }

    spawnSync('git', ['worktree', 'prune'], {cwd: repoRoot, stdio: 'ignore'});
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

// A script run by npm, which reports through its exit code
// eslint-disable-next-line unicorn/no-process-exit
process.exit(exitCode);
