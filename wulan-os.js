import { createDefaultWulanCore } from './wulan/core/manifest.js';
import { WULAN_EVENTS } from './wulan/core/event-bus.js';
import { WulanLocalPersistence } from './wulan/core/living-state.js';

(() => {
  const core=createDefaultWulanCore(),persistence=new WulanLocalPersistence(),$=s=>document.querySelector(s);const neural=core.neural,consolidation=core.consolidation;
  const input=$('#nova-input'),composer=$('#composer'),voice=$('#voice'),messages=$('#messages'),memoryLabel=$('#memory-label'),agentsLabel=$('#agents-label'),memoryHint=$('#memory-hint'),providerHint=$('#provider-hint');
  const headline=$('#headline'),subline=$('#subline'),presenceText=$('#presence-text');if(headline)headline.textContent='WULAN';if(subline)subline.textContent='PERSONAL OPERATING ENVIRONMENT';if(presenceText)presenceText.textContent='ONLINE';
  const memoryCount=()=>core.memory.list({limit:5000}).length;
  const syncLabels=()=>{if(memoryLabel)memoryLabel.innerHTML=`WORLD <b>${core.world?.entities.size??0}</b>`;if(agentsLabel)agentsLabel.innerHTML=`AGENTS <b>${core.state.agents.size}</b>`;if(memoryHint)memoryHint.textContent=`memory · ${memoryCount()} stored · ${consolidation.stats().patterns} learned patterns · ${neural.stats().updates} neural updates`;};
  async function syncProviderStatus(){try{const r=await fetch('/api/ai',{headers:{Accept:'application/json'},cache:'no-store'});const d=await r.json();const n=(d.providers??[]).filter(p=>p.configured).length;if(providerHint)providerHint.textContent=`AI gateway · ${n}/${d.providers?.length??0} configured`;}catch{}}
  function save(){persistence.save(core);core.world?.save();neural.save();consolidation.save();core.knowledge?.save?.();}
  function addMessage(who,text,meta=''){const el=document.createElement('div');el.className=`message ${who}`;const name=document.createElement('span');name.className='message-name';name.textContent=who==='user'?'YOU':'WULAN';const p=document.createElement('p');p.textContent=text;el.append(name,p);if(meta){const small=document.createElement('small');small.textContent=meta;el.appendChild(small);}messages.appendChild(el);messages.scrollTop=messages.scrollHeight;}
  function remember(text){core.remember({content:text,type:'experience',source:'conversation',importance:.35,tags:['conversation','session']});syncLabels();}
  function localReply(text){const s=text.toLowerCase();if(/hello|hi|hey|bro/.test(s))return'Hey. What are we building?';if(/who are you|what are you/.test(s))return'Wulan is the operating layer connecting memory, agents, tools, projects and model providers.';if(/memory/.test(s))return`I have ${memoryCount()} local memories and ${consolidation.stats().patterns} learned patterns.`;return'I do not have a configured model for this request yet.';}
  async function runAgent(text){const r=await fetch('/api/agent',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({text})});const d=await r.json();if(!r.ok)throw new Error(d.details||d.error||`agent ${r.status}`);return d;}
  async function sendMessage(raw){
    const text=String(raw??'').trim();if(!text)return;addMessage('user',text);core.events.emit(WULAN_EVENTS.USER_MESSAGE,{text});remember(text);
    const prediction=neural.predict(text),prior=consolidation.retrieve(text,{agent:prediction.agent,limit:3});
    try{
      const run=await runAgent(text);
      if(run.requiresApproval){addMessage('wulan','I found an action that needs your approval before I run it.',`approval · ${run.plan?.steps?.length??0} step(s)`);return;}
      addMessage('wulan',run.answer||localReply(text),run.plan?.steps?.length?run.plan.steps.map(s=>s.capabilityId).join(' · '):'no external action');
      const outcome=run.learning?.outcome==='accepted'?'accepted':run.learning?.outcome==='rejected'?'rejected':run.verification?.outcome==='verified'?'accepted':run.verification?.outcome==='failed'?'rejected':'inconclusive';
      const learnedAgent=run.agent||prediction.agent;
      if(outcome!=='inconclusive'&&learnedAgent){const confidence=Number(run.learning?.confidence??run.verification?.confidence??prediction.confidence??.3);core.recordFeedback({outcome,context:text,candidatePreference:learnedAgent,source:'verified-agent-run',confidence});consolidation.consolidate({text,agent:learnedAgent,outcome,confidence,toolResult:run.results,source:'verified-agent-run'});}
      if(prior.length)core.remember({content:`Prior learned context considered: ${prior.map(p=>p.keywords.slice(0,5).join(', ')).join(' | ')}`,type:'knowledge',source:'learning-retrieval',importance:.25,tags:['learning-context']});
    }catch(error){
      addMessage('wulan',localReply(text),'fallback');
      // Transport/provider failures are not evidence that the chosen agent is bad.
      // Do not train the neural network on infrastructure failures.
      core.remember({content:`Agent run unavailable: ${error.message}`,type:'system-event',source:'agent-runtime',importance:.15,tags:['agent-error']});
    }
    finally{core.world?.save();save();syncLabels();input?.focus();}
  }
  composer?.addEventListener('submit',e=>{e.preventDefault();const text=input.value;input.value='';sendMessage(text);});
  voice?.addEventListener('click',()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){addMessage('wulan','Voice input is not available in this browser.');return;}const recognition=new SR();recognition.lang=navigator.language||'en-IN';recognition.interimResults=false;recognition.onresult=e=>sendMessage(e.results[0][0].transcript);recognition.start();});
  document.querySelectorAll('.quick button').forEach(b=>b.addEventListener('click',()=>sendMessage({memory:'Show me what Wulan remembers.',agents:'What agents and AI providers are connected?',projects:'What projects are connected to Wulan?',systems:'Check the connected systems.'}[b.dataset.action]??b.dataset.action)));
  core.world?.subscribe(e=>{if(e.event.startsWith('capability.'))syncLabels();});core.events.on(WULAN_EVENTS.SYSTEM_READY,syncLabels);persistence.load(core);syncLabels();syncProviderStatus();setInterval(save,15000);
  const clock=$('#clock'),tick=()=>{if(clock)clock.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});};tick();setInterval(tick,1000);
})();
import './wulan/live-activity.js';