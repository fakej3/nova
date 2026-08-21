import { createDefaultWulanCore } from './wulan/core/manifest.js';
import { WULAN_EVENTS } from './wulan/core/event-bus.js';
import { WulanLocalPersistence } from './wulan/core/living-state.js';

(() => {
  const core = createDefaultWulanCore();
  const persistence = new WulanLocalPersistence();
  const $ = (s) => document.querySelector(s);
  const input = $('#nova-input'), composer = $('#composer'), voice = $('#voice'), messages = $('#messages');
  const memoryLabel = $('#memory-label'), agentsLabel = $('#agents-label'), memoryHint = $('#memory-hint'), providerHint = $('#provider-hint');
  const headline = $('#headline'), subline = $('#subline'), presenceText = $('#presence-text');
  if (headline) headline.textContent='WULAN'; if (subline) subline.textContent='PERSONAL OPERATING ENVIRONMENT'; if (presenceText) presenceText.textContent='ONLINE';
  const memoryCount=()=>core.memory.list({limit:5000}).length;
  const syncLabels=()=>{if(memoryLabel)memoryLabel.innerHTML=`WORLD <b>${core.world?.entities.size??0}</b>`;if(agentsLabel)agentsLabel.innerHTML=`AGENTS <b>${core.state.agents.size}</b>`;if(memoryHint)memoryHint.textContent=`memory · ${memoryCount()} stored`;if(providerHint)providerHint.textContent=`AI gateway · ${core.ai.listProviders().length} providers`;};
  async function syncProviderStatus(){try{const r=await fetch('/api/ai',{headers:{Accept:'application/json'},cache:'no-store'});const d=await r.json();const n=(d.providers??[]).filter(p=>p.configured).length;if(providerHint)providerHint.textContent=`AI gateway · ${n}/${d.providers?.length??0} configured`;}catch{}}
  function save(){persistence.save(core);core.world?.save();}
  function addMessage(who,text,meta=''){const el=document.createElement('div');el.className=`message ${who}`;const name=document.createElement('span');name.className='message-name';name.textContent=who==='user'?'YOU':'WULAN';const p=document.createElement('p');p.textContent=text;el.append(name,p);if(meta){const small=document.createElement('small');small.textContent=meta;el.appendChild(small);}messages.appendChild(el);messages.scrollTop=messages.scrollHeight;}
  function remember(text){core.remember({content:text,type:'experience',source:'conversation',importance:.35,tags:['conversation','session']});syncLabels();}
  function localReply(text){const s=text.toLowerCase();if(/hello|hi|hey|bro/.test(s))return'Hey. What are we building?';if(/who are you|what are you/.test(s))return'Wulan is the operating layer connecting memory, agents, tools, projects and model providers.';if(/memory/.test(s))return`I have ${memoryCount()} local memories.`;return'I can route this request, but no configured model is available to answer it yet.';}
  function buildSystem(route,toolResult){const agent=core.state.agents.get(route.agent),world=core.world?.snapshot();return['You are Wulan, a private personal operating environment.','Do not narrate internal UI states or claim tool actions without evidence.',`Specialist agent: ${agent?.name??route.agent} (${agent?.role??'general'}).`,`Preferred provider: ${agent?.providerId??'gateway'}.`,toolResult?`Live tool result: ${JSON.stringify(toolResult).slice(0,12000)}`:'No external tool was invoked.',world?`Known world entities: ${world.entities.map(e=>`${e.name}:${e.status}`).join(', ')}`:'','Answer naturally and focus on the task.'].filter(Boolean).join('\n');}

  async function routeThroughServer(text){
    const r=await fetch('/api/route',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({text})});
    const d=await r.json();if(!r.ok)throw new Error(d.details||d.error||`route ${r.status}`);return d;
  }

  async function sendMessage(raw){
    const text=String(raw??'').trim();if(!text)return;addMessage('user',text);core.events.emit(WULAN_EVENTS.USER_MESSAGE,{text});remember(text);
    const route=core.orchestrator.classify(text),agent=core.state.agents.get(route.agent);core.world?.observe('user',{type:'task.started',text,agentId:route.agent,providerId:agent?.providerId??null});
    let routed=null,toolResult=null,toolError=null;
    try{
      // Server routing is authoritative for real capability execution. The local
      // orchestrator remains available as the fast UI classification fallback.
      try{routed=await routeThroughServer(text);toolResult=routed?.result?.result??null;}catch(e){toolError=e instanceof Error?e.message:String(e);}
      let reply;
      try{reply=await core.ai.generate({messages:[{role:'user',content:text}],system:buildSystem(route,toolResult??toolError)},{providerId:agent?.providerId});}
      catch(e){if(e?.status===503&&agent?.providerId){try{reply=await core.ai.generate({messages:[{role:'user',content:text}],system:buildSystem(route,toolResult??toolError)});}catch{reply=localReply(text);}}else reply=localReply(text);}
      const shown=typeof reply==='string'?reply:(reply?.text||reply?.content||localReply(text));
      const meta=routed?.route?`${routed.route.agent}${routed.route.capability?` · ${routed.route.capability}`:''}`:`${agent?.name??'WULAN'} · local route`;
      addMessage('wulan',shown,meta);core.recordFeedback({outcome:'accepted',context:text,candidatePreference:null,source:'conversation',confidence:.35});core.world?.observe('wulan',{type:'task.completed',text,agentId:route.agent,providerId:agent?.providerId??null,capability:route.capability??null,success:!toolError});
    }finally{core.world?.save();save();syncLabels();input?.focus();}
  }
  composer?.addEventListener('submit',e=>{e.preventDefault();const text=input.value;input.value='';sendMessage(text);});
  voice?.addEventListener('click',()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){addMessage('wulan','Voice input is not available in this browser.');return;}const recognition=new SR();recognition.lang=navigator.language||'en-IN';recognition.interimResults=false;recognition.onresult=e=>sendMessage(e.results[0][0].transcript);recognition.start();});
  document.querySelectorAll('.quick button').forEach(b=>b.addEventListener('click',()=>sendMessage({memory:'Show me what Wulan remembers.',agents:'What agents and AI providers are connected?',projects:'What projects are connected to Wulan?',systems:'Check the connected systems.'}[b.dataset.action]??b.dataset.action)));
  core.world?.subscribe(e=>{if(e.event.startsWith('capability.'))syncLabels();});core.events.on(WULAN_EVENTS.SYSTEM_READY,syncLabels);persistence.load(core);syncLabels();syncProviderStatus();setInterval(save,15000);
  const clock=$('#clock'),tick=()=>{if(clock)clock.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});};tick();setInterval(tick,1000);
})();
import './wulan/live-activity.js';