import { WulanWorld, seedWulanWorld } from '../wulan/core/world.js';
import { getRepoSnapshot } from '../wulan/tools/github.js';
import { getSentinelHealth } from '../wulan/tools/sentinel.js';

function baseWorld() {
  return seedWulanWorld(new WulanWorld());
}

function registerCapabilities(world) {
  world.registerCapability({
    id: 'inspect.github',
    name: 'Inspect GitHub repository',
    description: 'Read repository metadata and tree without modifying anything.',
    risk: 'read',
    permissions: ['github.read'],
    target: 'github',
    execute: async (input = {}) => getRepoSnapshot(input.repository || 'fakej3/nova'),
  });

  world.registerCapability({
    id: 'inspect.sentinel',
    name: 'Inspect Sentinel health',
    description: 'Read the current Sentinel deployment health.',
    risk: 'read',
    permissions: ['network.read'],
    target: 'sentinel',
    execute: async () => getSentinelHealth(),
  });

  world.registerCapability({
    id: 'world.inspect',
    name: 'Inspect world state',
    description: 'Return a compact snapshot of entities, relationships and recent activity.',
    risk: 'read',
    permissions: [],
    target: 'wulan',
    execute: async () => world.snapshot(),
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const world = baseWorld();
    registerCapabilities(world);
    return res.status(200).json({
      capabilities: world.snapshot().capabilities,
      generatedAt: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const body = req.body || {};
  const capabilityId = typeof body.capabilityId === 'string' ? body.capabilityId : '';
  const input = body.input && typeof body.input === 'object' ? body.input : {};
  if (!capabilityId) return res.status(400).json({ error: 'CAPABILITY_ID_REQUIRED' });

  const world = baseWorld();
  registerCapabilities(world);
  const capability = world.capabilities.get(capabilityId);
  if (!capability) return res.status(404).json({ error: 'UNKNOWN_CAPABILITY', capabilityId });

  // This endpoint intentionally exposes only read capabilities. Any future
  // mutating capability must receive an explicit approval boundary instead of
  // inheriting POST access accidentally.
  if (capability.risk !== 'read') return res.status(403).json({ error: 'CAPABILITY_REQUIRES_APPROVAL', capabilityId });

  try {
    const result = await world.invoke(capabilityId, input, { source: 'world-ui' });
    return res.status(200).json({ ok: true, capabilityId, result, activity: world.activities.slice(-2) });
  } catch (error) {
    return res.status(502).json({ ok: false, capabilityId, error: error instanceof Error ? error.message : String(error), activity: world.activities.slice(-2) });
  }
}
