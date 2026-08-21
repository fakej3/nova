import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCapabilityResult, summarizeVerification } from './verification.js';

test('does not treat execution alone as success', () => {
  const result = verifyCapabilityResult({ capability:{ id:'x' }, result:{ok:true} });
  assert.equal(result.outcome, 'inconclusive');
});

test('uses capability verifier as evidence', () => {
  const result = verifyCapabilityResult({ capability:{ verify: value => ({outcome:value.ok?'verified':'failed',confidence:.9}) }, result:{ok:true} });
  assert.equal(result.outcome, 'verified');
  assert.equal(result.confidence, .9);
});

test('summarizes mixed verification without manufacturing success', () => {
  const result = summarizeVerification([{verification:{outcome:'verified'}},{verification:{outcome:'inconclusive'}}]);
  assert.equal(result.outcome, 'inconclusive');
  assert.equal(result.verified, 1);
  assert.equal(result.inconclusive, 1);
});
