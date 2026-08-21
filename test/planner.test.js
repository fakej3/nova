import test from 'node:test';
import assert from 'node:assert/strict';
import { WulanWorld, seedWulanWorld } from '../wulan/core/world.js';
import { buildPlanPrompt, parsePlan, validatePlan } from '../wulan/core/planner.js';

test('planner only accepts registered read capabilities', () => {
  const world=seedWulanWorld(new WulanWorld());
  world.registerCapability({id:'test.read',name:'Read',risk:'read',execute:async()=>({ok:true})});
  const plan=validatePlan({goal:'inspect',steps:[{capabilityId:'test.read',input:{},reason:'test'}]},world);
  assert.equal(plan.steps[0].capabilityId,'test.read');
  assert.throws(()=>validatePlan({goal:'bad',steps:[{capabilityId:'test.write',input:{}}]},world),/CAPABILITY_NOT_ALLOWED/);
});

test('planner prompt exposes capabilities without executable functions', () => {
  const world=seedWulanWorld(new WulanWorld());
  world.registerCapability({id:'test.read',name:'Read',description:'safe read',risk:'read',execute:async()=>({})});
  const prompt=buildPlanPrompt('inspect',world);
  assert.match(prompt,/test\.read/);
  assert.doesNotMatch(prompt,/execute\s*:/i);
});

test('planner parser accepts fenced JSON', () => {
  const plan=parsePlan('```json\n{"goal":"x","steps":[]}\n```');
  assert.deepEqual(plan,{goal:'x',steps:[]});
});
