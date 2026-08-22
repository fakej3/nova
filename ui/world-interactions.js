const STYLE = `
#wulan-world-layer{position:fixed;inset:0;z-index:100;display:none;background:rgba(1,5,10,.66);backdrop-filter:blur(18px)}
#wulan-world-layer.open{display:block}
.wi-drawer{position:absolute;right:24px;top:24px;bottom:24px;width:min(520px,calc(100vw - 48px));border:1px solid rgba(121,232,255,.16);border-radius:22px;background:linear-gradient(145deg,rgba(7,14,24,.96),rgba(2,6,12,.94));box-shadow:0 40px 120px rgba(0,0,0,.55),inset 0 1px rgba(255,255,255,.04);overflow:hidden;display:flex;flex-direction:column}
.wi-head{padding:20px 22px 15px;border-bottom:1px solid rgba(160,205,235,.09);display:flex;justify-content:space-between;align-items:flex-start}.wi-kicker{font:500 7px ui-monospace,monospace;letter-spacing:.2em;color:#6d8299}.wi-title{font-size:23px;font-weight:330;letter-spacing:-.03em;color:#e8f4ff;margin-top:7px}.wi-close{width:32px;height:32px;border:1px solid rgba(160,205,235,.14);border-radius:10px;background:transparent;color:#8fa6bb;cursor:pointer}.wi-body{padding:18px 22px;overflow:auto;flex:1}.wi-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px}.wi-stat,.wi-item{border:1px solid rgba(160,205,235,.09);background:rgba(7,14,24,.6);border-radius:14px;padding:12px}.wi-stat strong{font-size:22px;font-weight:350;display:block}.wi-stat span{font:500 6px ui-monospace,monospace;color:#61758b;letter-spacing:.14em}.wi-item{display:flex;gap:11px;align-items:flex-start;margin-bottom:8px}.wi-item .dot{width:6px;height:6px;border-radius:50%;background:#79e8ff;box-shadow:0 0 12px #79e8ff;margin-top:5px;flex:none}.wi-item b{display:block;font-size:9px;color:#dceaf7;letter-spacing:.05em}.wi-item small{display:block;color:#61758b;font-size:7px;line-height:1.5;margin-top:4px}.wi-item em{margin-left:auto;font:500 6px ui-monospace,monospace;color:#70e5b4;font-style:normal}.wi-action{border:1px solid rgba(121,232,255,.16);background:rgba(121,232,255,.045);color:#bfefff;border-radius:10px;padding:8px 10px;cursor:pointer;font:500 7px ui-monospace,monospace;letter-spacing:.1em}.wi-action:hover{background:rgba(121,232,255,.09);border-color:rgba(121,232,255,.28)}.wi-search{width:100%;box-sizing:border-box;border:1px solid rgba(160,205,235,.12);background:rgba(0,0,0,.16);border-radius:10px;padding:10px;color:#dceaf7;outline:none;margin-bottom:10px}.wi-empty{color:#61758b;font-size:8px;line-height:1.6;padding:20px 4px}.wi-event{padding:9px 0;border-top:1px solid rgba(255,255,255,.045);display:grid;grid-template-columns:92px 1fr;gap:10px}.wi-event time{font:500 6px ui-monospace,monospace;color:#52667c}.wi-event b{font-size:7px;color:#bcd0e2}.wi-event small{display:block;color:#52667c;font-size:6px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wi-probe{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:110;width:min(440px,calc(100vw - 36px));border:1px solid rgba(121,232,255,.2);border-radius:18px;background:rgba(3,9,16,.96);box-shadow:0 30px 100px rgba(0,0,0,.6);padding:18px}.wi-probe h3{margin:0 0 6px;font-size:16px;font-weight:400;color:#e8f5ff}.wi-probe p{margin:0 0 14px;color:#687c91;font-size:8px;line-height:1.6}.wi-probe .wi-close{position:absolute;right:12px;top:12px}.wi-toast{position:fixed;left:50%;bottom:94px;transform:translateX(-50%) translateY(12px);z-index:120;padding:9px 13px;border:1px solid rgba(121,232,255,.18);border-radius:11px;background:rgba(3,9,16,.92);color:#bfefff;font:500 7px ui-monospace,monospace;letter-spacing:.08em;opacity:0;transition:.22s}.wi-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
@media(max-width:720px){.wi-drawer{inset:10px;width:auto}.wi-grid{grid-template-columns:1fr 1fr}}
`;

function boot() {
  if (document.getElementById('wulan-world-layer')) return;
  const core = globalThis.WULAN_CORE;
  if (!core) return;
  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
  const layer = document.createElement('div'); layer.id = 'wulan-world-layer';
  layer.innerHTML = `<section class="wi-drawer"><header class="wi-head"><div><div class="wi-kicker" id="wi-kicker">WORLD INTERFACE</div><div class="wi-title" id="wi-title">Memory</div></div><button class="wi-close" id="wi-close">×</button></header><div class="wi-body" id="wi-body"></div></section>`;
  document.body.appendChild(layer);
  const body = document.getElementById('wi-body');
  const title = document.getElementById('wi-title');
  const kicker = document.getElementById('wi-kicker');
  const close = () => layer.classList.remove('open');
  document.getElementById('wi-close').onclick = close;
  layer.addEventListener('click', e => { if (e.target === layer) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stats = () => core.neural.stats();
  const events = () => core.events.recent(24).slice().reverse();
  const open = (name, render) => { kicker.textContent = 'WORLD INTERFACE / ' + name.toUpperCase(); title.textContent = name; render(); layer.classList.add('open'); };

  function memory() {
    const list = core.memory.list({limit:40});
    const n = stats();
    body.innerHTML = `<div class="wi-grid"><div class="wi-stat"><strong>${list.length}</strong><span>VISIBLE MEMORIES</span></div><div class="wi-stat"><strong>${n.memories}</strong><span>NEURAL MEMORY NODES</span></div></div><input class="wi-search" id="wi-memory-search" placeholder="Search your memory…"><div id="wi-memory-list"></div>`;
    const render = q => { const found = q ? core.memory.search(q,{limit:40}).map(x=>x.memory) : list; document.getElementById('wi-memory-list').innerHTML = found.length ? found.map(m=>`<article class="wi-item"><span class="dot"></span><div><b>${esc(m.type)}</b><small>${esc(m.content)}</small><small>${esc((m.tags||[]).join(' · '))}</small></div><em>${Math.round((m.confidence||0)*100)}%</em></article>`).join('') : `<div class="wi-empty">No matching memory. Nothing invented here.</div>`; };
    render(''); document.getElementById('wi-memory-search').oninput = e => render(e.target.value);
  }

  function agents() {
    const list = [...core.state.agents.values()];
    body.innerHTML = `<div class="wi-grid"><div class="wi-stat"><strong>${list.length}</strong><span>REGISTERED AGENTS</span></div><div class="wi-stat"><strong>${list.filter(a=>a.status==='active').length}</strong><span>ACTIVE NOW</span></div></div>${list.map(a=>`<article class="wi-item"><span class="dot"></span><div><b>${esc(a.name)}</b><small>${esc(a.role||'general')} · ${esc(a.id)}</small></div><em>${esc(a.status)}</em></article>`).join('')}<div class="wi-empty">Agents are inspectable now. Execution stays real: no fake “working” animation is generated just for the interface.</div>`;
  }

  function systems() {
    const list = [...core.state.integrations.values()];
    body.innerHTML = `<div class="wi-grid"><div class="wi-stat"><strong>${list.length}</strong><span>REGISTERED INTEGRATIONS</span></div><div class="wi-stat"><strong>${list.filter(x=>x.status==='connected').length}</strong><span>CONNECTED</span></div></div>${list.map(x=>`<article class="wi-item"><span class="dot"></span><div><b>${esc(x.name)}</b><small>${esc(x.kind||'integration')} · ${esc(x.id)}</small></div><em>${esc(x.status)}</em></article>`).join('')}<div class="wi-empty">These statuses come from Wulan Core. If an integration is disconnected, the UI says disconnected instead of pretending it is online.</div>`;
  }

  function projects() {
    body.innerHTML = `<div class="wi-grid"><div class="wi-stat"><strong>${core.memory.list({type:'project',limit:5000}).length}</strong><span>PROJECT MEMORIES</span></div><div class="wi-stat"><strong>${events().length}</strong><span>RECENT EVENTS</span></div></div><div id="wi-events"></div>`;
    const render = () => { document.getElementById('wi-events').innerHTML = events().map(e=>`<div class="wi-event"><time>${new Date(e.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><div><b>${esc(e.type)}</b><small>${esc(JSON.stringify(e.payload||{}).slice(0,180))}</small></div></div>`).join('') || `<div class="wi-empty">No events yet. This stream will populate as Wulan actually does things.</div>`; };
    render();
  }

  function neuralProbe() {
    const n = stats(); const snap = core.neural.snapshot({limit:18});
    const trace = snap.trace.length ? snap.trace : snap.neurons.filter(x=>x.activation>.01).slice(0,8).map(x=>({label:x.label,type:x.type,activation:x.activation}));
    const probe = document.createElement('div'); probe.className='wi-probe'; probe.innerHTML=`<button class="wi-close">×</button><div class="wi-kicker">LIVE NEURAL PROBE</div><h3>${n.neurons} neurons · ${n.synapses} synapses</h3><p>This is Wulan's actual associative substrate, not a decorative network. The values below come from the live core snapshot.</p>${trace.length?trace.map(x=>`<article class="wi-item"><span class="dot"></span><div><b>${esc(x.label)}</b><small>${esc(x.type)} · activation ${(Number(x.activation)||0).toFixed(3)}</small></div></article>`).join(''):`<div class="wi-empty">No active trace yet. Send Wulan a message, then probe the field again.</div>`}`;
    document.body.appendChild(probe); probe.querySelector('.wi-close').onclick=()=>probe.remove();
  }

  function tool(name) {
    if (name === 'GEMINI') open('Gemini', () => { const p=core.ai.listProviders().find(x=>x.id==='gemini-free'); body.innerHTML=`<div class="wi-grid"><div class="wi-stat"><strong>${p?'READY':'NONE'}</strong><span>DEFAULT PROVIDER</span></div><div class="wi-stat"><strong>${p?.embedding?'YES':'NO'}</strong><span>EMBEDDINGS</span></div></div><article class="wi-item"><span class="dot"></span><div><b>${esc(p?.name||'No provider')}</b><small>${esc((p?.capabilities||[]).join(' · '))}</small></div><em>${esc(p?.id||'none')}</em></article><div class="wi-empty">Provider metadata is read from the real AI gateway. Generation is only attempted when the gateway can actually call Gemini.</div>`; });
    else if (name === 'GITHUB') window.open('https://github.com/fakej3/nova','_blank','noopener');
    else open(name, systems);
  }

  document.querySelectorAll('.w-nav').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.w-nav').forEach(x=>x.classList.remove('active')); btn.classList.add('active');
    ({memory,agents,projects,systems}[btn.dataset.action]||memory)(); layer.classList.add('open');
  }));
  document.querySelectorAll('.w-tool').forEach(row => row.addEventListener('click', () => tool(row.querySelector('b')?.textContent?.trim()||'SYSTEM')));
  document.querySelectorAll('.w-tool').forEach(row => { row.style.cursor='pointer'; row.title='Open live integration'; });

  const canvas = document.getElementById('nova-canvas');
  if (canvas) { canvas.style.cursor='crosshair'; canvas.addEventListener('click', e => { if (e.clientY > innerHeight*.25 && e.clientY < innerHeight*.78 && e.clientX > innerWidth*.2 && e.clientX < innerWidth*.8) neuralProbe(); }); }

  const voice = document.getElementById('voice');
  if (voice) voice.onclick = () => {
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!SR) return toast('Voice input is not available in this browser.');
    const r = new SR(); r.lang='en-IN'; r.interimResults=false; r.maxAlternatives=1;
    voice.classList.add('listening'); r.onresult=e=>{document.getElementById('nova-input').value=e.results[0][0].transcript;document.getElementById('nova-input').focus();}; r.onerror=()=>toast('Voice input stopped.'); r.onend=()=>voice.classList.remove('listening'); r.start();
  };

  function toast(text){let t=document.querySelector('.wi-toast');if(!t){t=document.createElement('div');t.className='wi-toast';document.body.appendChild(t);}t.textContent=text;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2200);}
  core.events.on('*', event => { if(event.type==='memory.created'||event.type==='neural.updated'||event.type==='agent.started'||event.type==='tool.called') { const n=stats(); const mc=document.getElementById('memory-count'); if(mc) mc.textContent=String(core.memory.list({limit:5000}).length); const hint=document.getElementById('memory-hint'); if(hint) hint.textContent=`memory · ${core.memory.list({limit:5000}).length} stored`; } });
  globalThis.WULAN_WORLD_UI={open,refresh:()=>memory(),probe:neuralProbe};
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
