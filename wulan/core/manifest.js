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
  core.registerIntegration({id:'strategy-lab',name:'Strategy Lab',kind:'research'});
  core.registerIntegration({id:'github',name:'GitHub',kind:'development'});

  core.capabilities.register({
    id:'github.inspect',name:'GitHub Inspect',version:'1.0',risk:'read',description:'Read public GitHub repository metadata, directories, or files through the server-side GitHub gateway.',permissions:['github:read'],
    inputSchema:{type:'object',required:['owner','repo'],properties:{owner:{type:'string'},repo:{type:'string'},path:{type:'string'},ref:{type:'string'}}},
    execute:async({owner='fakej3',repo='nova',path='',ref='master'}={})=>{
      const params=new URLSearchParams({owner,repo,path,ref});
      const response=await fetch(`/api/github?${params.toString()}`,{headers:{Accept:'application/json'},cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error||`GitHub HTTP ${response.status}`);
      return data;
    },
    verify:async(result)=>Boolean(result&&result.type&&result.owner&&result.repo)
  });

  const seedBaseNeuralTopology=()=>{
    core.neural.ensureNeuron({id:'system:wulan-core',label:'WULAN CORE',type:'system',strength:.7,tags:['system','routing','core']});
    for(const agent of core.state.agents.values()){const id=`agent:${agent.id}`;core.neural.ensureNeuron({id,label:agent.name,type:'agent',strength:.5,tags:['agent',agent.role??'general']});core.neural.connect('system:wulan-core',id,.28,1);core.neural.connect(id,'system:wulan-core',.2,1);}
  };
  seedBaseNeuralTopology();
  core.boot();

  if(typeof window!=='undefined'){
    if(!document.querySelector('.presence-core')){const anchor=document.createElement('div');anchor.className='presence-core';anchor.setAttribute('aria-hidden','true');anchor.style.display='none';document.body?.appendChild(anchor);}
    window.WULAN_CORE=core;
    fetch('/api/gemini',{headers:{Accept:'application/json'},cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(new Error(`HTTP ${r.status}`))).then(health=>{const state=document.getElementById('provider-state'),hint=document.getElementById('provider-hint');if(health?.configured){if(state)state.textContent='READY';if(hint)hint.textContent='AI GATEWAY · GEMINI READY';}else{if(state)state.textContent='LOCAL';if(hint)hint.textContent='AI GATEWAY · LOCAL CORE';}}).catch(error=>{console.warn('[Wulan] Gemini health check failed',error);const state=document.getElementById('provider-state'),hint=document.getElementById('provider-hint');if(state)state.textContent='LOCAL';if(hint)hint.textContent='AI GATEWAY · LOCAL CORE';});
    import('../../ui/wulan-chat-controller.js').catch(error=>console.error('[Wulan] canonical chat controller failed to load',error));
  }
  return core;
}