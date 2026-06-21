/**
 * NOVA Conversation System v2
 *
 * Routes messages through:
 *   1. Local fast intents (clear, time, date, note:, task:)
 *   2. Gemini API when key is configured
 *   3. Local data-aware fallback (no key / offline)
 *
 * Gemini responses may contain action markers that are parsed and
 * executed silently before display:
 *   [SAVE_MEMORY: "content"]
 *   [CREATE_TASK: "title"]
 *   [CREATE_NOTE: "title | content"]
 *   [COMPLETE_TASK: "title substring"]
 */

import { DB }                     from '../core/db.js';
import { Bus, EVENTS }            from '../core/bus.js';
import { State }                  from '../core/state.js';
import { setOrbState }            from '../ui/orb.js';
import { showToast }              from '../ui/toast.js';
import { logEvent, EVENT_TYPES }  from '../services/events.js';
import { callGemini, hasGeminiKey } from '../services/gemini.js';

const MAX_HISTORY = 100;
const LS_KEY      = 'nova_conversation';

let _messages = [];
let _busy     = false;

// ── Public API ────────────────────────────────────────────────

export function initConversation() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _messages = JSON.parse(raw).slice(-MAX_HISTORY);
  } catch { _messages = []; }
}

export function isBusy() { return _busy; }

export function clearConversation() {
  _messages = [];
  _saveHistory();
}

// ── Main message handler ──────────────────────────────────────

export async function handleUserMessage(rawText) {
  const text = rawText.trim();
  if (!text || _busy) return;
  _busy = true;

  _addMessage('user', text);
  _saveHistory();

  Bus.emit(EVENTS.CHAT_MESSAGE_SENT, { preview: text.slice(0, 50) });
  Bus.emit(EVENTS.REQUEST_SWITCH_VIEW, { view: 'chat' });
  _renderIfOpen();

  setOrbState('thinking');

  try {
    let response;

    // 1. Try local intents — fast, offline, no AI needed
    const local = await _tryLocalIntent(text);

    if (local !== null) {
      response = local;
    } else if (hasGeminiKey()) {
      // 2. Real Gemini response
      const context      = await _buildContext();
      const systemPrompt = _buildSystemPrompt(context);
      const history      = _messages.slice(-24); // last 24 messages for context
      const raw          = await callGemini(history, systemPrompt);
      response = await _parseActions(raw);
    } else {
      // 3. Local data-aware fallback
      response = await _localFallback(text);
    }

    setOrbState('responding');
    _addMessage('nova', response);
    _saveHistory();
    _renderIfOpen();

    Bus.emit(EVENTS.AI_RESPONSE_RECEIVED, { preview: response.slice(0, 50) });
    await logEvent(EVENT_TYPES.AI_RESPONDED, 'AI response generated');

    await _delay(500);
    setOrbState('success');

  } catch (err) {
    console.error('[Conversation]', err.message);

    let errMsg;
    if (err.message === 'NO_KEY')           errMsg = 'No AI key configured. Go to Settings → Gemini API Key to enable real AI responses.';
    else if (err.message === 'INVALID_KEY') errMsg = 'Invalid Gemini API key. Check Settings → Gemini API Key.';
    else if (err.message === 'RATE_LIMIT')  errMsg = 'Rate limit reached. Wait a moment and try again.';
    else if (err.message === 'EMPTY_RESPONSE') errMsg = 'Gemini returned an empty response. Please try again.';
    else errMsg = 'Something went wrong. Please try again.';

    _addMessage('nova', errMsg);
    _saveHistory();
    _renderIfOpen();
    setOrbState('error');

  } finally {
    _busy = false;
  }
}

// ── Local intent router ───────────────────────────────────────
// Returns a string if handled, null to fall through to Gemini.

async function _tryLocalIntent(text) {
  const q = text.toLowerCase().trim();

  // Clear conversation
  if (/^(clear|reset|new chat|start over)$/.test(q)) {
    _messages = _messages.slice(-1);
    _saveHistory();
    return 'Conversation cleared.';
  }

  // Time (quick answer, no AI needed)
  if (/^(what time is it|what('s| is) the time|current time|time)$/.test(q)) {
    return `It's ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
  }

  // Date (quick answer)
  if (/^(what('s| is) (today|the date)|today's date|date)$/.test(q)) {
    return `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
  }

  // Shorthand note creation: "note: X"
  const noteCmd = text.match(/^note:\s+(.+)/i);
  if (noteCmd) return _createNote(noteCmd[1].trim());

  // Shorthand task creation: "task: X"
  const taskCmd = text.match(/^task:\s+(.+)/i);
  if (taskCmd) return _createTask(taskCmd[1].trim());

  return null;
}

// ── Context builder for Gemini system prompt ──────────────────

async function _buildContext() {
  try {
    const [allNotes, allTasks, memCount] = await Promise.all([
      DB.notes.getAll(),
      DB.tasks.getAll(),
      DB.memories.count(),
    ]);

    const pending   = allTasks.filter(t => t.status === 'pending');
    const completed = allTasks.filter(t => t.status === 'completed');

    const recentNotes = [...allNotes]
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
      .slice(0, 5);

    const recentPending = [...pending]
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 8);

    const recentMems = await DB.memories.getRecent(5);

    return { recentNotes, recentPending, completed, memCount, allNotes, recentMems };
  } catch {
    return { recentNotes: [], recentPending: [], completed: [], memCount: 0, allNotes: [], recentMems: [] };
  }
}

function _buildSystemPrompt(ctx) {
  const aiName   = State.get('aiName')   || 'NOVA';
  const userName = State.get('userName') || '';
  const now      = new Date();
  const timeStr  = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr  = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const notesSummary = ctx.recentNotes.length
    ? ctx.recentNotes.map(n => `• "${n.title || 'Untitled'}"`).join('\n')
    : 'None yet.';

  const tasksSummary = ctx.recentPending.length
    ? ctx.recentPending.map(t => {
        const p   = t.priority === 1 ? 'High' : t.priority === 3 ? 'Low' : 'Med';
        const due = t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
        return `• [ID:${t.id}] "${t.title}" (${p}${due})`;
      }).join('\n')
    : 'No pending tasks.';

  const memsSummary = ctx.recentMems.length
    ? ctx.recentMems.map(m => `• ${m.content.slice(0, 80)}`).join('\n')
    : 'None yet.';

  return `You are ${aiName}, a personal AI operating system assistant. You are concise, intelligent, and warm.

${userName ? `User's name: ${userName}` : ''}
Current time: ${timeStr}
Current date: ${dateStr}

== USER'S DATA ==

Notes (${ctx.allNotes.length} total, showing recent):
${notesSummary}

Pending tasks (${ctx.recentPending.length} shown):
${tasksSummary}

Completed tasks: ${ctx.completed.length}
Saved memories: ${ctx.memCount}

Recent memories:
${memsSummary}

== BEHAVIORAL RULES ==

1. Keep responses concise — under 120 words unless the user asks for detail.
2. Be warm but efficient. This is a personal OS, not a chatbot.
3. Reference the user's actual data when relevant.
4. Never invent data that isn't in the context above.

== ACTION MARKERS ==
When appropriate, append ONE OR MORE of these on separate lines at the very end of your response.
The markers are processed automatically and NOT shown to the user — never mention them.

When the user shares a personal fact worth preserving (exam dates, appointments, preferences, goals, names):
[SAVE_MEMORY: "one clear sentence summarizing the fact"]

When the user explicitly asks to create a task:
[CREATE_TASK: "task title"]

When the user explicitly asks to create a note:
[CREATE_NOTE: "note title | note content"]

When the user asks to mark a task as done/complete/finished — use the task ID from the list above:
[COMPLETE_TASK: "task_id_here"]

Example of a response with an action marker:
User: "My chemistry exam is on the 20th"
Response: "Got it! Good luck with the chemistry exam on the 20th.
[SAVE_MEMORY: "Chemistry exam is on the 20th of this month"]"
`;
}

// ── Action marker parser ──────────────────────────────────────

const ACTION_RE = /\[(SAVE_MEMORY|CREATE_TASK|CREATE_NOTE|COMPLETE_TASK):\s*"([^"]+)"\]/g;

async function _parseActions(rawText) {
  const actions = [];
  let clean = rawText;

  for (const match of rawText.matchAll(ACTION_RE)) {
    actions.push({ type: match[1], value: match[2] });
    clean = clean.replace(match[0], '');
  }

  clean = clean.replace(/\n{3,}/g, '\n\n').trim();

  for (const action of actions) {
    try {
      await _executeAction(action.type, action.value);
    } catch (e) {
      console.warn('[Conversation] Action failed:', action.type, e);
    }
  }

  return clean;
}

async function _executeAction(type, value) {
  switch (type) {
    case 'SAVE_MEMORY': {
      const id = await DB.memories.create({
        type:    'ai_fact',
        content: value,
        source:  'ai',
        tags:    [],
      });
      Bus.emit(EVENTS.MEMORY_CREATED, { id, content: value });
      await logEvent(EVENT_TYPES.MEMORY_CREATED, `Memory saved: ${value.slice(0, 60)}`);
      showToast('◈ Memory saved', 'success', 2200);
      break;
    }
    case 'CREATE_TASK': {
      const id = await DB.tasks.create({ title: value.slice(0, 80) });
      Bus.emit(EVENTS.TASK_CREATED, { id, title: value });
      await logEvent(EVENT_TYPES.TASK_CREATED, `Task created: ${value.slice(0, 60)}`);
      showToast(`◉ Task created: "${value.slice(0, 40)}"`, 'success', 2500);
      break;
    }
    case 'CREATE_NOTE': {
      const [title, ...rest] = value.split('|');
      const content = rest.join('|').trim();
      const id = await DB.notes.create({
        title:   title.trim().slice(0, 60),
        content: content || title.trim(),
      });
      Bus.emit(EVENTS.NOTE_CREATED, { id, title: title.trim() });
      await logEvent(EVENT_TYPES.NOTE_CREATED, `Note created: ${title.trim().slice(0, 60)}`);
      showToast(`◇ Note saved: "${title.trim().slice(0, 35)}"`, 'success', 2500);
      break;
    }
    case 'COMPLETE_TASK': {
      // value is either a task ID or a title substring
      const allTasks = await DB.tasks.getAll();
      const target = allTasks.find(t =>
        t.id === value ||
        t.title.toLowerCase().includes(value.toLowerCase())
      );
      if (target && target.status !== 'completed') {
        await DB.tasks.update(target.id, {
          status:      'completed',
          completedAt: new Date().toISOString(),
        });
        Bus.emit(EVENTS.TASK_COMPLETED, { id: target.id, title: target.title });
        await logEvent(EVENT_TYPES.TASK_COMPLETED, `Task completed: ${target.title}`);
        showToast(`✓ Task done: "${target.title.slice(0, 40)}"`, 'success', 2500);
      }
      break;
    }
  }
}

// ── Local data-aware fallback (no Gemini key) ─────────────────

async function _localFallback(text) {
  const q = text.toLowerCase().trim();

  if (/\b(help|what can you|commands|capabilities)\b/.test(q)) {
    return _helpText();
  }

  if (/\b(notes?|my notes?|show notes?|list notes?)\b/.test(q)) {
    return _notesResponse();
  }

  if (/\b(tasks?|todos?|pending|to-?do|show tasks?|list tasks?)\b/.test(q)) {
    return _tasksResponse();
  }

  if (/\b(memor(y|ies)|what.*remember|recall|what.*know)\b/.test(q)) {
    return _memoriesResponse();
  }

  const searchMatch = q.match(/\b(?:search|find|look for)\b\s+(.+)/);
  if (searchMatch) return _searchResponse(searchMatch[1].trim());

  if (/\b(summary|overview|status|how many|count)\b/.test(q)) {
    return _statusResponse();
  }

  const noteMatch = q.match(/^(?:remember|save|add note|create note|note this)[:\-—]?\s+(.+)/i);
  if (noteMatch) return _createNote(noteMatch[1].trim());

  const taskMatch = q.match(/^(?:todo|add task|create task|remind me to)[:\-—]?\s+(.+)/i);
  if (taskMatch) return _createTask(taskMatch[1].trim());

  // No key configured — tell the user
  const name = State.get('userName');
  const greeting = name ? `${name}, ` : '';
  return `${greeting}I can answer that better with a Gemini API key. Go to Settings → Gemini API Key to enable real AI. Until then, try: "show my notes", "pending tasks", "give me a summary", or "help".`;
}

// ── Local response builders ───────────────────────────────────

function _helpText() {
  const hasKey = hasGeminiKey();
  if (hasKey) {
    return [
      'You can talk to me naturally — I understand context.',
      '',
      'Examples:',
      '**"What do I need to do today?"**',
      '**"Remember that my interview is Friday"**',
      '**"Create a task to revise economics"**',
      '**"What have I saved about exams?"**',
      '**"Mark the grocery task as done"**',
      '',
      'Shortcuts: **note: [text]** · **task: [text]** · **clear**',
    ].join('\n');
  }
  return [
    'Add a Gemini API key in Settings to enable full AI.',
    '',
    'Without it, I can still:',
    '**show my notes** — list your notes',
    '**pending tasks** — see what needs doing',
    '**give me a summary** — notes + tasks + memory count',
    '**find [keyword]** — search everything',
    '**note: [text]** — quick note',
    '**task: [text]** — quick task',
  ].join('\n');
}

async function _notesResponse() {
  try {
    const all = await DB.notes.getAll();
    if (!all.length) return "No notes yet. Say \"note: [text]\" to create one.";
    const pinned = all.filter(n => n.pinned);
    const recent = [...all].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)).slice(0, 5);
    const lines  = [`You have ${all.length} note${all.length !== 1 ? 's' : ''}.`];
    if (pinned.length) lines.push(`Pinned: ${pinned.map(n => `"${n.title || 'Untitled'}"`).join(', ')}.`);
    lines.push(`Recent: ${recent.map(n => `"${n.title || 'Untitled'}"`).join(', ')}.`);
    lines.push('Open the Notes panel to read them.');
    return lines.join('\n');
  } catch { return "I couldn't read your notes right now."; }
}

async function _tasksResponse() {
  try {
    const all     = await DB.tasks.getAll();
    const pending = all.filter(t => t.status === 'pending');
    if (!all.length) return "No tasks yet. Say \"task: [description]\" to add one.";
    const lines = [];
    if (pending.length) {
      const sorted = [...pending].sort((a, b) => a.priority - b.priority);
      lines.push(`${pending.length} pending task${pending.length !== 1 ? 's' : ''}:`);
      sorted.slice(0, 5).forEach(t => {
        const p   = t.priority === 1 ? 'High' : t.priority === 3 ? 'Low' : 'Med';
        const due = t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
        lines.push(`• ${t.title || 'Untitled'} (${p}${due})`);
      });
      if (pending.length > 5) lines.push(`…and ${pending.length - 5} more.`);
    } else {
      lines.push('No pending tasks — all clear!');
    }
    return lines.join('\n');
  } catch { return "I couldn't read your tasks right now."; }
}

async function _memoriesResponse() {
  try {
    const all = await DB.memories.getAll();
    if (!all.length) return "No memories yet. They're saved when you share personal facts — try telling me something important.";
    const recent = [...all].sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1)).slice(0, 4);
    const lines  = [`${all.length} memor${all.length !== 1 ? 'ies' : 'y'} stored:`];
    recent.forEach(m => lines.push(`• ${m.content.slice(0, 90)}${m.content.length > 90 ? '…' : ''}`));
    if (all.length > 4) lines.push(`…and ${all.length - 4} more in the Memories panel.`);
    return lines.join('\n');
  } catch { return "I couldn't access your memories right now."; }
}

async function _searchResponse(term) {
  try {
    const [notes, allTasks, mems] = await Promise.all([
      DB.notes.search(term, 3),
      DB.tasks.getAll(),
      DB.memories.search(term, 3),
    ]);
    const tasks = allTasks.filter(t =>
      t.title.toLowerCase().includes(term.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(term.toLowerCase())
    ).slice(0, 3);
    const total = notes.length + tasks.length + mems.length;
    if (!total) return `Nothing found for "${term}". Try a different keyword.`;
    const lines = [`Found ${total} result${total !== 1 ? 's' : ''} for "${term}":`];
    if (notes.length) lines.push(`Notes: ${notes.map(n => `"${n.title || 'Untitled'}"`).join(', ')}`);
    if (tasks.length) lines.push(`Tasks: ${tasks.map(t => `"${t.title || 'Untitled'}"`).join(', ')}`);
    if (mems.length)  lines.push(`Memories: ${mems.map(m => `"${m.content.slice(0, 40)}"`).join(', ')}`);
    return lines.join('\n');
  } catch { return `Search failed for "${term}". Try the Search panel (Ctrl+K).`; }
}

async function _statusResponse() {
  try {
    const [noteCount, allTasks, memCount] = await Promise.all([
      DB.notes.count(),
      DB.tasks.getAll(),
      DB.memories.count(),
    ]);
    const pending = allTasks.filter(t => t.status === 'pending');
    const lines   = ["System status:"];
    lines.push(`• ${noteCount} note${noteCount !== 1 ? 's' : ''}`);
    lines.push(`• ${pending.length} pending task${pending.length !== 1 ? 's' : ''}`);
    lines.push(`• ${memCount} memor${memCount !== 1 ? 'ies' : 'y'}`);
    if (pending.length) {
      const top = [...pending].sort((a, b) => a.priority - b.priority)[0];
      lines.push(`Next: "${top.title || 'Untitled'}"`);
    }
    const hasKey = hasGeminiKey();
    lines.push(`• AI: ${hasKey ? 'Gemini connected' : 'No key — see Settings'}`);
    return lines.join('\n');
  } catch { return "I couldn't get a summary right now."; }
}

async function _createNote(content) {
  try {
    const title = content.slice(0, 60);
    const id    = await DB.notes.create({ title, content });
    Bus.emit(EVENTS.NOTE_CREATED, { id, title });
    await logEvent(EVENT_TYPES.NOTE_CREATED, `Note: ${title}`);
    showToast(`◇ Note saved`, 'success', 2000);
    return `Note saved: "${title}${content.length > 60 ? '…' : ''}". Find it in the Notes panel.`;
  } catch { return "I couldn't create that note. Try the Notes panel."; }
}

async function _createTask(content) {
  try {
    const title = content.slice(0, 80);
    const id    = await DB.tasks.create({ title });
    Bus.emit(EVENTS.TASK_CREATED, { id, title });
    await logEvent(EVENT_TYPES.TASK_CREATED, `Task: ${title}`);
    showToast(`◉ Task added`, 'success', 2000);
    return `Task added: "${title}${content.length > 80 ? '…' : ''}". Find it in the Tasks panel.`;
  } catch { return "I couldn't create that task. Try the Tasks panel."; }
}

// ── Panel renderer ────────────────────────────────────────────

export function renderConversationPanel() {
  const content = document.getElementById('panel-content');
  if (!content) return;

  if (!_messages.length) {
    const hasKey = hasGeminiKey();
    content.innerHTML = `
      <div class="conv-empty">
        <div class="conv-empty-icon">◎</div>
        <p class="conv-empty-title">Ask me anything</p>
        <p class="conv-empty-desc">${hasKey ? 'Gemini AI is connected. Talk naturally.' : 'Add a Gemini API key in Settings for real AI. I can still help with your notes and tasks.'}</p>
        <div class="conv-suggestions">
          <button class="conv-suggest" data-q="What do I need to do today?">Today's tasks</button>
          <button class="conv-suggest" data-q="give me a summary">System summary</button>
          <button class="conv-suggest" data-q="show my notes">My notes</button>
          <button class="conv-suggest" data-q="help">What can you do?</button>
        </div>
      </div>`;
    content.querySelectorAll('.conv-suggest').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('nova-input');
        if (input) { input.value = btn.dataset.q; input.focus(); }
      });
    });
    return;
  }

  const html = _messages.map(_renderMessage).join('');
  content.innerHTML = `<div class="conv-list">${html}</div>`;
  requestAnimationFrame(() => { content.scrollTop = content.scrollHeight; });
}

function _renderMessage(msg) {
  const isUser = msg.role === 'user';
  const time   = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="conv-msg conv-msg--${isUser ? 'user' : 'nova'}">
      ${!isUser ? '<div class="conv-avatar" aria-hidden="true">◎</div>' : ''}
      <div class="conv-body">
        <div class="conv-bubble">${_formatText(msg.text)}</div>
        <div class="conv-ts">${time}</div>
      </div>
    </div>`;
}

function _formatText(raw) {
  return raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// ── Helpers ───────────────────────────────────────────────────

function _addMessage(role, text) {
  _messages.push({ role, text, ts: Date.now() });
  if (_messages.length > MAX_HISTORY) _messages.shift();
}

function _saveHistory() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_messages)); } catch {}
}

function _renderIfOpen() {
  if (State.get('activeView') === 'chat' && State.get('panelOpen')) {
    renderConversationPanel();
  }
}

function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
