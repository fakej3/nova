import { createDefaultWulanCore } from './wulan/core/manifest.js';
import { WULAN_EVENTS } from './wulan/core/event-bus.js';

(() => {
  const core=typeof window!=='undefined'&&window.WULAN_CORE?window.WULAN_CORE:createDefaultWulanCore();
  const persistence=core?.persistence??null;
  const $=s=>document.querySelector(s);
  const neural=core.neural;
  const semantic=core.semantic;
  const input=$('#nova-input'),composer=$('#composer'),voice=$('#voice'),messages=$('#messages');
  const memoryLabel=$('#memory-label'),agentsLabel=$('#agents-label'),memoryHint=$('#memory-hint'),providerHint=$('#provider-hint');
  const headline=$('#headline'),subline=$('#subline'),presenceText=$('#presence-text');
  if(headline)headline.textContent='WULAN';if(subline)subline.textContent='PERSONAL OPERATING ENVIRONMENT';if(presenceText)presenceText.textContent='ONLINE';
  const memoryCount=()=>core.memory.list({limit:5000}).length;
  const syncLabels=()=>{if(memoryLabel)memoryLabel.innerHTML=`WORLD <b>${core.world?.entities?.size??0}</b>`;if(agentsLabel)agentsLabel.innerHTML=`AGENTS <b>${core.state.agents.size}</b>`;if(memoryHint)memoryHint.textContent=`memory · ${memoryCount()} stored · ${neural.stats().updates} neural updates · ${semantic.stats().entries} semantic entries`;};
  async function syncProviderStatus(){try{const r=await fetch('/api/ai',{headers:{Accept:'application/json'},cache:'no-store'});const d=await r.json();const n=(d.providers??[]).filter(p=>p.configured).length;if(providerHint)providerHint.textContent=`AI gateway · ${n}/${d.providers?.length??0} configured`;}catch{if(providerHint)providerHint.textContent='AI gateway · local core';}}
  function save(){persistence?.saveCore?.(core);}
  function addMessage(who,text,meta=''){const el=document.createElement('div');el.className=`message ${who}`;const name=document.createElement('span');name.className='message-name';name.textContent=who==='user'?'YOU':'WULAN';const p=document.createElement('p');p.textContent=text;el.append(name,p);if(meta){const small=document.createElement('small');small.textContent=meta;el.appendChild(small);}messages.appendChild(el);messages.scrollTop=messages.scrollHeight;}
  function remember(text){core.remember({content:text,type:'experience',source:'conversation',importance:.35,tags:['conversation','session']});syncLabels();}
  function localReply(text){const s=text.toLowerCase();if(/hello|hi|hey|bro/.test(s))return'Hey. What are we building?';if(/who are you|what are you/.test(s))return'Wulan is the operating layer connecting memory, agents, tools, projects and model providers.';if(/memory|learn/.test(s))return`I have ${memoryCount()} local memories and ${neural.stats().updates} neural updates.`;return'I do not have a configured model for this request yet.';}
  async function runAgent(text){const r=await fetch('/api/agent',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({text})});const d=await r.json();if(!r.ok)throw new Error(d.details||d.error||`agent ${r.status}`);return d;}
  async function sendMessage(raw){
    const text=String(raw??'').trim();if(!text)return;addMessage('user',text);core.events.emit(WULAN_EVENTS.USER_MESSAGE,{text});remember(text);
    const prediction=neural.predict(text);
    try{
      const run=await runAgent(text);
      if(run.requiresApproval){addMessage('wulan','I found an action that needs your approval before I run it.',`approval · ${run.plan?.steps?.length??0} step(s)`);return;}
      addMessage('wulan',run.answer||localReply(text),run.plan?.steps?.length?run.plan.steps.map(s=>s.capabilityId).join(' · '):'no external action');
      core.recordFeedback({outcome:'accepted',context:text,candidatePreference:prediction.agent,source:'conversation',confidence:prediction.confidence});
    }catch(error){
      addMessage('wulan',localReply(text),`fallback · ${error.message}`);
      core.recordFeedback({outcome:'rejected',context:text,correction:'agent execution failed',candidatePreference:prediction.agent,source:'system',confidence:.3});
    }finally{save();syncLabels();input?.focus();}
  }
  composer?.addEventListener('submit',e=>{e.preventDefault();const text=input.value;input.value='';sendMessage(text);});
  voice?.addEventListener('click',()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){addMessage('wulan','Voice input is not available in this browser.');return;}const recognition=new SR();recognition.lang=navigator.language||'en-IN';recognition.interimResults=false;recognition.onresult=e=>sendMessage(e.results[0][0].transcript);recognition.start();});
  document.querySelectorAll('.quick button').forEach(b=>b.addEventListener('click',()=>sendMessage({memory:'Show me what Wulan remembers.',agents:'What agents and AI providers are connected?',projects:'What projects are connected to Wulan?',systems:'Check the connected systems.'}[b.dataset.action]??b.dataset.action)));
  core.events.on(WULAN_EVENTS.SYSTEM_READY,syncLabels);core.boot();syncLabels();syncProviderStatus();setInterval(save,15000);
  const clock=$('#clock'),tick=()=>{if(clock)clock.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});};tick();setInterval(tick,1000);
})();
import './wulan/live-activity.js';
