const DEFAULT_REPO = 'fakej3/Sentinel';
const DEFAULT_VERCEL_PROJECT = 'sentinel-web';

async function githubFetch(path, { token, fetchImpl = fetch } = {}) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`);
  return response.json();
}

export function createSentinelInspector({ env = globalThis.process?.env ?? {}, fetchImpl = fetch } = {}) {
  return async ({ repo = DEFAULT_REPO, branch = 'main', paths = [] } = {}) => {
    const [repository, ref, vercel] = await Promise.all([
      githubFetch(`/repos/${repo}`, { token: env.GITHUB_TOKEN, fetchImpl }),
      githubFetch(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, { token: env.GITHUB_TOKEN, fetchImpl }),
      inspectVercel({ project: DEFAULT_VERCEL_PROJECT, token: env.VERCEL_TOKEN, fetchImpl })
    ]);

    const files = {};
    for (const path of paths.slice(0, 8)) {
      files[path] = await githubFetch(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, {
        token: env.GITHUB_TOKEN,
        fetchImpl
      });
    }

    return {
      project: 'Sentinel',
      repository: {
        fullName: repository.full_name,
        defaultBranch: repository.default_branch,
        updatedAt: repository.updated_at,
        openIssues: repository.open_issues_count,
        visibility: repository.visibility
      },
      branch: { name: branch, sha: ref.object?.sha ?? null },
      vercel,
      files
    };
  };
}

async function inspectVercel({ project, token, fetchImpl }) {
  if (!token) return { configured: false, project };
  const response = await fetchImpl(`https://api.vercel.com/v9/projects/${encodeURIComponent(project)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Vercel request failed: ${response.status}`);
  const data = await response.json();
  return {
    configured: true,
    project: data.name,
    framework: data.framework ?? null,
    updatedAt: data.updatedAt ?? null
  };
}

export { DEFAULT_REPO, DEFAULT_VERCEL_PROJECT };
