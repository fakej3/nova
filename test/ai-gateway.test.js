import test from 'node:test';
import assert from 'node:assert/strict';
import { WulanAIGateway } from '../wulan/core/ai-gateway.js';

test('gateway exposes providers without leaking implementation functions', () => {
  const gateway = new WulanAIGateway();
  gateway.registerProvider({ id: 'gemini', name: 'Google Gemini', generate: async () => 'ok', priority: 10 });
  gateway.registerProvider({ id: 'openai', name: 'OpenAI / ChatGPT', generate: async () => 'ok', priority: 20 });
  const providers = gateway.listProviders();
  assert.deepEqual(providers.map(p => p.id), ['gemini', 'openai']);
  assert.equal(Object.hasOwn(providers[0], 'generate'), false);
});

test('gateway falls through only when a provider is unconfigured', async () => {
  const gateway = new WulanAIGateway();
  gateway.registerProvider({
    id: 'gemini',
    name: 'Google Gemini',
    generate: async () => { const error = new Error('not configured'); error.status = 503; throw error; },
    priority: 10,
  });
  gateway.registerProvider({
    id: 'openai',
    name: 'OpenAI / ChatGPT',
    generate: async () => 'openai-result',
    priority: 20,
  });
  assert.equal(await gateway.generate({ messages: [] }), 'openai-result');
});

test('gateway does not hide real provider failures behind another paid call', async () => {
  const gateway = new WulanAIGateway();
  gateway.registerProvider({
    id: 'gemini',
    name: 'Google Gemini',
    generate: async () => { const error = new Error('rate limited'); error.status = 429; throw error; },
    priority: 10,
  });
  gateway.registerProvider({ id: 'openai', name: 'OpenAI / ChatGPT', generate: async () => 'should-not-run', priority: 20 });
  await assert.rejects(() => gateway.generate({ messages: [] }), /rate limited/);
});
