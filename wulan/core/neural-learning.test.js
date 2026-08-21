import test from 'node:test';
import assert from 'node:assert/strict';
import { WulanNeuralLayer } from './neural-learning.js';

test('neural layer exposes hidden neurons and probability distribution',()=>{
  const neural=new WulanNeuralLayer({agents:['atlas','leon','oracle','pixel'],storageKey:`test-${Date.now()}`});
  const prediction=neural.predict('fix the GitHub deployment bug');
  assert.equal(prediction.hidden && typeof prediction.hidden==='object',true);
  assert.equal(prediction.ranked.length,4);
  const total=prediction.ranked.reduce((sum,item)=>sum+item.probability,0);
  assert.ok(Math.abs(total-1)<1e-9);
  assert.equal(neural.stats().hiddenLayers,1);
});

test('accepted and rejected outcomes update learned state',()=>{
  const neural=new WulanNeuralLayer({agents:['atlas','leon'],storageKey:`test-${Date.now()}-2`});
  const before=neural.snapshot().synapses.map(s=>s.weight).join(',');
  neural.learn({text:'debug GitHub deployment',agent:'leon',outcome:'accepted'});
  neural.learn({text:'debug GitHub deployment',agent:'leon',outcome:'rejected'});
  const after=neural.snapshot().synapses.map(s=>s.weight).join(',');
  assert.equal(neural.stats().episodes,2);
  assert.notEqual(before,after);
});
