import {
  execFile,
} from 'node:child_process';
import path from 'node:path';
import {
  promisify,
} from 'node:util';
import type {
  ChangedHunk,
  UnresolvedReason,
} from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * Milliseconds a git command may take, so a hanging git never blocks the end of the run
 */
const gitTimeoutInMilliseconds = 20_000;

/**
 * Failed git command, with its exit code if git ran at all
 */
type GitFailure = {code?: number | string; stderr?: string; message?: string};

/**
 * Text kept of the added lines per file, and per line
 */
const maxAddedLinesPerFile = 2000;
const maxAddedLineLength = 300;

/**
 * Changed lines of a file as parsed from a diff
 */
export type ParsedFile = Pick<ChangedHunk, 'file' | 'addedRanges' | 'addedLines'>;

/**
 * Short description of a failed git command
 *
 * @param error error of execFile
 */
function describeFailure(error: unknown): string {
  const failure = error as GitFailure;
  const output = (failure.stderr ?? '').trim() || (failure.message ?? String(error));
  return output.split('\n')[0].slice(0, 200);
}

/**
 * Output of a git command in the repository
 *
 * @param repoDir directory inside the repository
 * @param arguments_ arguments of git
 */
async function git(repoDir: string, arguments_: string[]): Promise<string> {
  const {stdout} = await execFileAsync('git', arguments_, {
    cwd: repoDir, encoding: 'utf8', timeout: gitTimeoutInMilliseconds, maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Parse the added lines per file of `git diff --unified=0`
 *
 * @param diff output of git diff
 */
export function parseUnifiedDiff(diff: string): ParsedFile[] {
  const files: Array<ParsedFile & {addedLines: Array<{line: number; text: string}>}> = [];
  let current: (typeof files)[number] | undefined;
  // Line of the next added line in the new file
  let nextLine = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = undefined;
      continue;
    }

    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      // Deleted files gained no lines
      current = target === '/dev/null' ? undefined : {file: target.replace(/^b\//, ''), addedRanges: [], addedLines: []};
      if (current) {
        files.push(current);
      }

      continue;
    }

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      // A count of 0 only removed lines
      if (count > 0) {
        current.addedRanges.push({start, end: start + count - 1});
      }

      nextLine = start;
      continue;
    }

    if (current && line.startsWith('+')) {
      if (current.addedLines.length < maxAddedLinesPerFile) {
        current.addedLines.push({line: nextLine, text: line.slice(1, maxAddedLineLength + 1)});
      }

      nextLine++;
    }
  }

  return files.filter(file => file.addedRanges.length > 0);
}

/**
 * Lines that changed between the baseline commit and the current commit, or why they are unknown
 *
 * @param repoDir directory inside the repository
 * @param baselineCommit commit of the baseline
 * @param headCommit current commit
 */
export async function resolveChangedLines(repoDir: string, baselineCommit: string | undefined, headCommit: string): Promise<{hunks: ChangedHunk[]; root?: string; unresolved?: UnresolvedReason; unresolvedDetail?: string}> {
  let root: string | undefined;
  try {
    const output = await git(repoDir, ['rev-parse', '--show-toplevel']);
    root = output.trim();
  } catch (error: unknown) {
    if (baselineCommit) {
      return {hunks: [], unresolved: 'git unavailable', unresolvedDetail: describeFailure(error)};
    }
  }

  if (!baselineCommit) {
    return {hunks: [], root, unresolved: 'no revision metadata'};
  }

  if (!root) {
    return {hunks: [], unresolved: 'git unavailable'};
  }

  // Each commit is checked on its own, so a missing current commit isn't reported as a problem of the baseline
  for (const [label, commit] of [['current', headCommit], ['baseline', baselineCommit]] as const) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await git(repoDir, ['cat-file', '-e', `${commit}^{commit}`]);
    } catch (error: unknown) {
      return {
        hunks: [],
        root,
        unresolved: label === 'current' ? 'git unavailable' : 'baseline commit is not an ancestor',
        unresolvedDetail: `the ${label} commit ${commit} is not in the checkout, e.g. of a shallow clone: ${describeFailure(error)}`.slice(0, 400),
      };
    }
  }

  try {
    // Exits with 1 if it's not an ancestor
    await git(repoDir, ['merge-base', '--is-ancestor', baselineCommit, headCommit]);
  } catch (error: unknown) {
    const notAncestor = (error as GitFailure).code === 1;
    return {
      hunks: [],
      root,
      unresolved: notAncestor ? 'baseline commit is not an ancestor' : 'git unavailable',
      unresolvedDetail: notAncestor ? `${baselineCommit} is not an ancestor of the current commit ${headCommit}` : describeFailure(error),
    };
  }

  try {
    const diff = await git(repoDir, ['diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-renames', `${baselineCommit}...${headCommit}`]);
    const hunks = parseUnifiedDiff(diff).map(parsed => ({...parsed, absoluteFile: path.join(root, parsed.file)}));
    return hunks.length > 0
      ? {hunks, root}
      : {
        hunks, root, unresolved: 'no changes since the baseline commit', unresolvedDetail: `no lines were added between ${baselineCommit.slice(0, 7)} and ${headCommit.slice(0, 7)}`,
      };
  } catch (error: unknown) {
    return {
      hunks: [], root, unresolved: 'git unavailable', unresolvedDetail: describeFailure(error),
    };
  }
}
