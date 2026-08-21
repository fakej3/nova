import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultWulanCore } from '../wulan/core/manifest.js';
import { WulanWorld, seedWulanWorld } from '../wulan/core/world.js';
import { verifyCapabilityResult, VERIFICATION_OUTCOMES } from '../wulan/core/verification.js';

function coreForTest() {
  // createDefaultWulanCore is the canonical wiring test. It registers real
  // adapters, but this smoke test uses a separate in-memory world for execution.
  const core = createDefaultWulanCore();
  return core;
}

test('canonical foundation wires world, agents, neural, consolidation, knowledge and providers', () => {
  const core = coreForTest();
  assert.ok(core.world);
  assert.ok(core.neural);
  assert.ok(core.consolidation);
  assert.ok(core.knowledge);
  assert.equal(core.state.agents.size, 4);
  assert.ok(core.ai.listProviders().length >= 3);
  assert.ok(core.world.capabilities.has('github.repo.snapshot'));
  assert.ok(core.world.capabilities.has('sentinel.health'));
});

test('execution is not treated as learning success without verification', async () => {
  const world = seedWulanWorld(new WulanWorld());
  world.registerCapability({
    id: 'test.read', name: 'Test read', risk: 'read',
    execute: async () => ({ ok: true }),
  });
  const result = await world.invoke('test.read');
  const verdict = verifyCapabilityResult({ capability: world.capabilities.get('test.read'), result });
  assert.equal(verdict.outcome, VERIFICATION_OUTCOMES.INCONCLUSIVE);
});

test('capability verifier can produce a verified outcome with evidence', async () => {
  const world = seedWulanWorld(new WulanWorld());
  world.registerCapability({
    id: 'test.verified', name: 'Test verified', risk: 'read',
    execute: async () => ({ status: 'healthy' }),
    verify: value => ({ outcome: value?.status === 'healthy' ? 'verified' : 'failed', confidence: .99, evidence: { status: value?.status } }),
  });
  const result = await world.invoke('test.verified');
  const verdict = verifyCapabilityResult({ capability: world.capabilities.get('test.verified'), result });
  assert.equal(verdict.outcome, VERIFICATION_OUTCOMES.VERIFIED);
  assert.equal(verdict.evidence.status, 'healthy');
});
