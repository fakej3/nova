import test from 'node:test';
import assert from 'node:assert/strict';
import { WulanEventBus } from './event-bus.js';
import { WulanWorld } from './world.js';

test('world events can feed the canonical event stream', () => {
  const bus = new WulanEventBus();
  const world = new WulanWorld();
  const seen = [];
  bus.on('world.entity.updated', event => seen.push(event));
  const detach = world.attachEventBus(bus);
  world.upsertEntity({id:'wulan',name:'Wulan',kind:'system'});
  assert.equal(seen.length,1);
  assert.equal(seen[0].payload.id,'wulan');
  assert.equal(seen[0].source,'wulan-world');
  detach();
  world.upsertEntity({id:'memory',name:'Memory',kind:'system'});
  assert.equal(seen.length,1);
});

test('world persistence is adapter-driven', async () => {
  const values = new Map();
  const persistence = { save: async (key,value) => values.set(key,value), load: async key => values.get(key) ?? null };
  const world = new WulanWorld({}, {persistence});
  world.upsertEntity({id:'wulan',name:'Wulan',kind:'system'});
  assert.equal(await world.save(),true);
  const restored = new WulanWorld({}, {persistence});
  assert.equal(await restored.loadPersisted(),true);
  assert.equal(restored.entities.get('wulan').name,'Wulan');
});
