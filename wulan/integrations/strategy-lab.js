const DEFAULT_REPO = 'fakej3/strategy-lab';
const DEFAULT_BRANCH = 'claude/trading-lab-architecture-e4212v';

async function githubFetch(path, { token, fetchImpl = fetch } = {}) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`);
  return response.json();
}

export function createStrategyLabInspector({ env = globalThis.process?.env ?? {}, fetchImpl = fetch } = {}) {
  return async ({ repo = DEFAULT_REPO, branch = DEFAULT_BRANCH, paths = [] } = {}) => {
    const [repository, ref] = await Promise.all([
      githubFetch(`/repos/${repo}`, { token: env.GITHUB_TOKEN, fetchImpl }),
      githubFetch(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, { token: env.GITHUB_TOKEN, fetchImpl })
    ]);

    const files = {};
    for (const path of paths.slice(0, 8)) {
      files[path] = await githubFetch(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, {
        token: env.GITHUB_TOKEN,
        fetchImpl
      });
    }

    return {
      project: 'Strategy Lab',
      repository: {
        fullName: repository.full_name,
        defaultBranch: repository.default_branch,
        visibility: repository.visibility,
        updatedAt: repository.updated_at,
        openIssues: repository.open_issues_count
      },
      branch: { name: branch, sha: ref.object?.sha ?? null },
      architecture: {
        facade: 'lab/',
        layers: ['automation', 'jobs', 'research', 'data', 'portfolio', 'engine', 'pipeline', 'research_db'],
        api: 'FastAPI + WebSocket'
      },
      files
    };
  };
}

export { DEFAULT_REPO, DEFAULT_BRANCH };
