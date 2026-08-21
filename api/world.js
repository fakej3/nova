import { WulanWorld, seedWulanWorld } from '../wulan/core/world.js';
import { getRepoSnapshot } from '../wulan/tools/github.js';
import { getSentinelHealth } from '../wulan/tools/sentinel.js';

const PROVIDERS = [
  ['provider:gemini', 'Google Gemini', 'gemini'],
  ['provider:openai', 'OpenAI / ChatGPT', 'openai'],
  ['provider:anthropic', 'Anthropic / Claude', 'anthropic'],
];

function configured(provider) {
  return provider === 'gemini'
    ? !!process.env.GEMINI_API_KEY
    : provider === 'openai'
      ? !!process.env.OPENAI_API_KEY
      : provider === 'anthropic'
        ? !!process.env.ANTHROPIC_API_KEY
        : false;
}

function providerStatus(provider) {
  return configured(provider) ? 'ready' : 'unconfigured';
}

async function buildWorld() {
  const world = seedWulanWorld(new WulanWorld());

  for (const [id, name, providerId] of PROVIDERS) {
    world.upsertEntity({
      id,
      name,
      kind: 'ai-provider',
      status: providerStatus(providerId),
      metadata: { providerId, configured: configured(providerId) },
    });
    world.relate('wulan', id, 'can_route_to');
  }

  world.relate('leon', 'provider:anthropic', 'prefers');
  world.relate('oracle', 'provider:openai', 'prefers');
  world.relate('atlas', 'provider:gemini', 'prefers');
  world.relate('pixel', 'provider:gemini', 'prefers');

  const activity = [];
  let github = null;
  let githubError = null;
  let sentinel = null;
  let sentinelError = null;

  const started = Date.now();
  try {
    github = await getRepoSnapshot('fakej3/nova');
    world.observe('github', github);
    world.upsertEntity({
      id: 'github', name: 'GitHub', kind: 'integration', status: 'online',
      metadata: { repo: 'fakej3/nova', branch: github.defaultBranch },
    });
    activity.push({ type: 'integration.read', source: 'github', target: 'github', status: 'completed', latencyMs: Date.now() - started });
  } catch (error) {
    githubError = error instanceof Error ? error.message : String(error);
    world.upsertEntity({ id: 'github', name: 'GitHub', kind: 'integration', status: 'degraded', metadata: { error: githubError } });
    activity.push({ type: 'integration.read', source: 'github', target: 'github', status: 'failed', error: githubError });
  }

  const sentinelStarted = Date.now();
  try {
    sentinel = await getSentinelHealth();
    world.observe('sentinel', sentinel);
    world.upsertEntity({
      id: 'sentinel', name: 'Sentinel', kind: 'project',
      status: sentinel.reachable ? 'online' : 'degraded',
      metadata: { deployment: sentinel.deployment, latencyMs: sentinel.latencyMs },
    });
    activity.push({ type: 'project.health_check', source: 'oracle', target: 'sentinel', status: sentinel.reachable ? 'completed' : 'degraded', latencyMs: Date.now() - sentinelStarted });
  } catch (error) {
    sentinelError = error instanceof Error ? error.message : String(error);
    world.upsertEntity({ id: 'sentinel', name: 'Sentinel', kind: 'project', status: 'degraded', metadata: { error: sentinelError } });
    activity.push({ type: 'project.health_check', source: 'oracle', target: 'sentinel', status: 'failed', error: sentinelError });
  }

  world.activities = activity.map((item, index) => ({
    id: `live_${Date.now()}_${index}`,
    ...item,
    at: new Date().toISOString(),
  }));

  return { world, github, githubError, sentinel, sentinelError };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const { world, github, githubError, sentinel, sentinelError } = await buildWorld();
  res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=15');
  return res.status(200).json({
    ...world.snapshot(),
    live: true,
    github,
    githubError,
    sentinel,
    sentinelError,
  });
}
