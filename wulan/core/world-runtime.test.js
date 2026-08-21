import test from 'node:test';
import assert from 'node:assert/strict';
import { createWulanCore } from './index.js';
import { WulanWorld } from './world.js';

test('canonical core attaches the world to the event stream', () => {
  const world = new WulanWorld({storage:null});
  const core = createWulanCore({world});
  const events=[];
  core.events.on('world.entity.created', event => events.push(event));
  world.createEntity({id:'test-entity',name:'Test Entity',type:'system'});
  assert.equal(events.length,1);
  assert.equal(events[0].payload.entity.id,'test-entity');
});

test('core can replace an attached world without retaining the old bridge', () => {
  const first = new WulanWorld({storage:null});
  const second = new WulanWorld({storage:null});
  const core = createWulanCore({world:first});
  let count=0;
  core.events.on('world.entity.created', () => count++);
  core.attachWorld(second);
  first.createEntity({id:'old',name:'Old',type:'system'});
  second.createEntity({id:'new',name:'New',type:'system'});
  assert.equal(count,1);
});
