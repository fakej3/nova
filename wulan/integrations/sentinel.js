const DEFAULT_REPO = 'fakej3/Sentinel';
const DEFAULT_VERCEL_PROJECT = 'sentinel-web';

async function githubFetch(path, { token, fetchImpl = fetch } = {}) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`);
  return response.json();
}

async function vercelFetch(path, { token, fetchImpl = fetch } = {}) {
  if (!token) return null;
  const response = await fetchImpl(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Vercel request failed: ${response.status}`);
  return response.json();
}

export function createSentinelInspector({ env = globalThis.process?.env ?? {}, fetchImpl = fetch } = {}) {
  return async ({ repo = DEFAULT_REPO, branch = 'main', paths = [] } = {}) => {
    const repository = await githubFetch(`/repos/${repo}`, { token: env.GITHUB_TOKEN, fetchImpl });
    const ref = await githubFetch(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, { token: env.GITHUB_TOKEN, fetchImpl });
    const deployments = await vercelFetch(`/v6/deployments?projectId=${encodeURIComponent(env.SENTINEL_VERCEL_PROJECT_ID ?? DEFAULT_VERCEL_PROJECT)}&limit=5`, { token: env.VERCEL_TOKEN, fetchImpl });
    const files = {};
    for (const path of paths.slice(0, 8)) files[path] = await githubFetch(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, { token: env.GITHUB_TOKEN, fetchImpl });
    return {
      project: 'Sentinel',
      repository: { fullName: repository.full_name, defaultBranch: repository.default_branch, updatedAt: repository.updated_at, openIssues: repository.open_issues_count, visibility: repository.visibility },
      branch: { name: branch, sha: ref.object?.sha ?? null },
      vercel: deployments ? {
        configured: true,
        project: env.SENTINEL_VERCEL_PROJECT_ID ?? DEFAULT_VERCEL_PROJECT,
        deployments: (deployments.deployments ?? []).slice(0, 5).map(item => ({ id: item.uid ?? item.id, state: item.readyState ?? item.state, target: item.target ?? null, url: item.url ?? null, createdAt: item.createdAt ?? item.created ?? null, commitSha: item.meta?.githubCommitSha ?? null, commitMessage: item.meta?.githubCommitMessage ?? null }))
      } : { configured: false, project: env.SENTINEL_VERCEL_PROJECT_ID ?? DEFAULT_VERCEL_PROJECT },
      files
    };
  };
}

export { DEFAULT_REPO, DEFAULT_VERCEL_PROJECT };
