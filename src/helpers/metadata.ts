import {
  execFileSync,
} from 'node:child_process';
import os from 'node:os';
import process from 'node:process';
import {
  type RunMetadata,
} from '../types/index.js';

/**
 * Commit, branch and run of the CI provider, if the run is in CI
 *
 * @param environment environment variables
 */
function detectCi(environment: NodeJS.ProcessEnv): RunMetadata {
  if (environment.GITHUB_ACTIONS === 'true') {
    return {
      ci: 'github-actions',
      commit: environment.GITHUB_SHA ?? '',
      // The head ref is only set for pull requests
      branch: [environment.GITHUB_HEAD_REF, environment.GITHUB_REF_NAME].find(Boolean) ?? '',
      ciRunId: environment.GITHUB_RUN_ID ?? '',
      ciRunUrl: environment.GITHUB_RUN_ID ? `${environment.GITHUB_SERVER_URL ?? 'https://github.com'}/${environment.GITHUB_REPOSITORY ?? ''}/actions/runs/${environment.GITHUB_RUN_ID}` : '',
    };
  }

  if (environment.GITLAB_CI === 'true') {
    return {
      ci: 'gitlab',
      commit: environment.CI_COMMIT_SHA ?? '',
      branch: environment.CI_COMMIT_REF_NAME ?? '',
      ciRunId: environment.CI_PIPELINE_ID ?? '',
      ciRunUrl: environment.CI_PIPELINE_URL ?? '',
    };
  }

  return environment.CI ? {ci: 'unknown'} : {};
}

/**
 * Output of a git command, empty if git or the repository is not available
 *
 * @param arguments_ arguments of git
 */
function git(arguments_: string[]): string {
  try {
    return execFileSync('git', arguments_, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000}).trim();
  } catch {
    return '';
  }
}

/**
 * Collect metadata of the run: CI provider, commit, branch and machine, overwritten by the custom metadata
 *
 * @param custom metadata of the options
 * @param environment environment variables
 */
export function collectRunMetadata(custom?: RunMetadata | (() => RunMetadata), environment: NodeJS.ProcessEnv = process.env): RunMetadata {
  const metadata: RunMetadata = {
    ...detectCi(environment),
    platform: `${os.platform()} ${os.arch()}`,
    cpu: `${os.cpus()[0]?.model ?? 'unknown'} x ${os.cpus().length}`,
    memory: `${Math.round(os.totalmem() / (1024 ** 3))} GiB`,
    node: process.version,
  };

  metadata.commit ||= git(['rev-parse', 'HEAD']);
  metadata.branch ||= git(['rev-parse', '--abbrev-ref', 'HEAD']);

  const resolved = typeof custom === 'function' ? custom() : custom;
  return Object.fromEntries(Object.entries({...metadata, ...resolved}).filter(([, value]) => value !== ''));
}
