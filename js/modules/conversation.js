/**
 * NOVA Conversation System
 *
 * Mock AI responses backed by real local data (notes, tasks, memories).
 * Each response reads from IndexedDB so answers are accurate.
 * Conversation history persists to localStorage across sessions.
 */

import { DB }          from '../core/db.js';
import { Bus, EVENTS } from '../core/bus.js';
import { State }       from '../core/state.js';
import { setOrbState } from '../ui/orb.js';

const MAX_HISTORY = 100;
const LS_KEY      = 'nova_conversation';

let _messages = [];  // { role: 'user'|'nova', text: string, ts: number }
let _busy     = false;

// ── Init ──────────────────────────────────────────────────────

export function initConversation() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _messages = JSON.parse(raw).slice(-MAX_HISTORY);
  } catch { _messages = []; }
}

// ── Handle user input ─────────────────────────────────────────

export async function handleUserMessage(rawText) {
  const text = rawText.trim();
  if (!text || _busy) return;
  _busy = true;

  _addMessage('user', text);
  _saveHistory();

  // Open conversation panel immediately so the user sees their message
  Bus.emit(EVENTS.REQUEST_SWITCH_VIEW, { view: 'chat' });
  _renderIfOpen();

  setOrbState('thinking');

  try {
    await _delay(800 + Math.random() * 700);
    const response = await _respond(text);
    setOrbState('responding');
    _addMessage('nova', response);
    _saveHistory();
    _renderIfOpen();
    await _delay(600);
    setOrbState('success');
  } catch (err) {
    console.error('[Conversation]', err);
    _addMessage('nova', 'Something went wrong. Please try again.');
    _saveHistory();
    _renderIfOpen();
    setOrbState('error');
  } finally {
    _busy = false;
  }
}

export function clearConversation() {
  _messages = [];
  _saveHistory();
}

// ── Intent routing ────────────────────────────────────────────

async function _respond(text) {
  const q = text.toLowerCase().trim();

  // Clear conversation
  if (/^(clear|reset|new chat|start over)$/.test(q)) {
    _messages = _messages.slice(-1); // keep the user message we just added
    _saveHistory();
    return 'Conversation cleared.';
  }

  // Greeting
  if (/^(hi|hello|hey|howdy|sup|good (morning|afternoon|evening))/.test(q)) {
    const name = State.get('userName');
    return name
      ? `Hello, ${name}! Ready to help. Ask me about your notes, tasks, or memories — or say "help" to see what I can do.`
      : 'Hello! Ready to help. Ask me about your notes, tasks, or memories — or say "help" to see what I can do.';
  }

  // Help
  if (/\b(help|what can you|what do you do|capabilities|commands)\b/.test(q)) {
    return _helpText();
  }

  // Time
  if (/\b(time|what time|current time)\b/.test(q) && !/timeline/.test(q)) {
    return `It's ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
  }

  // Date
  if (/\b(date|today|what day|what's today)\b/.test(q)) {
    return `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
  }

  // Create note
  const noteMatch = q.match(/^(?:note|remember|save|add note|create note|note this|remember this)[:\-—]?\s+(.+)/i);
  if (noteMatch) return _createNote(noteMatch[1].trim());

  // Create task
  const taskMatch = q.match(/^(?:task|todo|add task|create task|remind me to)[:\-—]?\s+(.+)/i);
  if (taskMatch) return _createTask(taskMatch[1].trim());

  // Notes queries
  if (/\b(notes?|my notes?|show notes?|list notes?|all notes?)\b/.test(q)) {
    return _notesResponse();
  }

  // Tasks queries
  if (/\b(tasks?|todos?|pending|to-?do|show tasks?|list tasks?|overdue|what.*left)\b/.test(q)) {
    return _tasksResponse();
  }

  // Memory queries
  if (/\b(memor(y|ies)|what.*remember|recall|what.*know|what.*stored)\b/.test(q)) {
    return _memoriesResponse();
  }

  // Search
  const searchMatch = q.match(/\b(?:search|find|look for|where is)\b\s+(.+)/);
  if (searchMatch) return _searchResponse(searchMatch[1].trim());

  // Count / overview
  if (/\b(how many|count|summary|overview|status|what.*have)\b/.test(q)) {
    return _statusResponse();
  }

  return _fallback(text);
}

// ── Response builders ─────────────────────────────────────────

function _helpText() {
  return [
    "Here's what I can do right now:",
    '',
    '**show my notes** — list your notes',
    '**pending tasks** — see what needs doing',
    '**what do you remember** — browse your memory store',
    '**find [keyword]** — search across everything',
    '**give me a summary** — notes + tasks + memory count',
    '**note: [text]** — create a note quickly',
    '**task: [text]** — add a task',
    '**what time is it** — current time',
    '',
    'You can also use the panels on the left to manage notes, tasks, and memories directly.',
  ].join('\n');
}

async function _notesResponse() {
  try {
    const all = await DB.notes.getAll();
    if (!all.length) {
      return "You don't have any notes yet. Say \"note: [your text]\" to create one, or open the Notes panel on the left.";
    }
    const pinned = all.filter(n => n.pinned);
    const recent = [...all]
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
      .slice(0, 5);
    const lines = [`You have ${all.length} note${all.length !== 1 ? 's' : ''}.`];
    if (pinned.length) {
      lines.push(`Pinned: ${pinned.map(n => `"${n.title || 'Untitled'}"`).join(', ')}.`);
    }
    if (recent.length) {
      lines.push(`Recent: ${recent.map(n => `"${n.title || 'Untitled'}"`).join(', ')}.`);
    }
    lines.push('Open the Notes panel to read or edit them.');
    return lines.join('\n');
  } catch {
    return "I couldn't read your notes right now.";
  }
}

async function _tasksResponse() {
  try {
    const [pending, all] = await Promise.all([
      DB.tasks.getByStatus('pending'),
      DB.tasks.getAll(),
    ]);
    const completed = all.filter(t => t.status === 'completed');

    if (!all.length) {
      return "No tasks yet. Say \"task: [description]\" to add one, or open the Tasks panel.";
    }

    const lines = [];
    if (pending.length) {
      const sorted = [...pending].sort((a, b) => a.priority - b.priority);
      lines.push(`${pending.length} pending task${pending.length !== 1 ? 's' : ''}:`);
      sorted.slice(0, 5).forEach(t => {
        const p   = t.priority === 1 ? 'High' : t.priority === 3 ? 'Low' : 'Med';
        const due = t.dueDate
          ? ` · due ${new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : '';
        lines.push(`• ${t.title || 'Untitled'} (${p}${due})`);
      });
      if (pending.length > 5) lines.push(`…and ${pending.length - 5} more.`);
    } else {
      lines.push('No pending tasks — all clear!');
    }
    if (completed.length) {
      lines.push(`${completed.length} completed task${completed.length !== 1 ? 's' : ''} total.`);
    }
    return lines.join('\n');
  } catch {
    return "I couldn't read your tasks right now.";
  }
}

async function _memoriesResponse() {
  try {
    const all = await DB.memories.getAll();
    if (!all.length) {
      return "I don't have any memories yet. Memories are created automatically from your notes and tasks. Create a note and it will appear here.";
    }
    const recent = [...all]
      .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
      .slice(0, 3);
    const lines = [
      `I have ${all.length} memor${all.length !== 1 ? 'ies' : 'y'} stored.`,
      'Recent:',
      ...recent.map(m => `• ${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}`),
    ];
    lines.push('Open the Memory Center to browse all of them.');
    return lines.join('\n');
  } catch {
    return "I couldn't access the memory store right now.";
  }
}

async function _searchResponse(term) {
  try {
    const [notes, tasks, mems] = await Promise.all([
      DB.notes.search(term, 3),
      DB.tasks.getAll().then(all =>
        all.filter(t =>
          t.title.toLowerCase().includes(term.toLowerCase()) ||
          (t.description || '').toLowerCase().includes(term.toLowerCase())
        ).slice(0, 3)
      ),
      DB.memories.search(term, 3),
    ]);
    const total = notes.length + tasks.length + mems.length;
    if (!total) {
      return `Nothing found for "${term}". Try a different keyword, or use the Search panel (⌘K).`;
    }
    const lines = [`Found ${total} result${total !== 1 ? 's' : ''} for "${term}":`];
    if (notes.length) lines.push(`Notes: ${notes.map(n => `"${n.title || 'Untitled'}"`).join(', ')}`);
    if (tasks.length) lines.push(`Tasks: ${tasks.map(t => `"${t.title || 'Untitled'}"`).join(', ')}`);
    if (mems.length)  lines.push(`Memories: ${mems.map(m => `"${m.content.slice(0, 40)}…"`).join(', ')}`);
    return lines.join('\n');
  } catch {
    return `Search failed for "${term}". Try the Search panel (⌘K).`;
  }
}

async function _statusResponse() {
  try {
    const [noteCount, pending, memCount] = await Promise.all([
      DB.notes.count(),
      DB.tasks.getByStatus('pending'),
      DB.memories.count(),
    ]);
    const lines = ["Here's where things stand:"];
    lines.push(`• ${noteCount} note${noteCount !== 1 ? 's' : ''} saved`);
    lines.push(`• ${pending.length} task${pending.length !== 1 ? 's' : ''} pending`);
    lines.push(`• ${memCount} memor${memCount !== 1 ? 'ies' : 'y'} stored`);
    if (pending.length > 0) {
      const top = [...pending].sort((a, b) => a.priority - b.priority)[0];
      const p   = top.priority === 1 ? 'High' : top.priority === 3 ? 'Low' : 'Med';
      lines.push(`Next up: "${top.title || 'Untitled'}" (${p} priority)`);
    }
    return lines.join('\n');
  } catch {
    return "I couldn't retrieve a summary right now.";
  }
}

async function _createNote(content) {
  try {
    const id = await DB.notes.create({ title: content.slice(0, 60), content });
    Bus.emit(EVENTS.NOTE_CREATED, { id });
    return `Note created: "${content.slice(0, 60)}${content.length > 60 ? '…' : ''}". You'll find it in the Notes panel.`;
  } catch {
    return "I couldn't create that note. Try the Notes panel directly.";
  }
}

async function _createTask(content) {
  try {
    const id = await DB.tasks.create({ title: content.slice(0, 80), description: '' });
    Bus.emit(EVENTS.TASK_CREATED, { id });
    return `Task added: "${content.slice(0, 80)}${content.length > 80 ? '…' : ''}". Find it in the Tasks panel.`;
  } catch {
    return "I couldn't create that task. Try the Tasks panel directly.";
  }
}

function _fallback(text) {
  const suggestions = [
    '"show my notes"',
    '"pending tasks"',
    '"give me a summary"',
    '"what do you remember"',
  ];
  const pick = suggestions[Math.floor(Date.now() / 10000) % suggestions.length];
  return `I don't have a live AI connection yet, but I understand your data. Try asking ${pick} — or say "help" to see everything I can do.`;
}

// ── Panel renderer ────────────────────────────────────────────

export function renderConversationPanel() {
  const content = document.getElementById('panel-content');
  if (!content) return;

  if (!_messages.length) {
    content.innerHTML = `
      <div class="conv-empty">
        <div class="conv-empty-icon">◎</div>
        <p class="conv-empty-title">Ask me anything</p>
        <p class="conv-empty-desc">I can summarize your notes, list pending tasks, recall memories, and more.</p>
        <div class="conv-suggestions">
          <button class="conv-suggest" data-q="show my notes">Show my notes</button>
          <button class="conv-suggest" data-q="pending tasks">Pending tasks</button>
          <button class="conv-suggest" data-q="give me a summary">Give me a summary</button>
          <button class="conv-suggest" data-q="help">What can you do?</button>
        </div>
      </div>`;
    content.querySelectorAll('.conv-suggest').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('nova-input');
        if (input) {
          input.value = btn.dataset.q;
          input.focus();
        }
      });
    });
    return;
  }

  const html = _messages.map(_renderMessage).join('');
  content.innerHTML = `<div class="conv-list">${html}</div>`;
  // Scroll to bottom
  requestAnimationFrame(() => { content.scrollTop = content.scrollHeight; });
}

function _renderMessage(msg) {
  const isUser = msg.role === 'user';
  const time   = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text   = _formatText(msg.text);
  return `
    <div class="conv-msg conv-msg--${msg.role}">
      ${!isUser ? '<div class="conv-avatar" aria-hidden="true">◎</div>' : ''}
      <div class="conv-body">
        <div class="conv-bubble">${text}</div>
        <div class="conv-ts">${time}</div>
      </div>
    </div>`;
}

function _formatText(raw) {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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
