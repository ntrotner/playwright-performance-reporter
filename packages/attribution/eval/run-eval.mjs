#!/usr/bin/env node
// Seeded eval of the attribution: runs example/seeded-regressions at the base and the head of the local
// `seeded-regressions` branch into one shared history, attributes the regressions of the head with the real agent,
// and checks that the top culprit of each seeded regression lies in the degraded handler, and that no culprit lies
// outside the changed hunks. Needs ANTHROPIC_API_KEY; `--scripted` replaces the model with a deterministic agent that
// submits the strongest candidate, to check the pipeline without a model. `--keep` keeps the worktrees.
//
// Usage: npm run eval [-- --scripted] [-- --keep]
import {
  execFileSync,
} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  fileURLToPath,
} from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(packageDir, '../..');
const branch = 'seeded-regressions';
const scripted = process.argv.includes('--scripted');
const keep = process.argv.includes('--keep');
// Base runs: minBaselineRuns (3) + 1. Head runs: 2, so the median of the recentRuns (3) is the head.
const baseRuns = 4;
const headRuns = 2;
const serverFile = 'example/seeded-regressions/app/server.mjs';
const seeded = [
  {test: 'leak', step: 'Build reports', handler: 'leak'},
  {test: 'heavy render', step: 'Render rows', handler: 'heavyRender'},
  {test: 'unindexed query', step: 'Look up orders', handler: 'unindexedQuery'},
];

/**
 * Stop the eval with a message
 *
 * @param {string} message why
 */
function abort(message) {
  console.error(`[eval] ${message}`);
  process.exit(1);
}

/**
 * Run a command, inheriting the output
 *
 * @param {string} command command
 * @param {string[]} arguments_ arguments
 * @param {object} options options of execFileSync
 */
function run(command, arguments_, options = {}) {
  console.log(`[eval] ${path.relative(repoDir, options.cwd ?? repoDir) || '.'}$ ${command} ${arguments_.join(' ')}`);
  return execFileSync(command, arguments_, {stdio: ['ignore', 'inherit', 'inherit'], ...options});
}

const git = (...arguments_) => execFileSync('git', arguments_, {cwd: repoDir, encoding: 'utf8'}).trim();

try {
  git('rev-parse', '--verify', '--quiet', `${branch}^{commit}`);
} catch {
  abort(`The local branch ${branch} is missing. It holds the degraded handlers and is never merged; fetch or recreate it (see the README).`);
}

if (!scripted && !process.env.ANTHROPIC_API_KEY) {
  abort('ANTHROPIC_API_KEY is not set. The eval needs a real model; `npm run eval -- --scripted` checks the pipeline without one.');
}

for (const dir of [path.join(repoDir, 'node_modules'), path.join(repoDir, 'example/node_modules'), path.join(packageDir, 'node_modules')]) {
  if (!fs.existsSync(dir)) {
    abort(`${dir} is missing: run npm ci in the root, in example/ and in packages/attribution first.`);
  }
}

const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'attribution-eval-')));
const historyDir = path.join(workDir, 'history');
const worktrees = {base: path.join(workDir, 'base'), head: path.join(workDir, 'head')};

/**
 * Worktree of a commit with the dependencies of the repository linked in and the reporter and the presenter built
 *
 * @param {string} dir worktree directory
 * @param {string} commit commit
 */
function prepareWorktree(dir, commit) {
  git('worktree', 'add', '--detach', dir, commit);
  fs.symlinkSync(path.join(repoDir, 'node_modules'), path.join(dir, 'node_modules'));
  fs.symlinkSync(path.join(repoDir, 'example/node_modules'), path.join(dir, 'example/node_modules'));
  fs.symlinkSync(path.join(packageDir, 'node_modules'), path.join(dir, 'packages/attribution/node_modules'));
  run('npm', ['run', 'build'], {cwd: dir});
  run('npm', ['run', 'build'], {cwd: path.join(dir, 'packages/attribution')});
}

/**
 * Run the seeded suite in a worktree into the shared history
 *
 * @param {string} dir worktree directory
 */
function runSuite(dir) {
  run('npx', ['playwright', 'test', '--config', 'seeded-regressions/playwright.config.ts'], {
    cwd: path.join(dir, 'example'), env: {...process.env, PERF_HISTORY_DIR: historyDir, CI: ''},
  });
}

/**
 * Lines of a handler in the head version of the app: from its declaration to its closing brace
 *
 * @param {string[]} lines lines of the file
 * @param {string} handler function name
 */
function handlerRange(lines, handler) {
  const start = lines.findIndex(line => line.startsWith(`export function ${handler}(`));
  const end = lines.findIndex((line, index) => index > start && line === '}');
  return {start: start + 1, end: end + 1};
}

let exitCode = 1;
try {
  prepareWorktree(worktrees.base, `${branch}~1`);
  prepareWorktree(worktrees.head, branch);
  for (let index = 0; index < baseRuns; index++) {
    runSuite(worktrees.base);
  }

  for (let index = 0; index < headRuns; index++) {
    runSuite(worktrees.head);
  }

  const reportDir = path.join(worktrees.head, 'example/seeded-regressions/report');
  const resultFile = path.join(workDir, 'attribution-result.json');
  const {runCli} = await import(path.join(worktrees.head, 'packages/attribution/lib/cli.js'));
  /** Deterministic stand-in for the model: submits the strongest candidate of every regression */
  const scriptedAgent = async ({bundle, tools}) => {
    await tools.read_bundle.execute({}, {});
    for (const regression of bundle.regressions) {
      // eslint-disable-next-line no-await-in-loop
      const {candidates = []} = await tools.attribute_to_hunks.execute({entityKey: regression.entityKey}, {});
      // eslint-disable-next-line no-await-in-loop
      await tools.submit_verdict.execute({entityKey: regression.entityKey, culprits: candidates.slice(0, 1).map(({file, line, basis}) => ({file, line, basis}))}, {});
    }

    return {steps: 0};
  };

  const started = Date.now();
  await runCli(['attribute', reportDir, '--json', resultFile], scripted ? {runAttribution: scriptedAgent} : {});
  const seconds = Math.round((Date.now() - started) / 1000);
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const bundle = JSON.parse(fs.readFileSync(path.join(reportDir, 'attribution-bundle.json'), 'utf8'));
  // The worktrees are removed at the end, the results stay
  fs.copyFileSync(path.join(reportDir, 'attribution.md'), path.join(workDir, 'attribution.md'));
  fs.copyFileSync(path.join(reportDir, 'attribution-bundle.json'), path.join(workDir, 'attribution-bundle.json'));
  const headLines = fs.readFileSync(path.join(worktrees.head, serverFile), 'utf8').split('\n');
  const inHunk = culprit => bundle.changedFiles.some(file => file.file === culprit.file && file.addedRanges.some(range => range.start <= culprit.line && culprit.line <= range.end));
  const outside = result.regressions.flatMap(regression => regression.culprits).filter(culprit => !inHunk(culprit));
  const scores = seeded.map(({test, step, handler}) => {
    // Names of steps are prefixed with their project, file and test
    const regression = result.regressions.find(entry => entry.name === step || entry.name.endsWith(` > ${test} > ${step}`));
    const range = handlerRange(headLines, handler);
    const top = regression?.culprits[0];
    const correct = top !== undefined && top.file === serverFile && top.line >= range.start && top.line <= range.end;
    return {
      test, step, regressed: regression !== undefined, expected: `${serverFile}:${range.start}-${range.end}`, top: top ? `${top.file}:${top.line} (${top.basis}, ${top.confidence})` : undefined, correct,
    };
  });
  const correct = scores.filter(score => score.correct).length;
  const passed = correct >= 2 && outside.length === 0;
  const summary = {
    mode: scripted ? 'scripted' : `agent ${result.model}`,
    bundleStatus: bundle.status,
    attributionStatus: result.status,
    attributionSeconds: seconds,
    top1Correct: `${correct} of ${seeded.length}`,
    culpritsOutsideHunks: outside.length,
    passed,
    scores,
  };
  fs.writeFileSync(path.join(workDir, 'eval-result.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[eval] ${passed ? 'PASSED' : 'FAILED'}: top-1 correct on ${correct} of ${seeded.length}, ${outside.length} culprit(s) outside the changed hunks. Results in ${workDir}`);
  exitCode = passed ? 0 : 1;
} finally {
  if (!keep) {
    for (const dir of Object.values(worktrees)) {
      try {
        git('worktree', 'remove', '--force', dir);
      } catch {}
    }
  }
}

process.exit(exitCode);
