const SENTINEL_URL = 'https://sentinel-dz6kkg5ei-sentinel-lab.vercel.app';
const SENTINEL_REPO = 'fakej3/Sentinel';

export async function getSentinelHealth() {
  if (typeof window !== 'undefined') {
    const response = await fetch('/api/sentinel', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `SENTINEL_${response.status}`);
    return { repo: SENTINEL_REPO, ...data };
  }
  const started = Date.now();
  const response = await fetch(SENTINEL_URL, { redirect: 'follow' });
  return { service:'Sentinel', repo:SENTINEL_REPO, deployment:SENTINEL_URL, reachable:response.ok, statusCode:response.status, latencyMs:Date.now()-started, checkedAt:new Date().toISOString() };
}

export function registerSentinelCapabilities(world) {
  world.registerCapability({
    id:'sentinel.health', name:'Sentinel live health', description:'Check whether the live Sentinel deployment is reachable.', risk:'read', permissions:['sentinel:read'], inputSchema:{type:'object',properties:{}},
    execute: async () => getSentinelHealth(),
    verify: result => result?.reachable === true
      ? {outcome:'verified',confidence:.98,reason:'HTTP_REACHABLE',evidence:{statusCode:result.statusCode,latencyMs:result.latencyMs}}
      : {outcome:'failed',confidence:1,reason:'HTTP_UNREACHABLE',evidence:{statusCode:result?.statusCode ?? null}},
  });
}