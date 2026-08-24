import { LIVING_STATES } from './wulan/core/living-state.js';

(() => {
  const core = typeof window !== 'undefined' ? window.WULAN_CORE : null;
  const composer = document.querySelector('#composer');
  const input = document.querySelector('#nova-input');
  const messages = document.querySelector('#messages');
  const send = document.querySelector('#nova-send');
  if (!composer || !input || !messages) return;

  const style = document.createElement('style');
  style.textContent = `
    .w-chat{transition:transform .35s ease,filter .35s ease}.w-chat:focus-within{transform:translateX(-50%) translateY(-2px);filter:drop-shadow(0 0 28px rgba(121,232,255,.08))}
    .w-chat .composer{position:relative;border:1px solid rgba(121,232,255,.16);border-radius:17px;background:linear-gradient(135deg,rgba(8,17,28,.88),rgba(3,8,15,.76));box-shadow:0 0 0 1px rgba(255,255,255,.018) inset,0 18px 55px rgba(0,0,0,.28),0 0 45px rgba(70,180,255,.035);backdrop-filter:blur(22px);overflow:hidden}
    .w-chat .composer:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(121,232,255,.05),transparent);transform:translateX(-100%);transition:transform .7s ease}.w-chat:focus-within .composer:before{transform:translateX(100%)}
    .w-chat #nova-input{height:50px;background:transparent;border:0;outline:0;color:#eaf8ff;font-size:11px;letter-spacing:.01em}.w-chat #nova-input::placeholder{color:#5d7187}.w-chat .send,.w-chat .voice{z-index:2;transition:transform .2s ease,box-shadow .2s ease}.w-chat .send:hover,.w-chat .voice:hover{transform:scale(1.06);box-shadow:0 0 22px rgba(121,232,255,.14)}
    .w-chat .message{animation:wulan-message-in .35s cubic-bezier(.2,.8,.2,1) both}.w-chat .message.wulan{border-color:rgba(121,232,255,.12);box-shadow:0 0 28px rgba(121,232,255,.025)}
    .w-chat .typing{display:flex;align-items:center;gap:4px;width:max-content;padding:8px 11px}.w-chat .typing i{width:4px;height:4px;border-radius:50%;background:#79e8ff;box-shadow:0 0 8px #79e8ff;animation:wulan-dot 1s infinite ease-in-out}.w-chat .typing i:nth-child(2){animation-delay:.14s}.w-chat .typing i:nth-child(3){animation-delay:.28s}
    .w-chat .hint span{transition:color .2s ease}.w-chat .hint .live{color:#79e8ff}
    @keyframes wulan-message-in{from{opacity:0;transform:translateY(7px) scale(.985)}to{opacity:1;transform:none}}@keyframes wulan-dot{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
    @media(max-width:720px){.w-chat .composer{border-radius:15px}}
  `;
  document.head.appendChild(style);

  const makeMessage = (who, text) => {
    const el = document.createElement('div'); el.className = `message ${who}`;
    const name = document.createElement('span'); name.className = 'message-name'; name.textContent = who === 'user' ? 'YOU' : 'WULAN';
    const p = document.createElement('p'); p.textContent = text; el.append(name, p); messages.appendChild(el); messages.scrollTop = messages.scrollHeight; return el;
  };
  const typing = () => { const el=document.createElement('div'); el.className='message wulan typing'; el.setAttribute('aria-label','Wulan is thinking'); el.innerHTML='<i></i><i></i><i></i>'; messages.appendChild(el); messages.scrollTop=messages.scrollHeight; return el; };
  const remember = (text) => { try { core?.remember?.({content:text,type:'experience',source:'conversation',importance:.4,tags:['conversation','user-message']}); core?.persistence?.saveCore?.(core); } catch {} };
  const retrieve = (text) => { try { const hits=core?.memory?.search?.(text,{limit:5}) || []; return hits.map(x=>x?.content || x?.text || '').filter(Boolean).slice(0,5); } catch { return []; } };
  const fallback = (text, memories) => memories.length ? `I’m here. I found ${memories.length} relevant memory signal${memories.length===1?'':'s'} while thinking about that. Tell me what you want to do next.` : `I’m here. I heard you: “${text}”. My local Wulan runtime is online.`;

  async function respond(text) {
    remember(text);
    const relevant = retrieve(text);
    let typingEl;
    try {
      core?.living?.transition?.(LIVING_STATES.THINKING,{reason:'conversation',activity:'retrieving context and thinking'});
    } catch {}
    typingEl=typing();
    const memoryBlock = relevant.length ? `\nRelevant private memory signals:\n${relevant.map((m,i)=>`${i+1}. ${m}`).join('\n')}` : '';
    let reply;
    try {
      reply = await core?.ai?.generate?.({
        messages:[{role:'user',content:text}],
        system:`You are Wulan, a private personal AI OS. Be natural, concise and useful. Use the supplied memory signals when relevant, but never invent memories. If you cannot perform an action, say so clearly. Do not claim tools were used unless they actually were.${memoryBlock}`
      });
    } catch { reply = null; }
    typingEl.remove();
    const answer = typeof reply === 'string' ? reply : (reply?.text || reply?.content || fallback(text,relevant));
    makeMessage('wulan',answer);
    try { core?.recordFeedback?.({outcome:'accepted',context:text,source:'conversation-runtime',confidence:.45}); core?.persistence?.saveCore?.(core); } catch {}
    try { core?.living?.transition?.(LIVING_STATES.LEARNING,{reason:'conversation_complete',activity:'keeping useful context'}); core?.living?.decayToIdle?.(900); } catch {}
  }

  composer.addEventListener('submit', (event) => {
    event.preventDefault(); event.stopImmediatePropagation();
    const text=input.value.trim(); if(!text) return; input.value=''; makeMessage('user',text); respond(text).catch(()=>makeMessage('wulan','I hit a temporary conversation error, but the local runtime is still online.')); input.focus();
  }, true);

  input.addEventListener('keydown', (event) => { if(event.key==='Enter' && !event.shiftKey){ event.preventDefault(); composer.requestSubmit(); } });
  input.addEventListener('input', () => { send?.classList.toggle('ready', input.value.trim().length>0); });
})();
