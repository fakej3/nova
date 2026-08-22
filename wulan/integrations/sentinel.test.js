import { createSentinelInspector } from './sentinel.js';

describe('createSentinelInspector', () => {
  it('reads Sentinel repository and deployment state without mutating anything', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          if (url.includes('/repos/fakej3/Sentinel/git/ref/heads/main')) return { object: { sha: 'abc123' } };
          if (url.includes('/repos/fakej3/Sentinel')) return { full_name: 'fakej3/Sentinel', default_branch: 'main', updated_at: '2026-08-22T00:00:00Z', open_issues_count: 2, visibility: 'public' };
          return { deployments: [{ uid: 'dpl_test', readyState: 'READY', target: 'production', url: 'sentinel.example', createdAt: 1, meta: { githubCommitSha: 'abc123', githubCommitMessage: 'test' } }] };
        }
      };
    };
    const inspect = createSentinelInspector({ env: { VERCEL_TOKEN: 'test', SENTINEL_VERCEL_PROJECT_ID: 'sentinel-web' }, fetchImpl });
    const result = await inspect({ branch: 'main' });
    expect(result.project).toBe('Sentinel');
    expect(result.repository.fullName).toBe('fakej3/Sentinel');
    expect(result.branch.sha).toBe('abc123');
    expect(result.vercel.deployments[0].state).toBe('READY');
    expect(calls.some(url => url.includes('/repos/fakej3/Sentinel'))).toBe(true);
  });
});
