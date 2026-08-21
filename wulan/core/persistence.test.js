import test from 'node:test';
import assert from 'node:assert/strict';
import { WulanPersistence, WulanMemoryPersistenceAdapter } from './persistence.js';

test('persistence namespace keeps keys isolated', async () => {
  const store = new Map();
  const storage = { getItem:k=>store.get(k)??null, setItem:(k,v)=>store.set(k,v), removeItem:k=>store.delete(k) };
  const persistence = new WulanPersistence({adapter:new WulanMemoryPersistenceAdapter({storage}),namespace:'test'});
  await persistence.save('brain',{updates:3});
  assert.deepEqual(await persistence.load('brain'),{updates:3});
  assert.equal(store.has('test:brain'),true);
  await persistence.remove('brain');
  assert.equal(await persistence.load('brain',null),null);
});

test('persistence works without a storage backend as a safe no-op', async () => {
  const persistence = new WulanPersistence({namespace:'test'});
  assert.deepEqual(await persistence.load('missing',{ok:true}),{ok:true});
  assert.equal(await persistence.save('x',{ok:true}),false);
});
