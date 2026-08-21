import { createDefaultWulanCore } from './wulan/core/manifest.js';
import { WULAN_EVENTS } from './wulan/core/event-bus.js';
import { WulanLocalPersistence } from './wulan/core/living-state.js';

(() => {
  const core = createDefaultWulanCore();
  const persistence = new WulanLocalPersistence();
  const $ = (s) => document.querySelector(s);
  const input = $('#nova-input');
  const composer = $('#composer');
  const voice = $('#voice');
  const messages = $('#messages');
  const memoryLabel = $('#memory-label');
  const agentsLabel = $('#agents-label');
  const memoryHint = $('#memory-hint');
  const providerHint = $('#provider-hint');
  const headline = $('#headline');
  const subline = $('#subline');
  const presenceText = $('#presence-text');

  if (headline) headline.textContent = 'WULAN';
  if (subline) subline.textContent = 'PERSONAL OPERATING ENVIRONMENT';
  if (presenceText) presenceText.textContent = 'ONLINE';

  function memoryCount() {
    return core.memory.list({ limit: 5000 }).length;
  }

  function syncLabels() {
    if (memoryLabel) memoryLabel.innerHTML = `WORLD <b>${core.world?.entities.size ?? 0}</b>`;
    if (agentsLabel) agentsLabel.innerHTML = `AGENTS <b>${core.state.agents.size}</b>`;
    if (memoryHint) memoryHint.textContent = `memory · ${memoryCount()} stored`;
    if (providerHint) providerHint.textContent = `AI gateway · ${core.ai.listProviders().length} providers`;
  }

  async function syncProviderStatus() {
    try {
      const response = await fetch('/api/ai', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await response.json();
      const configured = (data.providers ?? []).filter(provider => provider.configured).length;
      if (providerHint) providerHint.textContent = `AI gateway · ${configured}/${data.providers?.length ?? 0} configured`;
    } catch {}
  }

  function save() {
    persistence.save(core);
    core.world?.save();
  }

  function addMessage(who, text, meta = '') {
    const el = document.createElement('div');
    el.className = `message ${who}`;
    const name = document.createElement('span');
    name.className = 'message-name';
    name.textContent = who === 'user' ? 'YOU' : 'WULAN';
    const p = document.createElement('p');
    p.textContent = text;
    el.append(name, p);
    if (meta) {
      const small = document.createElement('small');
      small.textContent = meta;
      el.appendChild(small);
    }
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  function remember(text) {
    core.remember({ content: text, type: 'experience', source: 'conversation', importance: .35, tags: ['conversation', 'session'] });
    syncLabels();
  }

  function localReply(text) {
    const s = text.toLowerCase();
    if (/hello|hi|hey|bro/.test(s)) return 'Hey. Wulan is online. What are we building?';
    if (/who are you|what are you/.test(s)) return 'Wulan is the operating layer: memory, agents, tools, projects and model providers connected through one core.';
    if (/memory/.test(s)) return `I have ${memoryCount()} local memories. The world model is also stored on this device.`;
    return 'The local core is online, but no configured model could answer this request.';
  }

  function buildSystem(route, toolResult) {
    const agent = core.state.agents.get(route.agent);
    const world = core.world?.snapshot();
    return [
      'You are Wulan, a private personal operating environment.',
      'Do not describe yourself as listening, thinking, waiting, or being alive. Do not narrate internal UI states.',
      'Never claim a tool action happened unless the supplied tool result proves it.',
      `Route this request through specialist agent ${agent?.name ?? route.agent} (${agent?.role ?? 'general'}).`,
      `Preferred model provider: ${agent?.providerId ?? 'gateway'}.`,
      toolResult ? `Live tool result: ${JSON.stringify(toolResult).slice(0, 12000)}` : 'No external tool was invoked for this request.',
      world ? `World entities currently known: ${world.entities.map(e => `${e.name}:${e.status}`).join(', ')}` : '',
      'Answer naturally and focus on the user task.',
    ].filter(Boolean).join('\n');
  }

  async function sendMessage(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return;
    addMessage('user', text);
    core.events.emit(WULAN_EVENTS.USER_MESSAGE, { text });
    remember(text);

    const route = core.orchestrator.classify(text);
    const agent = core.state.agents.get(route.agent);
    core.world?.observe('user', { type: 'task.started', text, agentId: route.agent, providerId: agent?.providerId ?? null });
    if (agent && !route.capability) core.startAgent(route.agent, { reason: 'user_request' });

    let toolResult = null;
    let toolError = null;
    try {
      if (route.capability) {
        try {
          const inspected = await core.orchestrator.inspect(text, { input: {} });
          toolResult = inspected.result ?? inspected;
        } catch (error) {
          toolError = error instanceof Error ? error.message : String(error);
          core.world?.observe('tool', { type: 'task.tool_failed', capability: route.capability, error: toolError });
        }
      }

      let reply;
      try {
        reply = await core.ai.generate(
          { messages: [{ role: 'user', content: text }], system: buildSystem(route, toolResult ?? toolError) },
          { providerId: agent?.providerId },
        );
      } catch (error) {
        // If the specialist's provider is simply unconfigured, let the gateway
        // try the next configured provider instead of dropping straight to local mode.
        if (error?.status === 503 && agent?.providerId) {
          try {
            reply = await core.ai.generate({ messages: [{ role: 'user', content: text }], system: buildSystem(route, toolResult ?? toolError) });
          } catch {
            reply = localReply(text);
          }
        } else {
          reply = localReply(text);
        }
      }

      const shown = typeof reply === 'string' ? reply : (reply?.text || reply?.content || localReply(text));
      addMessage('wulan', shown, `${agent?.name ?? 'WULAN'} · ${agent?.providerId ?? 'gateway'}${route.capability ? ` · ${route.capability}` : ''}`);
      core.recordFeedback({ outcome: 'accepted', context: text, candidatePreference: null, source: 'conversation', confidence: .35 });
      core.world?.observe('wulan', {
        type: 'task.completed', text, agentId: route.agent, providerId: agent?.providerId ?? null,
        capability: route.capability ?? null, success: !toolError,
      });
    } finally {
      if (agent && !route.capability) core.finishAgent(route.agent, { reason: 'user_request_complete' });
      core.world?.save();
      save();
      syncLabels();
      input?.focus();
    }
  }

  composer?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value;
    input.value = '';
    sendMessage(text);
  });

  voice?.addEventListener('click', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      addMessage('wulan', 'Voice input is not available in this browser. Text input is ready.');
      return;
    }
    const recognition = new SR();
    recognition.lang = navigator.language || 'en-IN';
    recognition.interimResults = false;
    recognition.onresult = event => sendMessage(event.results[0][0].transcript);
    recognition.onerror = () => {};
    recognition.start();
  });

  document.querySelectorAll('.quick button').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      const prompts = {
        memory: 'Show me what Wulan remembers.',
        agents: 'What agents and AI providers are connected?',
        projects: 'What projects are connected to Wulan?',
        systems: 'Check the connected systems.',
      };
      sendMessage(prompts[action] ?? action);
    });
  });

  core.world?.subscribe(event => {
    if (event.event === 'capability.started' || event.event === 'capability.completed' || event.event === 'capability.failed') syncLabels();
  });

  core.events.on(WULAN_EVENTS.SYSTEM_READY, syncLabels);
  persistence.load(core);
  syncLabels();
  syncProviderStatus();
  setInterval(save, 15000);

  const clock = $('#clock');
  const tick = () => { if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  tick();
  setInterval(tick, 1000);
})();
