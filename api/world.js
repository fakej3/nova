import { WulanWorld, seedWulanWorld } from '../wulan/core/world.js';
import { getRepoSnapshot } from '../wulan/tools/github.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const world = seedWulanWorld(new WulanWorld());
  let github = null;
  let githubError = null;
  try {
    github = await getRepoSnapshot('fakej3/nova');
    world.observe('github', github);
    world.upsertEntity({ id: 'github', name: 'GitHub', kind: 'integration', status: 'online', metadata: { repo: 'fakej3/nova', branch: github.defaultBranch } });
  } catch (error) {
    githubError = error instanceof Error ? error.message : String(error);
    world.upsertEntity({ id: 'github', name: 'GitHub', kind: 'integration', status: 'degraded', metadata: { error: githubError } });
  }

  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  return res.status(200).json({ ...world.snapshot(), github, githubError });
}
