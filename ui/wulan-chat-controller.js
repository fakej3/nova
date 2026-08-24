import { WULAN_EVENTS } from '../wulan/core/event-bus.js';

(() => {
  const boot = () => {
    const core = globalThis.WULAN_CORE;
    const composer = document.querySelector('#wu-composer');
    const input = document.querySelector('#wu-input');
    const messages = document.querySelector('#wu-messages');
    const context = document.querySelector('#wu-context');
    const send = composer?.querySelector('.wu-send');
    const voice = document.querySelector('#wu-voice');

    if (!core || !composer || !input || !messages || globalThis.__WULAN_CHAT_CONTROLLER__) return;
    globalThis.__WULAN_CHAT_CONTROLLER__ = true;

    let busy = false;
    const history = [];

    const addMessage = (who, text) => {
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

    const save = () => {
      try { core.persistence?.saveCore?.(core); } catch (error) { console.warn('[Wulan] persistence save failed', error); }
    };

    const timeout = async (promise, ms = 7500) => {
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), ms); })
        ]);
      } finally { clearTimeout(timer); }
    };

    const localReply = (text) => {
      const s = text.toLowerCase();
      const neural = core.neural?.stats?.() || {};
      if (/^(hi|hey|hello|yo|bro)\b/.test(s)) return "Hey. I'm here. What are we building?";
      if (/who are you|what are you/.test(s)) return "I'm Wulan — the personal intelligence layer around your memory, tools and work.";
      if (/memory|remember/.test(s)) {
        const count = core.memory?.list?.({ limit: 5000 })?.length || 0;
        return count ? `I have ${count} memories stored locally, and I can use relevant ones when you ask.` : 'Memory is ready. Tell me what you want me to remember.';
      }
      if (/neural|neuron|learning/.test(s)) return `The neural substrate is live with ${neural.neurons ?? 0} neurons and ${neural.synapses ?? 0} synapses.`;
      if (/sentinel/.test(s)) return 'Sentinel is registered in my connected world. I can inspect it when the capability is available.';
      if (/strategy\s*lab/.test(s)) return 'Strategy Lab is registered in my connected world. I can inspect it when the capability is available.';
      return `I heard you: “${text}”. My local core is online, but I do not have enough information to answer that without the external model.`;
    };

    const shouldCognize = (text) => /\b(sentinel|strategy\s*lab|github|remember|save this|system status|status of wulan|how is wulan|neural|agents?|projects?|integrations?)\b/i.test(text);

    const generateConversation = async (text) => {
      const memories = core.searchMemory?.(text, { limit: 6 }) || [];
      const memoryBlock = memories.length
        ? `\nRelevant private memory:\n${memories.map((item, i) => `${i + 1}. ${item?.memory?.content ?? item?.content ?? ''}`).join('\n')}`
        : '';
      const result = await timeout(core.ai.generate({
        messages: [...history, { role: 'user', content: text }].slice(-12),
        system: `You are Wulan, a private personal AI OS. Speak naturally, confidently and concisely. Use the supplied private memory only when relevant. Never reveal chain-of-thought, hidden reasoning, internal state labels, or implementation details. Never claim an action happened unless a real capability result supports it. If you cannot do something, say so plainly.${memoryBlock}`,
        source: 'wulan-conversation'
      }));
      return typeof result === 'string' ? result : result?.text || result?.content || '';
    };

    const handle = async (raw) => {
      const text = String(raw ?? '').trim();
      if (!text || busy) return;
      busy = true;
      input.value = '';
      if (send) send.disabled = true;
      addMessage('user', text);
      history.push({ role: 'user', content: text });
      if (history.length > 12) history.splice(0, history.length - 12);
      if (context) context.textContent = 'I’m with you.';

      try { core.events.emit(WULAN_EVENTS.USER_MESSAGE, { text, source: 'wulan-chat-controller' }); } catch {}
      try { core.remember({ content: text, type: 'experience', source: 'conversation', importance: .35, tags: ['conversation', 'session'] }); } catch {}

      let reply = '';
      let external = false;
      try {
        if (shouldCognize(text)) {
          const run = await timeout(core.cognize(text, { execute: true, context: { source: 'chat', approvedCapabilities: [] } }), 12000);
          reply = run.answer || '';
          external = run.status === 'completed' || run.status === 'partial';
        } else {
          reply = await generateConversation(text);
          external = Boolean(reply);
        }
      } catch (error) {
        console.warn('[Wulan] conversation fallback', error);
        reply = localReply(text);
      }

      reply = String(reply || localReply(text));
      addMessage('wulan', reply);
      history.push({ role: 'assistant', content: reply });
      if (history.length > 12) history.splice(0, history.length - 12);

      try {
        core.recordFeedback({
          outcome: external ? 'accepted' : 'none',
          context: text,
          candidatePreference: null,
          source: 'conversation',
          confidence: external ? .35 : .05
        });
      } catch {}
      save();
      window.WULAN_NEURAL_FIELD?.refresh?.();
      if (context) context.textContent = 'I’m here. What’s next?';
      busy = false;
      if (send) send.disabled = false;
      input.focus();
    };

    composer.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void handle(input.value);
    }, true);

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void handle(input.value);
      }
    }, true);

    voice?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { addMessage('wulan', 'Voice input is not available in this browser. Text is ready.'); return; }
      const recognition = new Recognition();
      recognition.lang = navigator.language || 'en-IN';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (result) => void handle(result.results?.[0]?.[0]?.transcript || '');
      try { recognition.start(); } catch (error) { console.warn('[Wulan] voice start failed', error); }
    }, true);

    document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void handle(button.dataset.prompt || '');
    }, true));

    globalThis.WULAN_CHAT = { send: handle, history };
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
