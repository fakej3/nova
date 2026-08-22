import { createWulanCore } from './index.js';
import { callGemini, embedGemini } from '../../services/gemini.js';
export function createDefaultWulanCore(){
 const core=createWulanCore();
 core.ai.registerProvider({id:'gemini-free',name:'Gemini 2.5 Flash',capabilities:['text','chat','embeddings'],generate:(request={})=>callGemini(request.messages||[],request.system||'',request.source||'wulan'),embed:(input)=>embedGemini(typeof input==='string'?input:input?.text??input?.content??'')});
 core.ai.setDefaultProvider('gemini-free');
 core.registerAgent({id:'atlas',name:'ATLAS',role:'research'});core.registerAgent({id:'leon',name:'LEON',role:'engineering'});core.registerAgent({id:'oracle',name:'ORACLE',role:'analysis'});core.registerAgent({id:'pixel',name:'PIXEL',role:'creative'});
 core.registerIntegration({id:'sentinel',name:'Sentinel',kind:'trading'});core.registerIntegration({id:'edgelab',name:'EdgeLab',kind:'research'});core.registerIntegration({id:'github',name:'GitHub',kind:'development'});
 core.boot();
 if(typeof window!=='undefined'){
  window.WULAN_CORE=core;
  import('../../ui/world-interactions.js').catch(error=>console.error('[Wulan] world UI failed to load',error));
  import('../../ui/neural-field.js').catch(error=>console.error('[Wulan] neural field failed to load',error));
 }
 return core;
}
