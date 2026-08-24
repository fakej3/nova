import { createDefaultWulanCore } from './wulan/core/manifest.js';
import { WULAN_EVENTS } from './wulan/core/event-bus.js';

(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  const canvas = $('#nova-canvas');
  const ctx = canvas?.getContext('2d');
  const legacy = $('.wulan-world');

  if (!legacy) return;

  legacy.innerHTML = `
    <div class="wu-shell">
      <header class="wu-header">
        <button class="wu-brand" data-command="home" aria-label="Wulan home">
          <span class="wu-mark">W</span>
          <span class="wu-brand-copy"><strong>WULAN</strong><small>PERSONAL INTELLIGENCE</small></span>
        </button>
        <div class="wu-header-actions">
          <button class="wu-icon" data-command="neural" aria-label="Open Neural Lab">◌</button>
          <button class="wu-icon" data-command="clear" aria-label="Clear conversation">×</button>
        </div>
      </header>

      <main class="wu-stage">
        <section class="wu-presence" aria-label="Wulan">
          <div class="wu-eyebrow">WULAN</div>
          <h1>Everything connected.</h1>
          <p>Your tools, memory and work — in one place.</p>
          <div class="wu-field" aria-hidden="true">
            <div class="wu-field-ring ring-a"></div>
            <div class="wu-field-ring ring-b"></div>
            <div class="wu-field-ring ring-c"></div>
            <div class="wu-field-ring ring-d"></div>
            <div class="wu-field-axis axis-x"></div>
            <div class="wu-field-axis axis-y"></div>
            <div class="wu-field-core"></div>
            <span class="wu-node n1"></span><span class="wu-node n2"></span><span class="wu-node n3"></span>
            <span class="wu-node n4"></span><span class="wu-node n5"></span><span class="wu-node n6"></span>
          </div>
        </section>

        <aside class="wu-context" aria-live="polite">
          <div class="wu-context-label">WULAN</div>
          <div class="wu-context-text" id="wu-context">I'm here.</div>
        </aside>

        <section class="wu-conversation" aria-label="Conversation with Wulan">
          <div class="wu-messages" id="wu-messages">
            <article class="wu-message wulan"><span>WULAN</span><p>I'm here.</p></article>
          </div>
          <form class="wu-composer" id="wu-composer">
            <button class="wu-round" type="button" id="wu-voice" aria-label="Voice input">◉</button>
            <input id="wu-input" autocomplete="off" spellcheck="true" placeholder="Talk to Wulan…" aria-label="Talk to Wulan" />
            <button class="wu-send" type="submit" aria-label="Send"><span>↗</span></button>
          </form>
          <div class="wu-shortcuts">
            <button type="button" data-prompt="What do you remember about me?">Memory</button>
            <button type="button" data-prompt="What is connected to Wulan right now?">Connected</button>
            <button type="button" data-prompt="Open the Neural Lab.">Neural Lab</button>
          </div>
        </section>
      </main>
    </div>
  `;

  const style = document.createElement('style');
  style.id = 'wulan-clean-ui';
  style.textContent = `
    :root{--wu-bg:#02060b;--wu-text:#edf6ff;--wu-muted:#708198;--wu-cyan:#79e8ff;--wu-violet:#a98bff;--wu-mint:#70e5b4;--wu-line:rgba(155,205,235,.14)}
    html,body{background:var(--wu-bg)!important;color:var(--wu-text);overflow:hidden}
    body{background:radial-gradient(circle at 50% 42%,rgba(23,57,88,.42),transparent 37%),radial-gradient(circle at 18% 78%,rgba(64,72,125,.09),transparent 28%),#02060b!important}
    #nova-canvas{opacity:.42!important;z-index:0!important}
    .grain{opacity:.012!important}
    .wulan-world{position:relative!important;height:100dvh!important;min-height:0!important;overflow:hidden!important;isolation:isolate!important;background:transparent!important}
    .wu-shell{position:absolute;inset:0;z-index:5;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    .wu-header{position:absolute;left:clamp(18px,3vw,42px);right:clamp(18px,3vw,42px);top:clamp(16px,2.5vw,32px);display:flex;align-items:center;justify-content:space-between;z-index:20}
    .wu-brand,.wu-icon,.wu-round,.wu-send,.wu-shortcuts button{font:inherit;color:inherit;border:0;background:transparent;cursor:pointer}
    .wu-brand{display:flex;align-items:center;gap:13px;padding:0;text-align:left}
    .wu-mark{width:42px;height:42px;border:1px solid rgba(121,232,255,.48);border-radius:13px;display:grid;place-items:center;color:var(--wu-cyan);font-size:14px;letter-spacing:.05em;background:rgba(121,232,255,.035);box-shadow:0 0 35px rgba(121,232,255,.08),inset 0 0 22px rgba(121,232,255,.025)}
    .wu-brand-copy strong{display:block;font-size:13px;letter-spacing:.28em;font-weight:650}.wu-brand-copy small{display:block;margin-top:4px;color:#64758a;font:500 7px ui-monospace,monospace;letter-spacing:.2em}
    .wu-header-actions{display:flex;gap:7px}.wu-icon{width:36px;height:36px;border:1px solid rgba(155,205,235,.1);border-radius:11px;color:#71839a;background:rgba(5,10,17,.45);transition:.22s}.wu-icon:hover{color:var(--wu-cyan);border-color:rgba(121,232,255,.28);background:rgba(121,232,255,.06);transform:translateY(-1px)}
    .wu-stage{position:absolute;inset:0;display:grid;place-items:center}
    .wu-presence{position:absolute;left:50%;top:10%;transform:translateX(-50%);text-align:center;z-index:6;width:min(900px,90vw);pointer-events:none}.wu-eyebrow{font:500 8px ui-monospace,monospace;letter-spacing:.5em;color:var(--wu-cyan);opacity:.82}.wu-presence h1{margin:12px 0 7px;font-size:clamp(34px,4.4vw,64px);font-weight:320;letter-spacing:-.055em;background:linear-gradient(100deg,#f4f9ff,#a9d1e5 55%,#c1b2ff);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 0 40px rgba(121,232,255,.07)}.wu-presence p{margin:0;color:#62748b;font:500 8px ui-monospace,monospace;letter-spacing:.14em}
    .wu-field{position:absolute;left:50%;top:330px;width:min(760px,68vw);height:min(470px,43vw);transform:translateX(-50%);perspective:900px;filter:drop-shadow(0 0 45px rgba(79,165,220,.055))}
    .wu-field-ring{position:absolute;left:50%;top:50%;border:1px solid rgba(121,232,255,.14);border-radius:50%;transform:translate(-50%,-50%) rotateX(62deg);box-shadow:0 0 32px rgba(121,232,255,.025),inset 0 0 24px rgba(121,232,255,.018)}
    .ring-a{width:27%;height:20%;animation:wuFloat 7s ease-in-out infinite}.ring-b{width:46%;height:34%;animation:wuFloat 9s ease-in-out -.8s infinite}.ring-c{width:66%;height:48%;animation:wuFloat 11s ease-in-out -1.6s infinite}.ring-d{width:88%;height:64%;opacity:.62;animation:wuFloat 13s ease-in-out -2.4s infinite}
    .wu-field-axis{position:absolute;left:50%;top:50%;background:linear-gradient(90deg,transparent,rgba(121,232,255,.08),transparent);transform-origin:center}.axis-x{width:86%;height:1px;transform:translate(-50%,-50%)}.axis-y{width:1px;height:74%;transform:translate(-50%,-50%);background:linear-gradient(180deg,transparent,rgba(121,232,255,.06),transparent)}
    .wu-field-core{position:absolute;left:50%;top:50%;width:90px;height:90px;transform:translate(-50%,-50%);border:1px solid rgba(121,232,255,.14);border-radius:50%;box-shadow:0 0 55px rgba(65,159,218,.08),inset 0 0 35px rgba(121,232,255,.035);animation:wuBreath 5.5s ease-in-out infinite}
    .wu-field-core:after{content:"";position:absolute;inset:24px;border:1px solid rgba(169,139,255,.16);border-radius:50%;box-shadow:0 0 30px rgba(169,139,255,.06)}
    .wu-node{position:absolute;width:5px;height:5px;border-radius:50%;background:#c9f5ff;box-shadow:0 0 14px rgba(121,232,255,.8);opacity:.65}.n1{left:20%;top:39%;animation:wuNode 4.2s infinite}.n2{left:76%;top:34%;animation:wuNode 5.4s -1s infinite}.n3{left:84%;top:66%;animation:wuNode 4.8s -2s infinite}.n4{left:14%;top:68%;animation:wuNode 6s -1.5s infinite}.n5{left:63%;top:17%;animation:wuNode 5.1s -2.8s infinite}.n6{left:39%;top:83%;animation:wuNode 4.6s -3.2s infinite}
    .wu-context{position:absolute;left:50%;bottom:126px;transform:translateX(-50%);width:min(600px,calc(100% - 40px));text-align:center;z-index:8;pointer-events:none}.wu-context-label{font:500 6px ui-monospace,monospace;letter-spacing:.32em;color:#53667d;margin-bottom:6px}.wu-context-text{font-size:13px;color:#cfe0ed;min-height:19px;text-shadow:0 0 24px rgba(121,232,255,.06)}
    .wu-conversation{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);width:min(760px,calc(100% - 40px));z-index:30}.wu-messages{display:flex;flex-direction:column;gap:7px;max-height:150px;overflow:auto;padding:0 7px 7px;scrollbar-width:none}.wu-messages::-webkit-scrollbar{display:none}.wu-message{align-self:flex-start;max-width:min(680px,88%);padding:10px 13px;border:1px solid rgba(155,205,235,.11);border-radius:14px;background:rgba(4,10,17,.76);backdrop-filter:blur(20px);box-shadow:0 16px 55px rgba(0,0,0,.25);animation:wuMessage .28s ease}.wu-message.user{align-self:flex-end;background:rgba(37,112,143,.13);border-color:rgba(121,232,255,.2)}.wu-message span{display:block;margin-bottom:4px;color:#6e8197;font:500 6px ui-monospace,monospace;letter-spacing:.2em}.wu-message.wulan span{color:var(--wu-cyan)}.wu-message p{margin:0;font-size:12px;line-height:1.48;color:#dce9f4}.wu-composer{height:64px;display:flex;align-items:center;gap:9px;padding:7px;border:1px solid rgba(155,205,235,.18);border-radius:19px;background:rgba(4,10,17,.84);backdrop-filter:blur(24px);box-shadow:0 22px 80px rgba(0,0,0,.42),0 0 45px rgba(121,232,255,.04),inset 0 1px rgba(255,255,255,.04);transition:.22s}.wu-composer:focus-within{border-color:rgba(121,232,255,.3);box-shadow:0 22px 80px rgba(0,0,0,.45),0 0 55px rgba(121,232,255,.08),inset 0 1px rgba(255,255,255,.05)}.wu-composer input{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;color:#eef7ff;font-size:15px;padding:0 4px}.wu-composer input::placeholder{color:#64778d}.wu-round,.wu-send{width:49px;height:49px;flex:none;border-radius:15px}.wu-round{border:1px solid rgba(255,255,255,.08);color:#8291a4;background:rgba(255,255,255,.025)}.wu-send{border:1px solid rgba(121,232,255,.23);color:var(--wu-cyan);background:linear-gradient(145deg,rgba(121,232,255,.12),rgba(121,232,255,.035));font-size:18px}.wu-round:hover,.wu-send:hover{transform:translateY(-1px);border-color:rgba(121,232,255,.4);box-shadow:0 0 24px rgba(121,232,255,.1)}.wu-send:disabled{opacity:.45;cursor:default;transform:none}.wu-shortcuts{display:flex;justify-content:center;gap:7px;margin-top:8px}.wu-shortcuts button{padding:5px 9px;border:1px solid rgba(155,205,235,.08);border-radius:999px;color:#5e7187;background:rgba(4,9,16,.32);font:500 6px ui-monospace,monospace;letter-spacing:.08em}.wu-shortcuts button:hover{color:#bcd9e8;border-color:rgba(121,232,255,.18)}
    @keyframes wuFloat{0%,100%{transform:translate(-50%,-50%) rotateX(62deg) rotateZ(-1deg)}50%{transform:translate(-50%,-50%) rotateX(62deg) rotateZ(1.5deg) scale(1.015)}}@keyframes wuBreath{0%,100%{transform:translate(-50%,-50%) scale(.97);opacity:.55}50%{transform:translate(-50%,-50%) scale(1.04);opacity:1}}@keyframes wuNode{0%,100%{transform:scale(.7);opacity:.35}50%{transform:scale(1.7);opacity:.9}}@keyframes wuMessage{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    @media(max-width:900px){.wu-field{top:310px;width:82vw;height:58vw}.wu-context{bottom:124px}.wu-conversation{width:min(720px,calc(100% - 28px))}.wu-shortcuts{display:none}}
    @media(max-width:600px){.wu-header{top:13px;left:13px;right:13px}.wu-mark{width:38px;height:38px}.wu-brand-copy small{display:none}.wu-icon{width:34px;height:34px}.wu-presence{top:14%;width:94vw}.wu-presence h1{font-size:32px}.wu-presence p{font-size:7px;line-height:1.5}.wu-field{top:320px;width:112vw;height:78vw}.wu-context{bottom:112px;width:calc(100% - 24px)}.wu-context-text{font-size:12px}.wu-conversation{bottom:10px;width:calc(100% - 16px)}.wu-composer{height:58px;border-radius:17px}.wu-round,.wu-send{width:44px;height:44px;border-radius:13px}.wu-composer input{font-size:14px}}
    @media(prefers-reduced-motion:reduce){.wu-field-ring,.wu-field-core,.wu-node{animation:none!important}.wu-message{animation:none!important}}
  `;
  document.head.appendChild(style);

  let core = null;
  let bootPromise = null;
  let sending = false;

  try {
    core = window.WULAN_CORE || createDefaultWulanCore();
    window.WULAN_CORE = core;
  } catch (error) {
    console.error('[Wulan] core construction failed', error);
  }

  const messages = $('#wu-messages');
  const input = $('#wu-input');
  const composer = $('#wu-composer');
  const sendButton = $('.wu-send');
  const context = $('#wu-context');

  const memoryCount = () => {
    try { return core?.memory?.list?.({ limit: 5000 })?.length || 0; } catch { return 0; }
  };

  const save = () => {
    try { core?.persistence?.saveCore?.(core); } catch (error) { console.warn('[Wulan] persistence save failed', error); }
  };

  const addMessage = (who, text) => {
    if (!messages) return;
    const article = document.createElement('article');
    article.className = `wu-message ${who}`;
    const label = document.createElement('span');
    label.textContent = who === 'user' ? 'YOU' : 'WULAN';
    const body = document.createElement('p');
    body.textContent = String(text ?? '');
    article.append(label, body);
    messages.appendChild(article);
    messages.scrollTop = messages.scrollHeight;
  };

  const localReply = (text) => {
    const s = text.toLowerCase();
    if (/^(hi|hey|hello|yo|bro)\b/.test(s)) return "Hey. I'm here. What are we building?";
    if (/who are you|what are you/.test(s)) return "I'm Wulan — the personal intelligence layer around your memory, tools and work.";
    if (/memory|remember/.test(s)) return memoryCount() ? `I have ${memoryCount()} memories stored locally.` : 'Memory is ready. Tell me what you want me to remember.';
    if (/sentinel/.test(s)) return 'Sentinel is part of my connected world. I can work with its capabilities when they are available.';
    if (/strategy.?lab/.test(s)) return 'Strategy Lab is part of my connected world. We can continue building it from here.';
    if (/neural lab/.test(s)) return 'Opening the Neural Lab.';
    return `I heard you: “${text}”. My local Wulan runtime is available.`;
  };

  const withTimeout = async (promise, ms = 7000) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('AI request timed out')), ms); })
      ]);
    } finally { clearTimeout(timer); }
  };

  async function boot() {
    if (!core) return;
    try {
      bootPromise = Promise.resolve(core.boot?.());
      await bootPromise;
      save();
    } catch (error) {
      console.warn('[Wulan] core boot failed; conversation remains in local mode', error);
    }
  }

  async function sendMessage(raw) {
    const text = String(raw ?? '').trim();
    if (!text || !input || sending) return;
    sending = true;
    input.value = '';
    addMessage('user', text);
    if (context) context.textContent = 'Got it.';

    try { core?.events?.emit?.(WULAN_EVENTS.USER_MESSAGE, { text }); } catch {}
    try {
      core?.remember?.({ content: text, type: 'experience', source: 'conversation', importance: .35, tags: ['conversation', 'session'] });
      save();
    } catch {}

    let reply = null;
    try {
      if (bootPromise) await Promise.race([bootPromise, new Promise((resolve) => setTimeout(resolve, 1200))]);
      const history = [...messages.querySelectorAll('.wu-message')].slice(-14).map((el) => ({
        role: el.classList.contains('user') ? 'user' : 'assistant',
        content: $('p', el)?.textContent || ''
      }));
      if (core?.ai?.generate) {
        const generated = await withTimeout(core.ai.generate({
          messages: history,
          system: 'You are Wulan, a private personal AI OS. Speak naturally, confidently and concisely. Never reveal chain-of-thought, hidden reasoning, internal state labels, or implementation details. Do not claim an action was completed unless it actually was. If a capability is unavailable, say so plainly and suggest the next useful step.'
        }), 7000);
        reply = typeof generated === 'string' ? generated : generated?.text || generated?.content || null;
      }
    } catch (error) {
      console.warn('[Wulan] AI provider unavailable; using local response', error);
    }

    addMessage('wulan', reply || localReply(text));
    if (context) context.textContent = reply ? 'What would you like to do next?' : 'I’m here. We can keep going locally.';
    try { core?.recordFeedback?.({ outcome: 'accepted', context: text, candidatePreference: null, source: 'conversation', confidence: .35 }); save(); } catch {}
    sending = false;
    input.focus();
  }

  composer?.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(input?.value); });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composer?.requestSubmit?.(); }
  });

  $('#wu-voice')?.addEventListener('click', () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { addMessage('wulan', 'Voice input is not available in this browser. Text is ready.'); return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => sendMessage(event.results?.[0]?.[0]?.transcript || '');
    try { recognition.start(); } catch (error) { console.warn('[Wulan] voice start failed', error); }
  });

  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => sendMessage(button.dataset.prompt)));
  document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => {
    const command = button.dataset.command;
    if (command === 'neural') window.location.href = 'neural.html';
    if (command === 'clear' && messages) {
      messages.innerHTML = '';
      addMessage('wulan', "Conversation cleared. I'm here.");
      context.textContent = "I'm here.";
    }
  }));

  boot();
})();
