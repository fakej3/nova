import { createDefaultWulanCore } from './wulan/core/manifest.js';
import { WULAN_EVENTS } from './wulan/core/event-bus.js';
import { LIVING_STATES, WulanLivingState, WulanLocalPersistence } from './wulan/core/living-state.js';

(() => {
  const core = createDefaultWulanCore();
  const living = new WulanLivingState();
  const persistence = new WulanLocalPersistence();
  const $ = (s) => document.querySelector(s);
  const canvas = $('#nova-canvas');
  const ctx = canvas.getContext('2d');
  const input = $('#nova-input');
  const composer = $('#composer');
  const voice = $('#voice');
  const messages = $('#messages');
  const presence = $('#presence-core') || $('.w-stage') || canvas;
  const presenceText = $('#presence-text');
  const activityState = $('#activity-state');
  const activityLine = $('#activity-line');
  const headline = $('#headline');
  const subline = $('#subline');
  const memoryLabel = $('#memory-label');
  const agentsLabel = $('#agents-label');
  const memoryHint = $('#memory-hint');
  const providerHint = $('#provider-hint');

  let w = 0, h = 0, dpr = 1, t = 0;
  let visualState = living.snapshot();
  const pointer = { x: 0, y: 0, active: false, velocity: 0 };
  let lastPointer = null;
  const particles = [];
  const tendrils = [];
  const sparks = [];

  for (let i = 0; i < 210; i++) particles.push({ a: Math.random() * 6.28, r: .08 + Math.random() * .98, phase: Math.random() * 6.28, speed: .15 + Math.random() * .7, size: .35 + Math.random() * 1.5 });
  for (let i = 0; i < 46; i++) tendrils.push({ angle: i / 46 * 6.28 + Math.random() * .08, len: .55 + Math.random() * .65, width: .5 + Math.random() * 1.5, phase: Math.random() * 6.28, speed: .15 + Math.random() * .45, curve: (Math.random() - .5) * .7 });
  for (let i = 0; i < 34; i++) sparks.push({ a: Math.random() * 6.28, r: .1 + Math.random() * .6, phase: Math.random() * 6.28, speed: .4 + Math.random() * 1.2 });

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pointer.x = w / 2; pointer.y = h * .53;
  }
  addEventListener('resize', resize); resize();

  const center = () => ({ x: w / 2 + Math.sin(t * .17) * w * .012, y: h * .53 + Math.cos(t * .13) * h * .008 });
  const S = () => Math.min(w, h);
  const energy = () => visualState.energy;

  function organicPoint(angle, r, phase = 0) {
    const q = center(), e = energy();
    const pulse = 1 + Math.sin(t * 1.35 + phase) * (.025 + e * .035);
    const breathing = 1 + Math.sin(t * .58 + phase * .3) * (.045 + e * .025);
    const noise = Math.sin(angle * 3.1 + t * .38 + phase) * (.045 + e * .025) + Math.sin(angle * 7.7 - t * .21 + phase * 2) * .018;
    const rr = r * (pulse + noise) * breathing;
    return { x: q.x + Math.cos(angle) * S() * .27 * rr, y: q.y + Math.sin(angle) * S() * .19 * rr };
  }

  function drawTendril(th, index, e) {
    const a = th.angle + t * th.speed * (.018 + e * .025);
    ctx.beginPath();
    for (let j = 0; j <= 44; j++) {
      const p = j / 44;
      const curl = Math.sin(p * 4.8 + th.phase + t * (.35 + e * .7)) * .12 * p * p;
      const sway = Math.sin(t * .42 + th.phase + p * 3) * (.025 + e * .03) * p;
      const pt = organicPoint(a + curl + th.curve * p * p, .07 + p * th.len + sway, th.phase);
      if (j === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    }
    const alpha = .025 + e * .065 * (index % 4 === 0 ? 1.5 : 1);
    ctx.strokeStyle = index % 3 === 0 ? `rgba(104,226,255,${alpha})` : index % 3 === 1 ? `rgba(157,137,255,${alpha * .8})` : `rgba(109,230,190,${alpha * .72})`;
    ctx.lineWidth = th.width * (.65 + e * .5);
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const q = center(), e = energy(), size = S();
    const bg = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, size * (.42 + e * .16));
    bg.addColorStop(0, `rgba(62,150,255,${.045 + e * .07})`);
    bg.addColorStop(.38, `rgba(68,92,180,${.02 + e * .025})`);
    bg.addColorStop(1, 'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    particles.forEach((p) => { p.a += .0007 * p.speed * (visualState.state === LIVING_STATES.THINKING ? 3.5 : 1); const pt = organicPoint(p.a, p.r + Math.sin(t * .34 + p.phase) * (.035 + e * .02), p.phase); const d = Math.hypot(pt.x - pointer.x, pt.y - pointer.y); const attraction = pointer.active ? Math.max(0, 1 - d / (size * (.3 + e * .18))) : 0; const pulse = (Math.sin(t * (.8 + p.speed) + p.phase) + 1) / 2; ctx.beginPath(); ctx.arc(pt.x, pt.y, p.size * (.65 + pulse * .75 + attraction * 1.7), 0, 6.283); ctx.fillStyle = `rgba(167,226,255,${.025 + e * .07 + attraction * .22})`; ctx.fill(); });
    tendrils.forEach((th, i) => drawTendril(th, i, e));
    sparks.forEach((s) => { s.a += .002 * s.speed * (visualState.state === LIVING_STATES.THINKING ? 2.8 : 1 + e); const pt = organicPoint(s.a, s.r + Math.sin(t * .8 + s.phase) * .035, s.phase); const glow = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 9 + e * 8); glow.addColorStop(0, `rgba(205,248,255,${.45 + e * .3})`); glow.addColorStop(1, 'transparent'); ctx.fillStyle = glow; ctx.fillRect(pt.x - 14, pt.y - 14, 28, 28); ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.1 + e * 1.1, 0, 6.283); ctx.fillStyle = '#c9f6ff'; ctx.fill(); });
    for (let layer = 0; layer < 5; layer++) { ctx.beginPath(); for (let i = 0; i <= 150; i++) { const a = i / 150 * 6.283; const base = .12 + layer * .055 + visualState.attention * .018; const wob = .028 * Math.sin(a * (3 + layer * .7) + t * (.5 + layer * .08)) + .017 * Math.sin(a * 8 - t * .32 + layer); const rr = base + wob; const x = q.x + Math.cos(a) * size * .55 * rr / .18; const y = q.y + Math.sin(a) * size * .38 * rr / .18; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.strokeStyle = `rgba(105,205,255,${.018 + e * .032 - layer * .002})`; ctx.lineWidth = .55; ctx.stroke(); }
    const coreR = size * (.043 + e * .016); const glow = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, coreR * 5); glow.addColorStop(0, `rgba(125,225,255,${.11 + e * .15})`); glow.addColorStop(.3, `rgba(95,143,255,${.055 + e * .08})`); glow.addColorStop(1, 'transparent'); ctx.fillStyle = glow; ctx.fillRect(q.x - coreR * 5, q.y - coreR * 5, coreR * 10, coreR * 10);
    for (let k = 0; k < 4; k++) { ctx.beginPath(); for (let i = 0; i <= 90; i++) { const a = i / 90 * 6.283; const wob = Math.sin(a * (4 + k) + t * (.7 + k * .2)) * coreR * (.18 + e * .08) + Math.cos(a * 7 - t) * coreR * .1; const rr = coreR * (.55 + k * .16) + wob; const x = q.x + Math.cos(a + t * (.03 + k * .01)) * rr; const y = q.y + Math.sin(a - t * (.04 + k * .015)) * rr * (.62 + visualState.attention * .18); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.strokeStyle = `rgba(169,239,255,${.09 + k * .025 + e * .08})`; ctx.lineWidth = 1 - k * .13; ctx.stroke(); }
    const dot = 2 + e * 2.8 + Math.min(pointer.velocity * .006, 2); ctx.beginPath(); ctx.arc(q.x + Math.sin(t * .8) * 2, q.y + Math.cos(t * .65) * 2, dot, 0, 6.283); ctx.fillStyle = '#e6fbff'; ctx.shadowBlur = 26 + e * 18; ctx.shadowColor = '#72e8ff'; ctx.fill(); ctx.shadowBlur = 0;
    requestAnimationFrame(draw); t += .012;
  }
  draw();

  presence.classList.add('canvas-presence');
  const copy = { idle:["I'm here.",'quiet · aware · waiting'], listening:["I'm listening.",'with you · right now'], thinking:["Let me think.",'connecting what I know'], remembering:["I remember.",'looking through memory'], acting:["On it.",'working on your request'], learning:["I'm learning.",'feedback becomes experience'], error:["Something broke.",'recovering safely'] };
  living.subscribe((next) => { visualState = next; const words = copy[next.state] ?? copy.idle; presenceText.textContent = next.state.toUpperCase(); activityState.textContent = next.state.toUpperCase(); activityLine.textContent = next.activity; headline.textContent = words[0]; subline.textContent = words[1]; presence.classList.toggle('active', next.state === 'listening' || next.state === 'acting'); presence.classList.toggle('thinking', next.state === 'thinking' || next.state === 'learning'); });

  function addMessage(who, text) { const el = document.createElement('div'); el.className = `message ${who}`; const name = document.createElement('span'); name.className = 'message-name'; name.textContent = who === 'user' ? 'YOU' : 'WULAN'; const p = document.createElement('p'); p.textContent = text; el.append(name, p); messages.appendChild(el); messages.scrollTop = messages.scrollHeight; }
  function memoryCount() { return core.memory.list({ limit: 5000 }).length; }
  function save() { persistence.save(core); }
  function rememberConversation(text) { const entry = core.remember({content:text,type:'experience',source:'conversation',importance:.35,tags:['conversation','session']}); memoryLabel.querySelector('b').textContent = String(memoryCount()); memoryHint.textContent = `memory · ${memoryCount()} stored`; save(); return entry; }
  function localReply(text) { const s = text.toLowerCase(); if (/hello|hi|hey|bro/.test(s)) return "Hey. I'm right here. What are we building?"; if (/who are you|what are you/.test(s)) return "I'm Wulan — the personal layer we're building around your tools, memory and future AI providers."; if (/remember|memory/.test(s)) return memoryCount() ? `I have ${memoryCount()} private memories stored on this device.` : "Memory is ready. Tell me what you want me to keep."; if (/sentinel/.test(s)) return "Sentinel is registered. Wulan can inspect its state when the integration is invoked."; if (/strategy.?lab|strategy labs/.test(s)) return "Strategy Lab is registered. Wulan can inspect its research state when the integration is invoked."; if (/learn|learning/.test(s)) return "Learning is recording explicit feedback and experience; later those signals can influence routing and behavior."; if (/project|build/.test(s)) return "I'm ready. Give me the next thing and I'll keep it in context."; return `I heard you: “${text}”. My local core is online, and I will use the configured provider when it is available.`; }

  async function sendMessage(text) {
    text = text.trim(); if (!text) return;
    addMessage('user', text); core.events.emit(WULAN_EVENTS.USER_MESSAGE, { text }); living.transition(LIVING_STATES.THINKING, { reason: 'user_message', activity: 'connecting your message to context' }); rememberConversation(text); await new Promise(r => setTimeout(r, 280 + Math.random() * 420));
    let reply; try { reply = await core.ai.generate({ messages:[{role:'user',content:text}], system:'You are Wulan, a private personal AI OS. Be concise, warm and honest about what you can actually do.' }); } catch { reply = localReply(text); }
    living.transition(LIVING_STATES.ACTING, { reason:'response_ready', activity:'responding to you' }); await new Promise(r => setTimeout(r,140); addMessage('wulan', typeof reply === 'string' ? reply : (reply?.text || reply?.content || localReply(text))); core.recordFeedback({outcome:'accepted',context:text,candidatePreference:null,source:'conversation',confidence:.35}); living.transition(LIVING_STATES.LEARNING, {reason:'conversation_feedback',activity:'keeping the useful signal'}); save(); living.decayToIdle(900); input.focus();
  }
  composer.addEventListener('submit', e => { e.preventDefault(); const text = input.value; input.value = ''; sendMessage(text); });
  presence.addEventListener('click', () => { living.transition(LIVING_STATES.LISTENING, { reason:'presence_interaction', focus:'you', activity:'listening to you' }); input.focus(); living.decayToIdle(3000); });
  document.addEventListener('pointermove', e => { const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y; pointer.velocity=Math.hypot(dx,dy); pointer.x=e.clientX; pointer.y=e.clientY; pointer.active=true; if(!lastPointer||pointer.velocity>45)living.pulse({attention:Math.min(1,living.attention+.025),focus:'environment'}); lastPointer={x:e.clientX,y:e.clientY}; });
  document.addEventListener('pointerleave', () => { pointer.active=false; pointer.velocity=0; });
  voice.addEventListener('click', () => { const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR){addMessage('wulan','Voice input is not available in this browser. Text is ready.');return;} const rec=new SR(); rec.lang=navigator.language||'en-IN'; rec.interimResults=false; living.transition(LIVING_STATES.LISTENING,{reason:'voice_input',activity:'listening to your voice'}); rec.onresult=e=>{input.value=e.results[0][0].transcript;const text=input.value;input.value='';sendMessage(text);}; rec.onerror=()=>living.transition(LIVING_STATES.IDLE,{reason:'voice_error',activity:'Listening for you.'}); rec.onend=()=>{if(living.state===LIVING_STATES.LISTENING)living.transition(LIVING_STATES.IDLE,{reason:'voice_end',activity:'Listening for you.'});}; rec.start(); });
  document.querySelectorAll('.w-nav').forEach(btn => btn.addEventListener('click', () => { const a=btn.dataset.action; document.querySelectorAll('.w-nav').forEach(n=>n.classList.toggle('active',n===btn)); const lines={memory:`Memory is awake. ${memoryCount()} private memories are stored locally.`,agents:`${core.state.agents.size} agents are registered and available in Wulan's runtime.`,projects:`${core.world.listProjects().length} projects are present in the local world model.`,systems:`${core.state.integrations.size} integrations are registered: ${[...core.state.integrations.values()].map(x=>x.name).join(', ')}.`}; addMessage('wulan',lines[a]??'World context updated.'); living.transition(LIVING_STATES.REMEMBERING,{reason:`open_${a}`,focus:a,activity:`${a} context surfaced`}); living.decayToIdle(1600); }));
  core.events.on(WULAN_EVENTS.SYSTEM_READY, () => { activityLine.textContent='Core online. I am ready.'; providerHint.textContent=core.ai.listProviders().length?'AI gateway · connected':'AI gateway · waiting for provider'; });
  core.boot();
  memoryLabel.querySelector('b').textContent=String(memoryCount()); agentsLabel.querySelector('b').textContent=String(core.state.agents.size); memoryHint.textContent='memory · ready';
  setInterval(save,15000);
  const clock=$('#clock'); const tick=()=>clock.textContent=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); tick(); setInterval(tick,1000);
})();