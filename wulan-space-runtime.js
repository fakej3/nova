import { createDefaultWulanCore } from './wulan/core/manifest.js';
import { WULAN_EVENTS } from './wulan/core/event-bus.js';

(() => {
  const frame = document.getElementById('wulan-visual');
  if (!frame) return;
  let core = null;
  let booted = false;
  let busy = false;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const win = () => frame.contentWindow;
  const doc = () => frame.contentDocument;
  const say = (text) => { try { win().say(String(text)); } catch { const el=doc()?.getElementById('answer'); if(el) el.textContent=String(text); } };
  const notify = (k,text) => { try { win().notify(k,String(text)); } catch {} };

  async function bootCore(){
    try {
      core=window.WULAN_CORE||createDefaultWulanCore();
      window.WULAN_CORE=core;
      await Promise.resolve(core.boot?.());
      booted=true;
    } catch(error){ console.warn('[Wulan Space] core boot failed',error); }
  }

  async function cognize(text){
    if(!core?.cognize) throw new Error('Wulan cognition core is unavailable');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const result=await Promise.race([
        Promise.resolve(core.cognize(text,{execute:true,context:{trigger:'wulan-space',source:'conversation'}})),
        new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('cognition timeout')),{once:true}))
      ]);
      return result;
    } finally { clearTimeout(timer); }
  }

  function remember(text){
    try{
      core?.remember?.({content:text,type:'experience',source:'wulan-space',importance:.35,tags:['conversation','wulan-space']});
      core?.persistence?.saveCore?.(core);
      core?.events?.emit?.(WULAN_EVENTS.USER_MESSAGE,{text});
    }catch(error){console.warn('[Wulan Space] remember failed',error);}
  }

  function local(text){
    const s=text.toLowerCase();
    if(/^(hi|hey|hello|yo|bro)\b/.test(s)) return "Hey. I'm here. What are we building?";
    if(/who are you|what are you/.test(s)) return "I'm Wulan — your personal intelligence layer around memory, tools and work.";
    if(/memory|remember/.test(s)){
      let count=0;
      try{count=core?.memory?.list?.({limit:5000})?.length||0;}catch{}
      return count?`I have ${count} local memories available.`:'Memory is online and ready.';
    }
    if(/neural lab/.test(s)) return 'The Neural Lab is ready.';
    return `I heard you: “${text}”. The local Wulan runtime is online.`;
  }

  async function handle(text){
    text=String(text||'').trim();
    if(!text||busy)return;
    busy=true;
    const input=doc()?.getElementById('input');
    if(input)input.value='';
    remember(text);
    say('Working on it…');
    notify('WULAN','Processing your request.');
    try{
      if(!booted) await bootCore();
      const lower=text.toLowerCase();
      if(/open\s+neural|neural\s+lab/.test(lower)){
        say('Opening Neural Lab.');
        setTimeout(()=>{window.location.href='neural.html';},250);
        return;
      }

      const run=await cognize(text);
      const status=run?.status;
      const answer=run?.answer||run?.plan?.answer;
      const results=Array.isArray(run?.results)?run.results:[];
      const successful=results.filter(item=>item?.status==='success');
      const failed=results.filter(item=>item?.status!=='success');

      if(status==='failed'){
        throw new Error(run?.error||'cognition failed');
      }

      if(answer){
        say(answer);
        notify(successful.length?'WULAN':'WULAN','Done.');
      }else if(successful.length){
        say('Done. I completed the requested action.');
        notify('WULAN','Done.');
      }else if(failed.length){
        say(`I couldn't complete that action: ${failed.map(item=>item?.error||item?.capabilityId).filter(Boolean).join(', ')}.`);
        notify('WULAN','The action needs another pass.');
      }else{
        say(local(text));
        notify('LOCAL MODE','The cognition core returned no response, so Wulan answered locally.');
      }
    }catch(error){
      console.warn('[Wulan Space] cognition failed',error);
      say(local(text));
      notify('LOCAL MODE','The live cognition path was unavailable, so Wulan answered locally.');
      try{core?.recordFeedback?.({outcome:'rejected',context:text,correction:'cognition execution failed',source:'wulan-space',confidence:.25});core?.persistence?.saveCore?.(core);}catch{}
    }finally{busy=false;}
  }

  function wire(){
    const d=doc();
    if(!d)return;
    const form=d.getElementById('command');
    const input=d.getElementById('input');
    const voice=d.getElementById('voice');
    const coreEl=d.getElementById('core');

    if(form&&input)form.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();handle(input.value);},true);
    if(coreEl)coreEl.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();say("I'm here. Give me something to do.");notify('WULAN','Core online.');},true);

    d.querySelectorAll('.satellite').forEach(card=>card.addEventListener('click',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      const name=card.dataset.name||'';
      const prompts={
        MEMORY:'Show me what you remember that is relevant to our current work.',
        SENTINEL:'Check Sentinel and tell me its current health, latest deployment, and any obvious unresolved issues.',
        PROJECTS:'Summarize the projects connected to Wulan and what we are currently building.',
        TOOLS:'Tell me what connected tools and capabilities are actually available to Wulan right now.'
      };
      handle(prompts[name]||`Tell me about ${name}.`);
    },true));

    d.querySelectorAll('.quick button').forEach(btn=>btn.addEventListener('click',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      const action=btn.dataset.action;
      const prompts={
        memory:'Show me what Wulan remembers that is relevant to our current work.',
        sentinel:'Check Sentinel and tell me its current health and latest deployment.',
        projects:'What are we currently building?'
      };
      handle(prompts[action]||action);
    },true));

    if(voice)voice.addEventListener('click',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      const SR=win().SpeechRecognition||win().webkitSpeechRecognition;
      if(!SR){notify('VOICE','Voice input is not available in this browser. Text still works.');return;}
      const rec=new SR();
      rec.lang=navigator.language||'en-IN';
      rec.interimResults=false;
      rec.maxAlternatives=1;
      rec.onstart=()=>{voice.classList.add('listening');notify('VOICE','Voice input active.');};
      rec.onresult=ev=>handle(ev.results?.[0]?.[0]?.transcript||'');
      rec.onerror=()=>notify('VOICE','I couldn’t hear that.');
      rec.onend=()=>voice.classList.remove('listening');
      try{rec.start();}catch{}
    },true);

    if(input)input.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&!e.shiftKey){
        e.preventDefault();
        e.stopImmediatePropagation();
        handle(input.value);
      }
    },true);
  }

  frame.addEventListener('load',async()=>{
    await wait(20);
    wire();
    bootCore();
    const status=doc()?.querySelector('.status');
    if(status)status.innerHTML='<i></i>ONLINE · WULAN CORE';
  });
})();
