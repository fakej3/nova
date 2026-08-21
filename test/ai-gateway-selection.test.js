import test from 'node:test';
import assert from 'node:assert/strict';
import { WulanAIGateway } from '../wulan/core/ai-gateway.js';

test('AI gateway prefers a provider with the requested capability', async () => {
  const gateway = new WulanAIGateway();
  gateway.registerProvider({id:'gemini',name:'Gemini',capabilities:['chat'],priority:10,generate:async()=>({text:'gemini'})});
  gateway.registerProvider({id:'claude',name:'Claude',capabilities:['chat','planning'],priority:20,generate:async()=>({text:'claude'})});
  const result=await gateway.generate({messages:[{role:'user',content:'plan'}]},{capability:'planning'});
  assert.equal(result.text,'claude');
});

test('AI gateway falls back when the preferred provider is unconfigured', async () => {
  const gateway = new WulanAIGateway();
  gateway.registerProvider({id:'gemini',name:'Gemini',capabilities:['chat'],priority:10,generate:async()=>{const e=new Error('not configured');e.status=503;throw e;}});
  gateway.registerProvider({id:'claude',name:'Claude',capabilities:['chat'],priority:20,generate:async()=>({text:'claude'})});
  const result=await gateway.generate({messages:[{role:'user',content:'hello'}]},{capability:'chat'});
  assert.equal(result.text,'claude');
});
