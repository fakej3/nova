import { createWulanCore } from './index.js';
import { callGemini, embedGemini } from '../../services/gemini.js';

export function createDefaultWulanCore(){
  const core=createWulanCore();
  core.ai.registerProvider({id:'gemini-free',name:'Gemini 2.5 Flash',capabilities:['text','chat','embeddings'],generate:(request={})=>callGemini(request.messages||[],request.system||'',request.source||'wulan'),embed:(input)=>embedGemini(typeof input==='string'?input:input?.text??input?.content??'')});
  core.ai.setDefaultProvider('gemini-free');

  core.registerAgent({id:'atlas',name:'ATLAS',role:'research'});
  core.registerAgent({id:'leon',name:'LEON',role:'engineering'});
  core.registerAgent({id:'oracle',name:'ORACLE',role:'analysis'});
  core.registerAgent({id:'pixel',name:'PIXEL',role:'creative'});

  core.registerIntegration({id:'sentinel',name:'Sentinel',kind:'trading'});
  core.registerIntegration({id:'edgelab',name:'EdgeLab',kind:'research'});
  core.registerIntegration({id:'github',name:'GitHub',kind:'development'});

  const seedBaseNeuralTopology=()=>{
    core.neural.ensureNeuron({id:'system:wulan-core',label:'WULAN CORE',type:'system',strength:.7,tags:['system','routing','core']});
    for(const agent of core.state.agents.values()){
      const id=`agent:${agent.id}`;
      core.neural.ensureNeuron({id,label:agent.name,type:'agent',strength:.5,tags:['agent',agent.role??'general']});
      core.neural.connect('system:wulan-core',id,.28,1);
      core.neural.connect(id,'system:wulan-core',.2,1);
    }
  };
  seedBaseNeuralTopology();

  core.boot();

  if(typeof window!=='undefined'){
    if(!document.querySelector('.presence-core')){
      const anchor=document.createElement('div');
      anchor.className='presence-core';
      anchor.setAttribute('aria-hidden','true');
      anchor.style.display='none';
      document.body?.appendChild(anchor);
    }

    try {
      const persistenceKey='wulan-local-v2';
      const raw=localStorage.getItem(persistenceKey);
      if(raw){
        const payload=JSON.parse(raw);
        if(Array.isArray(payload.memories)) for(const memory of payload.memories) core.remember(memory);
        if(Array.isArray(payload.learning)) for(const record of payload.learning) core.recordFeedback(record);
        // v2 neural snapshots were produced before the synapse-weight fix.
        // Rebuild those graphs from durable memories + learning instead of
        // carrying the corrupted topology forward. v3+ snapshots are safe.
        if(payload.neural?.version>=3) core.neural.importState(payload.neural);
        if(payload.semantic && typeof core.semantic?.importState==='function') core.semantic.importState(payload.semantic);
        seedBaseNeuralTopology();
      }
    } catch(error) { console.warn('[Wulan] local state restore skipped',error); }

    window.WULAN_CORE=core;
    fetch('/api/gemini',{headers:{Accept:'application/json'},cache:'no-store'})
      .then(r=>r.ok?r.json():Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(health=>{
        const state=document.getElementById('provider-state'),hint=document.getElementById('provider-hint');
        if(health?.configured){if(state)state.textContent='READY';if(hint)hint.textContent='AI GATEWAY · GEMINI READY';}
        else{if(state)state.textContent='LOCAL';if(hint)hint.textContent='AI GATEWAY · LOCAL CORE';}
      })
      .catch(error=>{console.warn('[Wulan] Gemini health check failed',error);const state=document.getElementById('provider-state'),hint=document.getElementById('provider-hint');if(state)state.textContent='LOCAL';if(hint)hint.textContent='AI GATEWAY · LOCAL CORE';});

    import('../../ui/world-interactions.js').catch(error=>console.error('[Wulan] world UI failed to load',error));
    import('../../ui/neural-field.js').then(()=>import('../../ui/neural-field-v4.js')).catch(error=>console.error('[Wulan] neural field failed to load',error));
    import('../../ui/chat-runtime.js').catch(error=>console.error('[Wulan] chat runtime failed to load',error));
  }
  return core;
}