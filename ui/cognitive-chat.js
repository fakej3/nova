import { WULAN_EVENTS } from '../wulan/core/event-bus.js';

(() => {
  const core = window.WULAN_CORE;
  const form = document.querySelector('#composer');
  const input = document.querySelector('#nova-input');
  const messages = document.querySelector('#messages');
  const presence = document.querySelector('.presence-core');
  const presenceText = document.querySelector('#presence-text');
  const activityState = document.querySelector('#activity-state');
  const activityLine = document.querySelector('#activity-line');
  const headline = document.querySelector('#headline');
  const subline = document.querySelector('#subline');
  const memoryLabel = document.querySelector('#memory-label');
  const memoryHint = document.querySelector('#memory-hint');

  if (!core || !form || !input || !messages) return;

  const setState = (state, activity) => {
    activityState && (activityState.textContent = state.toUpperCase());
    activityLine && (activityLine.textContent = activity);
    presenceText && (presenceText.textContent = state.toUpperCase());
    presence?.classList.toggle('active', state === 'acting');
    presence?.classList.toggle('thinking', state === 'thinking' || state === 'learning');
    const copy = {
      thinking: ["Let me think.", 'connecting memory, context and reasoning'],
      acting: ["On it.", 'carrying out the plan'],
      learning: ["I'm learning.", 'keeping the useful signal']
    }[state];
    if (copy) {
      headline && (headline.textContent = copy[0]);
      subline && (subline.textContent = copy[1]);
    }
  };

  const addMessage = (who, text) => {
    const el = document.createElement('div');
    el.className = `message ${who}`;
    const name = document.createElement('span');
    name.className = 'message-name';
    name.textContent = who === 'user' ? 'YOU' : 'WULAN';
    const p = document.createElement('p');
    p.textContent = text;
    el.append(name, p);
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  };

  const saveMemoryState = () => {
    try {
      const memories = core.memory.list({ limit: 5000 });
      memoryLabel?.querySelector('b') && (memoryLabel.querySelector('b').textContent = String(memories.length));
      if (memoryHint) memoryHint.textContent = `memory · ${memories.length} stored`;
      const payload = {
        memories,
        learning: core.learning.recent(5000),
        neural: core.neural.exportState ? core.neural.exportState() : core.neural.snapshot(),
        semantic: core.semantic.exportState ? core.semantic.exportState() : null
      };
      localStorage.setItem('wulan-local-v2', JSON.stringify(payload));
    } catch (error) {
      console.warn('[Wulan] cognition persistence skipped', error);
    }
  };

  async function handle(text) {
    text = String(text ?? '').trim();
    if (!text) return;

    addMessage('user', text);
    core.events.emit(WULAN_EVENTS.USER_MESSAGE, { text, source: 'cognition-chat' });
    setState('thinking', 'retrieving what Wulan already knows');

    try {
      core.remember({
        content: text,
        type: 'experience',
        source: 'conversation',
        importance: .4,
        tags: ['conversation', 'session']
      });

      const run = await core.cognize(text, { execute: true, context: { source: 'chat' } });
      const answer = run.answer || (run.status === 'failed'
        ? `I hit a problem while thinking: ${run.error || 'unknown error'}`
        : 'I processed that, but I do not have a useful response yet.');

      setState(run.results?.length ? 'acting' : 'thinking', run.results?.length ? 'responding after executing the plan' : 'forming the response');
      addMessage('wulan', answer);
      core.recordFeedback({
        outcome: run.status === 'completed' || run.status === 'planned' ? 'accepted' : 'none',
        context: text,
        candidatePreference: run.plan?.intent || null,
        source: 'cognition-chat',
        confidence: .5
      });
      setState('learning', 'keeping the useful signal');
      saveMemoryState();
      setTimeout(() => setState('idle', 'Listening for you.'), 900);
    } catch (error) {
      console.error('[Wulan] cognition chat failed', error);
      setState('error', 'recovering safely');
      addMessage('wulan', `I couldn't complete that safely: ${error?.message || 'unknown error'}`);
      setTimeout(() => setState('idle', 'Listening for you.'), 1200);
    }
  }

  // Capture before the legacy listener in wulan-living.js. This lets us
  // introduce the cognition loop without rewriting the existing shell yet.
  form.addEventListener('submit', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = input.value;
    input.value = '';
    void handle(text);
  }, true);

  window.WULAN_COGNITION_CHAT = { handle };
})();
