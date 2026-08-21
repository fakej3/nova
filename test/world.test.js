import test from 'node:test';
import assert from 'node:assert/strict';
import { WulanWorld, seedWulanWorld } from '../wulan/core/world.js';
import { WulanOrchestrator } from '../wulan/core/orchestrator.js';

test('seed creates a connected world', () => {
  const world = seedWulanWorld(new WulanWorld());
  assert.equal(world.entities.get('wulan')?.kind, 'system');
  assert.equal(world.entities.get('sentinel')?.kind, 'project');
  assert.ok(world.relations.size >= 10);
});

test('capabilities execute and leave an activity trail', async () => {
  const world = new WulanWorld();
  world.registerCapability({ id: 'test.echo', name: 'Echo', execute: async ({ value }) => ({ value }) });
  const result = await world.invoke('test.echo', { value: 42 });
  assert.deepEqual(result, { value: 42 });
  assert.equal(world.activities.at(-1)?.type, 'capability.completed');
});

test('orchestrator routes Sentinel intent to the Sentinel capability', async () => {
  const world = seedWulanWorld(new WulanWorld());
  world.registerCapability({ id: 'sentinel.health', name: 'Sentinel health', execute: async () => ({ reachable: true }) });
  const agents = new Map([['oracle', { id: 'oracle', status: 'idle' }]]);
  const events = [];
  const core = {
    state: { agents },
    startAgent(id) { agents.get(id).status = 'active'; events.push(['start', id]); },
    finishAgent(id) { agents.get(id).status = 'idle'; events.push(['finish', id]); },
  };
  const orchestrator = new WulanOrchestrator({ core, world });
  const result = await orchestrator.inspect('check Sentinel');
  assert.equal(result.result.result.reachable, true);
  assert.deepEqual(events, [['start', 'oracle'], ['finish', 'oracle']]);
});
