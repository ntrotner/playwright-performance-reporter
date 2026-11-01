import {
  execFile,
} from 'node:child_process';
import type {
  ChangedFile,
  RevisionReason,
} from '../types.js';

/**
 * Milliseconds a git command may take, so a slow or hanging git never holds up the end of the run
 */
const gitTimeoutInMilliseconds = 2000;

/**
 * Result of a git command: its output, or the exit code if it failed (undefined if git didn't run or timed out)
 */
type GitResult = {ok: true; stdout: string} | {ok: false; code?: number; message: string};

/**
 * Run git in a directory. Never throws.
 *
 * @param repoDir directory inside the repository
 * @param arguments_ arguments of git
 */
async function git(repoDir: string, arguments_: string[]): Promise<GitResult> {
  return new Promise(resolve => {
    execFile('git', arguments_, {
      cwd: repoDir, encoding: 'utf8', timeout: gitTimeoutInMilliseconds, maxBuffer: 64 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const code = typeof error.code === 'number' && !error.killed ? error.code : undefined;
        resolve({ok: false, code, message: (stderr.trim() || error.message).split('\n')[0].slice(0, 200)});
      } else {
        resolve({ok: true, stdout});
      }
    });
  });
}

/**
 * Added lines per file of `git diff --unified=0`, 1-based and inclusive. Deleted files and hunks that only removed
 * lines gained nothing.
 *
 * @param diff output of git diff
 */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = undefined;
    } else if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      current = target === '/dev/null' ? undefined : {file: target.replace(/^b\//, ''), addedRanges: []};
      if (current) {
        files.push(current);
      }
    } else if (current) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      const count = hunk?.[2] === undefined ? 1 : Number(hunk[2]);
      if (hunk && count > 0) {
        const start = Number(hunk[1]);
        current.addedRanges.push({start, end: start + count - 1});
      }
    }
  }

  return files.filter(file => file.addedRanges.length > 0);
}

/**
 * Changed hunks between the baseline commit and the commit of the run, or why they are unknown
 */
export type ChangedFilesResult = {changedFiles: ChangedFile[]} | {reason: RevisionReason; message: string};

/**
 * Resolve the lines added between the baseline commit and the commit of the run: both commits must be in the
 * checkout, the baseline must be an ancestor, then one `git diff`. Each step only runs if the previous one succeeded.
 *
 * @param repoDir directory inside the repository
 * @param baselineCommit commit of the baseline
 * @param commit commit of the run
 */
export async function resolveChangedFiles(repoDir: string, baselineCommit: string, commit: string): Promise<ChangedFilesResult> {
  for (const [label, revision] of [['run', commit], ['baseline', baselineCommit]] as const) {
    // eslint-disable-next-line no-await-in-loop
    const result = await git(repoDir, ['cat-file', '-e', `${revision}^{commit}`]);
    if (!result.ok) {
      return {reason: 'git-unavailable', message: `The ${label} commit ${revision} is not available in ${repoDir}, e.g. git is missing or the clone is shallow: ${result.message}`};
    }
  }

  const ancestor = await git(repoDir, ['merge-base', '--is-ancestor', baselineCommit, commit]);
  if (!ancestor.ok) {
    // Exit code 1 means it isn't an ancestor, anything else is a failure of git
    return ancestor.code === 1
      ? {reason: 'baseline-not-an-ancestor', message: `The baseline commit ${baselineCommit} is not an ancestor of the run commit ${commit}.`}
      : {reason: 'git-unavailable', message: `git merge-base failed: ${ancestor.message}`};
  }

  // Paths with non-ASCII characters stay unquoted
  const diff = await git(repoDir, ['-c', 'core.quotePath=false', 'diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-renames', `${baselineCommit}...${commit}`]);
  if (!diff.ok) {
    return {reason: 'git-unavailable', message: `git diff failed: ${diff.message}`};
  }

  return {changedFiles: parseUnifiedDiff(diff.stdout)};
}
