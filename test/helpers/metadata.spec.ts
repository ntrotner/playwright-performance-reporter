import {
  collectRunMetadata,
} from '../../src/helpers/index.js';

describe('Run metadata', () => {
  it('should detect commit, branch and run of GitHub Actions', () => {
    const metadata = collectRunMetadata(undefined, {
      GITHUB_ACTIONS: 'true', GITHUB_SHA: 'abc123', GITHUB_HEAD_REF: 'feature', GITHUB_REF_NAME: '12/merge', GITHUB_RUN_ID: '42', GITHUB_REPOSITORY: 'owner/repo',
    });

    expect(metadata).toEqual(expect.objectContaining({
      ci: 'github-actions', commit: 'abc123', branch: 'feature', ciRunId: '42', ciRunUrl: 'https://github.com/owner/repo/actions/runs/42',
    }));
    expect(collectRunMetadata(undefined, {GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'main'}).branch).toBe('main');
  });

  it('should detect GitLab CI', () => {
    expect(collectRunMetadata(undefined, {
      GITLAB_CI: 'true', CI_COMMIT_SHA: 'def456', CI_COMMIT_REF_NAME: 'main', CI_PIPELINE_ID: '7', CI_PIPELINE_URL: 'https://gitlab.com/p/7',
    })).toEqual(expect.objectContaining({
      ci: 'gitlab', commit: 'def456', branch: 'main', ciRunId: '7', ciRunUrl: 'https://gitlab.com/p/7',
    }));
  });

  it('should describe the machine and fall back to git outside of CI', () => {
    const metadata = collectRunMetadata(undefined, {});

    expect(metadata).toEqual(expect.objectContaining({
      platform: expect.any(String) as string, cpu: expect.stringContaining(' x ') as string, memory: expect.stringMatching(/GiB$/) as string, node: process.version,
    }));
    // The tests run inside the git repository
    expect(metadata.commit).toMatch(/^[\da-f]{40}$/);
    expect(metadata).not.toHaveProperty('ci');
  });

  it('should merge the custom metadata over the detected one and drop empty values', () => {
    expect(collectRunMetadata({commit: 'custom', release: '1.2.3'}, {GITHUB_ACTIONS: 'true', GITHUB_SHA: 'abc123'})).toEqual(expect.objectContaining({commit: 'custom', release: '1.2.3'}));
    expect(collectRunMetadata(() => ({release: '2.0.0'}), {}).release).toBe('2.0.0');
    expect(collectRunMetadata(undefined, {GITHUB_ACTIONS: 'true', GITHUB_SHA: 'abc123'})).not.toHaveProperty('ciRunUrl');
  });
});
