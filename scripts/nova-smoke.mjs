import { createWulanCore } from '../wulan/core/index.js';

let persisted = null;
const persistence = {
  available: () => true,
  load: () => persisted,
  save: ({ memories = [] } = {}) => {
    persisted = { version: 1, savedAt: new Date().toISOString(), memories };
    return true;
  },
};

const fail = message => {
  throw new Error(`[nova-smoke] ${message}`);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

const core = createWulanCore({ persistence });
for (const [id, name, role] of [
  ['atlas', 'ATLAS', 'research'],
  ['leon', 'LEON', 'engineering'],
  ['oracle', 'ORACLE', 'analysis'],
  ['pixel', 'PIXEL', 'interface'],
]) {
  core.registerAgent({ id, name, role });
}
core.registerIntegration({ id: 'smoke', name: 'Smoke Integration', kind: 'test' });
core.boot();

const health = core.health?.check?.();
assert(health?.overall === 'healthy', `runtime health is ${health?.overall ?? 'missing'}`);
assert(core.neural.stats().neurons >= 5, 'baseline neural topology was not created');
assert(core.neural.stats().synapses >= 8, 'baseline neural topology has too few synapses');

const remembered = core.remember({
  content: 'Nova smoke test memory survives persistence.',
  type: 'fact',
  importance: 0.8,
  tags: ['smoke-test'],
});
assert(remembered?.id, 'memory creation failed');
assert(core.searchMemory('smoke test memory').length > 0, 'memory retrieval failed');
assert(persisted?.memories?.some(entry => entry.id === remembered.id), 'memory was not persisted');

const cognition = await core.cognize('what is the system status?', { execute: false });
assert(cognition?.status === 'planned' || cognition?.status === 'completed', `cognition ended in ${cognition?.status ?? 'missing'}`);
assert(cognition?.plan?.intent === 'system_status', 'deterministic cognition fallback did not identify system status');
assert(core.memory.list({ limit: 100 }).some(entry => entry.type === 'experience'), 'cognition experience was not recorded');

const restored = createWulanCore({ persistence });
assert(restored.searchMemory('smoke test memory').length > 0, 'persisted memory did not restore into a new core');

const restoredHealth = restored.health?.check?.(['memory', 'persistence']);
assert(restoredHealth?.overall !== 'failed', 'restored core has a failed memory/persistence health check');

console.log(JSON.stringify({
  ok: true,
  health: health.overall,
  restoredHealth: restoredHealth.overall,
  neurons: core.neural.stats().neurons,
  synapses: core.neural.stats().synapses,
  memories: core.memory.list({ limit: 100 }).length,
  cognition: cognition.status,
  experienceRecorded: true,
}, null, 2));
