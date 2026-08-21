import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from './capabilities.js';

test('rejects invalid capability input before execution', async () => {
  const registry = new CapabilityRegistry();
  let called = false;
  registry.register({ id:'github.test', name:'test', inputSchema:{type:'object',required:['repo'],properties:{repo:{type:'string'}}}, execute:async()=>{called=true;} });
  await assert.rejects(() => registry.invoke('github.test', {}), /MISSING_INPUT:repo/);
  assert.equal(called, false);
});

test('accepts schema-valid input', async () => {
  const registry = new CapabilityRegistry();
  registry.register({ id:'github.test', name:'test', inputSchema:{type:'object',required:['repo'],properties:{repo:{type:'string'}}}, execute:async input=>input.repo });
  assert.equal(await registry.invoke('github.test', {repo:'fakej3/nova'}), 'fakej3/nova');
});
