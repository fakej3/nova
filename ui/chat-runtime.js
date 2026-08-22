import { WULAN_EVENTS } from '../wulan/core/event-bus.js';

(() => {
  const boot = () => {
    const core = globalThis.WULAN_CORE;
    const composer = document.querySelector('#composer');
    const input = document.querySelector('#nova-input');
    const send = document.querySelector('#nova-send');
    const messages = document.querySelector('#messages');
    if (!core || !composer || !input || !messages || globalThis.__WULAN_CHAT_RUNTIME__) return;
    globalThis.__WULAN_CHAT_RUNTIME__ = true;

    const history = [];
    let busy = false;
    let providerConfigured = null;
    const system = 'You are Wulan, a private personal AI OS. Be warm, concise, grounded, and honest about what you can actually do. You have local memory, an associative neural substrate, agents, and connected tools. Never claim an external tool or model succeeded when it did not.';

    const el = (id) => document.getElementById(id);
    const setStatus = (state, activity) => {
      const stateEl = el('activity-state');
      const lineEl = el('activity-line');
      const presence = document.querySelector('.presence-core');
      const headline = el('headline');
      const subline = el('subline');
      if (stateEl) stateEl.textContent = state.toUpperCase();
      if (lineEl) lineEl.textContent = activity;
      const copy = {
        IDLE: ["I'm here.", 'quiet · aware · waiting'],
        LISTENING: ["I'm listening.", 'with you · right now'],
        THINKING: ["Let me think.", 'connecting what I know'],
        ACTING: ["On it.", 'working on your request'],
        LEARNING: ["I'm learning.", 'turning experience into structure'],
        ERROR: ["Something broke.", 'recovering safely']
      }[state.toUpperCase()] || ["I'm here.", 'quiet · aware · waiting'];
      if (headline) headline.textContent = copy[0];
      if (subline) subline.textContent = copy[1];
      if (presence) {
        presence.classList.toggle('active', state === 'listening' || state === 'acting');
        presence.classList.toggle('thinking', state === 'thinking' || state === 'learning');
      }
    };

    const addMessage = (who, text) => {
      const item = document.createElement('div');
      item.className = `message ${who}`;
      const name = document.createElement('span');
      name.className = 'message-name';
      name.textContent = who === 'user' ? 'YOU' : 'WULAN';
      const body = document.createElement('p');
      body.textContent = String(text);
      item.append(name, body);
      messages.appendChild(item);
      messages.scrollTop = messages.scrollHeight;
    };

    const persist = () => {
      try {
        const payload = {
          version: 3,
          memories: core.memory?.list?.({ limit: 5000 }) ?? [],
          learning: core.learning?.recent?.(5000) ?? [],
          neural: core.neural?.exportState?.() ?? null,
          semantic: core.semantic?.exportState?.() ?? null
        };
        localStorage.setItem('wulan-local-v2', JSON.stringify(payload));
      } catch (error) {
        console.warn('[Wulan] persistence skipped', error);
      }
    };

    const memoryCount = () => core.memory?.list?.({ limit: 5000 }).length ?? 0;
    const localReply = (text, reason = '') => {
      const s = text.toLowerCase();
      const stats = core.neural?.stats?.() || {};
      if (/^(hi|hey|hello|yo|bro)\b/.test(s)) return "Hey. I'm here. What are we building?";
      if (/who are you|what are you/.test(s)) return "I'm Wulan — the local intelligence layer around your memory, neural substrate, agents and connected tools.";
      if (/what do you remember|memory/.test(s)) return memoryCount() ? `I have ${memoryCount()} local memories stored on this device. I can connect them to concepts and use those relationships when they become relevant.` : "Memory is ready. Tell me what you want me to keep.";
      if (/neural|neuron|network|learning/.test(s)) return `The neural substrate is live: ${stats.neurons ?? 0} neurons, ${stats.synapses ?? 0} synapses, ${stats.active ?? 0} currently active. Your messages create concepts and activate related paths.`;
      if (/what are those|what is this|what's this/.test(s)) return "Those are real pieces of Wulan's internal graph — concepts, memories and agents connected by weighted synapses. The Neural Field is a live view of that state.";
      if (/sentinel/.test(s)) return "Sentinel is registered as a connected system. Its live state can become part of Wulan's working context when the integration is available.";
      if (/github/.test(s)) return "GitHub is registered as a development integration. Wulan can use it when an authorized repository action is available.";
      if (/edgelab|edge lab/.test(s)) return "EdgeLab is registered as a research integration and can become part of Wulan's working context.";
      if (/learn|learning/.test(s)) return "Learning here is real but bounded: Wulan records feedback and changes associative weights. It is not pretending to retrain Gemini.";
      if (/project|build/.test(s)) return "I'm ready. Give me the next thing and I'll keep it in context.";
      if (/429|quota|rate|unavailable|503|timeout/i.test(reason)) return "I'm still here. Gemini is unavailable right now, so I'm using Wulan's local layer instead of pretending an external model answered.";
      return `I heard you: “${text}”. My local core is online; the external model is unavailable, so I won't fake an answer I don't have.`;
    };

    const healthCheck = async () => {
      try {
        const response = await fetch('/api/gemini', { headers: { Accept: 'application/json' }, cache: 'no-store' });
        const data = await response.json();
        providerConfigured = Boolean(data?.configured);
        const state = el('provider-state');
        const hint = el('provider-hint');
        if (providerConfigured) {
          if (state) state.textContent = 'READY';
          if (hint) hint.textContent = 'AI GATEWAY · GEMINI READY';
        } else {
          if (state) state.textContent = 'LOCAL';
          if (hint) hint.textContent = 'AI GATEWAY · LOCAL CORE';
        }
      } catch {
        providerConfigured = false;
        const state = el('provider-state');
        const hint = el('provider-hint');
        if (state) state.textContent = 'LOCAL';
        if (hint) hint.textContent = 'AI GATEWAY · LOCAL CORE';
      }
    };

    const generate = async (text) => {
      const request = {
        messages: [...history, { role: 'user', content: text }].slice(-12),
        system,
        source: 'wulan-chat',
        allowLocalFallback: true
      };
      if (providerConfigured === false) return { text: localReply(text, 'provider unavailable'), external: false };
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('CHAT_TIMEOUT')), 7500));
      try {
        const result = await Promise.race([core.ai.generate(request), timeout]);
        return { text: typeof result === 'string' ? result : (result?.text || result?.content || ''), external: !core.ai.status().lastError };
      } catch (error) {
        return { text: localReply(text, String(error?.message || error)), external: false };
      }
    };

    const handleSubmit = async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy) return;
      const text = input.value.trim();
      if (!text) return;
      busy = true;
      input.value = '';
      if (send) send.disabled = true;
      addMessage('user', text);
      history.push({ role: 'user', content: text });
      if (history.length > 12) history.splice(0, history.length - 12);
      setStatus('thinking', 'connecting your message to memory and concepts');

      try {
        core.events.emit(WULAN_EVENTS.USER_MESSAGE, { text, source: 'chat-runtime' });
        core.remember({ content: text, type: 'experience', source: 'conversation', importance: .35, tags: ['conversation', 'session'] });
        persist();
        window.WULAN_NEURAL_FIELD?.refresh?.();

        const result = await generate(text);
        const reply = result.text || localReply(text);
        history.push({ role: 'assistant', content: reply });
        if (history.length > 12) history.splice(0, history.length - 12);
        setStatus('acting', result.external ? 'Gemini responded through the server boundary' : 'responding from the local Wulan layer');
        await new Promise(resolve => setTimeout(resolve, 120));
        addMessage('wulan', reply);
        core.recordFeedback({ outcome: result.external ? 'accepted' : 'none', context: text, candidatePreference: null, source: 'conversation', confidence: result.external ? .35 : .05 });
        persist();
        window.WULAN_NEURAL_FIELD?.refresh?.();
        setStatus('learning', result.external ? 'recording response feedback' : 'preserving the interaction without false learning');
        await new Promise(resolve => setTimeout(resolve, 220));
        setStatus('idle', 'Ready.');
      } catch (error) {
        console.error('[Wulan chat]', error);
        addMessage('wulan', localReply(text, String(error?.message || error)));
        setStatus('error', 'Recovered with the local core');
        setTimeout(() => setStatus('idle', 'Ready.'), 900);
      } finally {
        busy = false;
        if (send) send.disabled = false;
        input.focus();
      }
    };

    composer.addEventListener('submit', handleSubmit, true);
    send?.addEventListener('click', (event) => {
      event.preventDefault();
      if (typeof composer.requestSubmit === 'function') composer.requestSubmit();
    }, true);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (typeof composer.requestSubmit === 'function') composer.requestSubmit();
      }
    });

    healthCheck();
    globalThis.WULAN_CHAT = { send: (text) => { input.value = text; return composer.requestSubmit(); }, history };
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
