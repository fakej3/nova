import { GeminiProvider } from './gemini.js';

const response=(body,ok=true,status=200)=>({ok,status,json:async()=>body});
const fakeFetch=async(url)=>{if(url.includes(':embedContent'))return response({embedding:{values:[1,0,0]}});return response({candidates:[{content:{parts:[{text:'OK'}]}}]});};
const missing=new GeminiProvider({apiKey:'',fetchImpl:fakeFetch});
if(missing.configured())throw new Error('Missing-key provider reported configured');
const provider=new GeminiProvider({apiKey:'test-key',fetchImpl:fakeFetch});
if(!provider.configured())throw new Error('Configured provider reported unconfigured');
const generated=await provider.generate({prompt:'Reply with exactly OK.',maxOutputTokens:8});
if(generated.text!=='OK')throw new Error('Unexpected generated text');
const embedded=await provider.embed('hello');
if(!Array.isArray(embedded.values)||embedded.values.length!==3)throw new Error('Embedding smoke test failed');
const health=await provider.health();
if(!health.ok)throw new Error('Health smoke test failed');
console.log(JSON.stringify({ok:true,model:provider.model,embeddingModel:provider.embeddingModel}));
