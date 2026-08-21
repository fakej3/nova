const API = 'https://api.github.com';
const DEFAULT_REPO = 'fakej3/nova';

async function github(path, options = {}) {
  const response = await fetch(`${API}${path}`, { headers: { Accept: 'application/vnd.github+json', ...options.headers }, ...options });
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function getRepoSnapshot(repo = DEFAULT_REPO) {
  const [meta, branches, commits] = await Promise.all([
    github(`/repos/${repo}`), github(`/repos/${repo}/branches?per_page=20`), github(`/repos/${repo}/commits?per_page=8`),
  ]);
  return { repo, defaultBranch: meta.default_branch, visibility: meta.visibility, openIssues: meta.open_issues_count, stars: meta.stargazers_count, forks: meta.forks_count, updatedAt: meta.updated_at, branches: branches.map(b => ({ name: b.name, sha: b.commit.sha })), recentCommits: commits.map(c => ({ sha: c.sha, message: c.commit.message.split('\n')[0], author: c.commit.author?.name, at: c.commit.author?.date })) };
}

export async function getRepoTree(repo = DEFAULT_REPO, branch = 'master') {
  const data = await github(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  return { sha: data.sha, truncated: !!data.truncated, files: (data.tree ?? []).filter(item => item.type === 'blob').map(item => ({ path: item.path, size: item.size, sha: item.sha })) };
}

const validRepo = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
const validBranch = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s\\]/.test(value);

export function registerGithubCapabilities(world) {
  world.registerCapability({
    id: 'github.repo.snapshot', name: 'GitHub repository snapshot', description: 'Read live repository metadata, branches and recent commits.',
    risk: 'read', permissions: ['github:read'], inputSchema: { type:'object', properties:{ repo:{type:'string',pattern:'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'} } },
    execute: async ({ repo = DEFAULT_REPO } = {}) => getRepoSnapshot(repo),
    verify: result => ({ outcome: result?.repo && result?.defaultBranch ? 'verified' : 'failed', confidence: result?.repo && result?.defaultBranch ? .95 : 1, reason:'GITHUB_SNAPSHOT_SHAPE' }),
  });
  world.registerCapability({
    id: 'github.repo.tree', name: 'GitHub repository tree', description: 'Read the current file graph of a repository branch.',
    risk: 'read', permissions: ['github:read'], inputSchema: { type:'object', properties:{ repo:{type:'string',pattern:'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'}, branch:{type:'string',pattern:'^[^\\s\\\\]+$'} } },
    execute: async ({ repo = DEFAULT_REPO, branch = 'master' } = {}) => getRepoTree(repo, branch),
    verify: result => ({ outcome: result?.sha && Array.isArray(result?.files) ? 'verified' : 'failed', confidence: result?.sha ? .95 : 1, reason:'GITHUB_TREE_SHAPE' }),
  });
}