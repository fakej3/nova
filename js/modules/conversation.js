/**
 * NOVA Conversation System v3
 *
 * New in v3:
 *   Feature 1 — Daily briefing: auto-generated on first open each day, injected as
 *               the first NOVA message, powered by Gemini or a local data-aware builder.
 *   Feature 2 — Semantic memory retrieval: before every Gemini call, keywords are
 *               extracted from the user's message and matched against all stored memories.
 *               The most relevant (highest keyword-overlap score) are sent, not just the
 *               most recent. Falls back to recent when no keywords match.
 *   Feature 3 — Session memory: when the user navigates away from chat (VIEW_CHANGED
 *               to anything other than 'chat'), the session is summarized and stored as
 *               a 'session_summary' memory. Future system prompts include recent summaries
 *               so NOVA can reference previous conversations.
 *
 * Routes messages through:
 *   1. Local fast intents (clear, time, date, note:, task:)
 *   2. Gemini API when key is configured
 *   3. Local data-aware fallback (no key / offline)
 *
 * Gemini responses may contain action markers parsed silently before display:
 *   [SAVE_MEMORY: "content"]
 *   [CREATE_TASK: "title"]
 *   [CREATE_NOTE: "title | content"]
 *   [COMPLETE_TASK: "title substring or id"]
 */

import { DB }                     from '../core/db.js';
import { Bus, EVENTS }            from '../core/bus.js';
import { State }                  from '../core/state.js';
import { setOrbState }            from '../ui/orb.js';
import { showToast }              from '../ui/toast.js';
import { logEvent, EVENT_TYPES }  from '../services/events.js';
import { callGemini, hasGeminiKey } from '../services/gemini.js';

const MAX_HISTORY      = 100;
const LS_KEY           = 'nova_conversation';
const LS_SESSION_INDEX = 'nova_session_msg_index';
const LS_BRIEFING_DATE = 'nova_briefing_date';

let _messages         = [];
let _busy             = false;
let _summarizing      = false;
let _lastSummaryIndex = 0;

// ── Stop words (Feature 2) ────────────────────────────────────

const STOP_WORDS = new Set([
  'i','me','my','myself','we','our','ours','you','your','yours','he','him',
  'his','she','her','hers','it','its','they','them','their','what','which',
  'who','whom','this','that','these','those','am','is','are','was','were',
  'be','been','being','have','has','had','do','does','did','will','would',
  'could','should','may','might','can','a','an','the','and','but','if','or',
  'as','of','at','by','for','with','about','in','out','on','off','to','from',
  'up','down','not','no','so','than','too','just','now','also','very','how',
  'when','where','why','then','here','there','all','any','some','more','most',
  've','re','ll','d','s','t','m',
]);

// ── Public API ────────────────────────────────────────────────

export function initConversation() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _messages = JSON.parse(raw).slice(-MAX_HISTORY);
  } catch { _messages = []; }

  try {
    const idx = localStorage.getItem(LS_SESSION_INDEX);
    _lastSummaryIndex = idx ? parseInt(idx, 10) : 0;
    // Guard against stale index (e.g. after MAX_HISTORY trim)
    if (_lastSummaryIndex > _messages.length) {
      _lastSummaryIndex = Math.max(0, _messages.length - 5);
    }
  } catch { _lastSummaryIndex = 0; }

  // Feature 3: when user navigates away from chat, summarise the session
  Bus.on(EVENTS.VIEW_CHANGED, ({ view } = {}) => {
    if (view !== 'chat') {
      _maybeGenerateSessionSummary().catch(e =>
        console.warn('[Session] Summary error:', e.message)
      );
    }
  });
}

export function isBusy() { return _busy; }

export function clearConversation() {
  _messages         = [];
  _lastSummaryIndex = 0;
  _saveHistory();
  try { localStorage.removeItem(LS_SESSION_INDEX); } catch {}
}

// ── Feature 1: Daily Briefing ─────────────────────────────────

export async function generateDailyBriefing() {
  const today    = new Date().toDateString();
  const lastDate = localStorage.getItem(LS_BRIEFING_DATE);
  if (lastDate === today) return;

  try {
    const [allTasks, recentMems] = await Promise.all([
      DB.tasks.getAll(),
      DB.memories.getRecent(12),
    ]);

    const pending      = allTasks.filter(t => t.status === 'pending');
    const todayStart   = new Date(); todayStart.setHours(0, 0, 0, 0);
    const overdue      = pending.filter(t => t.dueDate && new Date(t.dueDate) < todayStart);
    const dueToday     = pending.filter(t => {
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate); d.setHours(0, 0, 0, 0);
      return d.getTime() === todayStart.getTime();
    });

    setOrbState('thinking');

    const briefing = hasGeminiKey()
      ? await _geminiDailyBriefing(pending, overdue, dueToday, recentMems)
      : _localDailyBriefing(pending, overdue, dueToday, recentMems);

    if (!briefing) { setOrbState('idle'); return; }

    _addMessage('nova', briefing);
    _saveHistory();
    localStorage.setItem(LS_BRIEFING_DATE, today);

    setOrbState('responding');
    Bus.emit(EVENTS.REQUEST_SWITCH_VIEW, { view: 'chat' });
    _renderIfOpen();

    await _delay(600);
    setOrbState('success');

  } catch (e) {
    console.warn('[Briefing] Failed:', e.message);
    setOrbState('idle');
  }
}

async function _geminiDailyBriefing(pending, overdue, dueToday, allMems) {
  const userName = State.get('userName') || '';
  const dateStr  = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const timeStr  = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const taskLines = pending.length
    ? pending.slice(0, 8).map(t => {
        const pri  = t.priority === 1 ? 'HIGH' : t.priority === 3 ? 'LOW' : 'MED';
        const due  = t.dueDate
          ? ` (due ${new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
          : '';
        const flag = overdue.includes(t) ? ' [OVERDUE]' : dueToday.includes(t) ? ' [DUE TODAY]' : '';
        return `• [${pri}]${flag} ${t.title}${due}`;
      }).join('\n')
    : 'No pending tasks.';

  const facts = allMems.filter(m => m.type !== 'session_summary').slice(0, 5);
  const memLines = facts.length
    ? facts.map(m => `• ${m.content.slice(0, 100)}`).join('\n')
    : 'None.';

  const sessions = await _getSessionSummaries(2);
  const sessionLines = sessions.length
    ? sessions.map(s => `• ${s.content.slice(0, 150)}`).join('\n')
    : 'No previous sessions on record.';

  const sysPrompt = `You are NOVA, a warm personal AI assistant. Write a morning briefing. Be concise (under 100 words), specific to the user's actual data, and conversational. Do NOT include action markers like [SAVE_MEMORY:...]. Do NOT use a heading like "Here is your briefing:". Speak naturally. End with one engaging question.`;

  const userPrompt = `Generate my morning briefing.

Today: ${dateStr} at ${timeStr}${userName ? `\nMy name: ${userName}` : ''}

Tasks (${pending.length} pending, ${overdue.length} overdue, ${dueToday.length} due today):
${taskLines}

Things I've mentioned recently:
${memLines}

What we discussed previously:
${sessionLines}`;

  const raw = await callGemini([{ role: 'user', text: userPrompt }], sysPrompt);
  return raw.replace(ACTION_RE, '').trim();
}

function _localDailyBriefing(pending, overdue, dueToday, allMems) {
  const userName = State.get('userName') || '';
  const hour     = new Date().getHours();
  const timeWord = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const greeting = userName ? `Good ${timeWord}, ${userName}.` : `Good ${timeWord}.`;

  const lines = [greeting, ''];

  if (!pending.length) {
    lines.push('Your task list is clear — a fresh start.');
  } else {
    lines.push(`You have ${pending.length} active task${pending.length !== 1 ? 's' : ''}.`);
    if (overdue.length) {
      const names = overdue.slice(0, 2).map(t => `"${t.title}"`).join(', ');
      lines.push(`${overdue.length} task${overdue.length !== 1 ? 's are' : ' is'} overdue: ${names}.`);
    }
    if (dueToday.length) {
      const names = dueToday.map(t => `"${t.title}"`).join(', ');
      lines.push(`Due today: ${names}.`);
    }
    const top = [...pending].sort((a, b) => a.priority - b.priority)[0];
    if (top) lines.push(`\nHighest priority: "${top.title}".`);
  }

  const facts = allMems.filter(m => m.type !== 'session_summary').slice(0, 2);
  if (facts.length) {
    lines.push(`\nRecently noted: ${facts.map(m => m.content.slice(0, 70)).join('; ')}.`);
  }

  lines.push('\nWhat do you want to focus on today?');
  return lines.join('\n');
}

// ── Feature 2: Semantic Memory Retrieval ──────────────────────

function _extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

async function _getRelevantMemories(userMessage, limit = 6) {
  const keywords = _extractKeywords(userMessage);

  if (!keywords.length) {
    console.debug('[Memory] No keywords extracted — using recent');
    return DB.memories.getRecent(limit);
  }

  const all   = await DB.memories.getAll();
  const facts = all.filter(m => m.type !== 'session_summary');
  if (!facts.length) return [];

  const scored = facts.map(m => {
    const haystack = (m.content + ' ' + (m.tags || []).join(' ')).toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (haystack.includes(kw)) score++;
    }
    return { memory: m, score };
  });

  const relevant = scored.filter(s => s.score > 0);

  // Debug logging for relevance verification
  console.debug(`[Memory] Query: "${userMessage.slice(0, 60)}"`);
  console.debug(`[Memory] Keywords: [${keywords.join(', ')}]`);
  console.debug(`[Memory] ${relevant.length} match(es) from ${facts.length} stored:`);
  relevant.slice(0, 5).forEach(s =>
    console.debug(`  [score:${s.score}] ${s.memory.content.slice(0, 70)}`)
  );
  if (!relevant.length) console.debug('[Memory] No matches — falling back to recent');

  if (!relevant.length) return DB.memories.getRecent(limit);

  return relevant
    .sort((a, b) =>
      b.score - a.score ||
      (b.memory.updatedAt > a.memory.updatedAt ? 1 : -1)
    )
    .slice(0, limit)
    .map(s => s.memory);
}

// ── Feature 3: Session Memory ─────────────────────────────────

async function _getSessionSummaries(limit = 3) {
  try {
    const all = await DB.memories.getByType('session_summary');
    return all
      .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
      .slice(0, limit);
  } catch { return []; }
}

async function _maybeGenerateSessionSummary() {
  if (_busy || _summarizing) return;

  const sessionMsgs   = _messages.slice(_lastSummaryIndex);
  const userExchanges = sessionMsgs.filter(m => m.role === 'user').length;
  if (userExchanges < 3) return;

  _summarizing = true;
  try {
    if (hasGeminiKey()) {
      await _geminiSessionSummary(sessionMsgs);
    } else {
      await _localSessionSummary(sessionMsgs);
    }
    _lastSummaryIndex = _messages.length;
    try { localStorage.setItem(LS_SESSION_INDEX, String(_lastSummaryIndex)); } catch {}
  } catch (e) {
    console.warn('[Session] Failed:', e.message);
  } finally {
    _summarizing = false;
  }
}

async function _geminiSessionSummary(messages) {
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'User' : 'NOVA'}: ${m.text.slice(0, 100)}`)
    .join('\n');

  const prompt = `Summarize this conversation in 2-3 sentences. Focus on: goals or intentions mentioned, worries or concerns, commitments made, important personal facts shared. Be specific — use the actual topics and names, not vague descriptions. Do NOT include action markers.

Conversation:
${transcript}`;

  const raw = await callGemini(
    [{ role: 'user', text: prompt }],
    'You are a concise conversation summarizer. Return only the summary text. No preamble. No action markers.'
  );

  const summary = raw.replace(ACTION_RE, '').trim().slice(0, 500);
  if (!summary) return;

  await DB.memories.create({
    type: 'session_summary', content: summary, source: 'ai', tags: ['session'],
  });
  console.log('[Session] Summary saved:', summary.slice(0, 80) + (summary.length > 80 ? '…' : ''));
}

async function _localSessionSummary(messages) {
  const userMsgs = messages.filter(m => m.role === 'user').map(m => m.text);
  if (!userMsgs.length) return;
  const topics  = userMsgs.slice(0, 4).map(t => `"${t.slice(0, 60)}"`).join(', ');
  const summary = `Session: User discussed ${topics}.`;
  await DB.memories.create({
    type: 'session_summary', content: summary, source: 'local', tags: ['session'],
  });
  console.log('[Session] Local summary saved');
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

    const local = await _tryLocalIntent(text);

    if (local !== null) {
      response = local;
    } else if (hasGeminiKey()) {
      const context      = await _buildContext(text); // pass message for semantic retrieval
      const systemPrompt = _buildSystemPrompt(context);
      const history      = _messages.slice(-24);
      const raw          = await callGemini(history, systemPrompt);
      response           = await _parseActions(raw);
    } else {
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
    if      (err.message === 'NO_KEY')         errMsg = 'No AI key configured. Go to Settings → Gemini API Key to enable real AI responses.';
    else if (err.message === 'INVALID_KEY')    errMsg = 'Invalid Gemini API key. Check Settings → Gemini API Key.';
    else if (err.message === 'RATE_LIMIT')     errMsg = 'Rate limit reached. Wait a moment and try again.';
    else if (err.message === 'EMPTY_RESPONSE') errMsg = 'Gemini returned an empty response. Please try again.';
    else                                        errMsg = 'Something went wrong. Please try again.';

    _addMessage('nova', errMsg);
    _saveHistory();
    _renderIfOpen();
    setOrbState('error');
  } finally {
    _busy = false;
  }
}

// ── Local intent router ───────────────────────────────────────
// Returns a string if handled locally, null to fall through to Gemini.

async function _tryLocalIntent(text) {
  const q = text.toLowerCase().trim();

  if (/^(clear|reset|new chat|start over)$/.test(q)) {
    _messages = _messages.slice(-1);
    _saveHistory();
    return 'Conversation cleared.';
  }

  if (/^(what time is it|what('s| is) the time|current time|time)$/.test(q)) {
    return `It's ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
  }

  if (/^(what('s| is) (today|the date)|today's date|date)$/.test(q)) {
    return `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
  }

  const noteCmd = text.match(/^note:\s+(.+)/i);
  if (noteCmd) return _createNote(noteCmd[1].trim());

  const taskCmd = text.match(/^task:\s+(.+)/i);
  if (taskCmd) return _createTask(taskCmd[1].trim());

  return null;
}

// ── Context builder (now accepts user message for Feature 2) ──

async function _buildContext(userMessage = '') {
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

    // Feature 2: relevance-ranked memories based on this message
    const relevantMems = await _getRelevantMemories(userMessage, 6);

    // Feature 3: recent session summaries for continuity context
    const sessionSummaries = await _getSessionSummaries(2);

    return { recentNotes, recentPending, completed, memCount, allNotes, relevantMems, sessionSummaries };
  } catch {
    return { recentNotes: [], recentPending: [], completed: [], memCount: 0, allNotes: [], relevantMems: [], sessionSummaries: [] };
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
        const due = t.dueDate
          ? ` · due ${new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : '';
        return `• [ID:${t.id}] "${t.title}" (${p}${due})`;
      }).join('\n')
    : 'No pending tasks.';

  const memsSummary = ctx.relevantMems.length
    ? ctx.relevantMems.map(m => `• ${m.content.slice(0, 80)}`).join('\n')
    : 'None yet.';

  const sessionCtx = ctx.sessionSummaries.length
    ? ctx.sessionSummaries.map(s => `• ${s.content.slice(0, 150)}`).join('\n')
    : 'No previous sessions on record.';

  return `You are ${aiName}, a personal AI operating system assistant. You are concise, intelligent, and warm.

${userName ? `User's name: ${userName}` : ''}
Current time: ${timeStr}
Current date: ${dateStr}

== PREVIOUS SESSIONS ==
Use these to reference what you've discussed before. If relevant, say "last time you mentioned…" naturally.
${sessionCtx}

== USER'S DATA ==

Notes (${ctx.allNotes.length} total, showing recent):
${notesSummary}

Pending tasks (${ctx.recentPending.length} shown):
${tasksSummary}

Completed tasks: ${ctx.completed.length}
Saved memories: ${ctx.memCount}

Relevant memories (ranked by match to this conversation — not just the most recent):
${memsSummary}

== BEHAVIORAL RULES ==

1. Keep responses concise — under 120 words unless the user asks for detail.
2. Be warm but efficient. This is a personal OS, not a chatbot.
3. Reference the user's actual data when relevant.
4. Never invent data that isn't in the context above.
5. If the previous sessions section is relevant to what the user said, reference it naturally.

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
    try { await _executeAction(action.type, action.value); }
    catch (e) { console.warn('[Conversation] Action failed:', action.type, e); }
  }

  return clean;
}

async function _executeAction(type, value) {
  switch (type) {
    case 'SAVE_MEMORY': {
      const id = await DB.memories.create({
        type: 'ai_fact', content: value, source: 'ai', tags: [],
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
      const allTasks = await DB.tasks.getAll();
      const target   = allTasks.find(t =>
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

  if (/\b(help|what can you|commands|capabilities)\b/.test(q)) return _helpText();
  if (/\b(notes?|my notes?|show notes?|list notes?)\b/.test(q)) return _notesResponse();
  if (/\b(tasks?|todos?|pending|to-?do|show tasks?|list tasks?)\b/.test(q)) return _tasksResponse();
  if (/\b(memor(y|ies)|what.*remember|recall|what.*know)\b/.test(q)) return _memoriesResponse();

  const searchMatch = q.match(/\b(?:search|find|look for)\b\s+(.+)/);
  if (searchMatch) return _searchResponse(searchMatch[1].trim());

  if (/\b(summary|overview|status|how many|count)\b/.test(q)) return _statusResponse();

  const noteMatch = q.match(/^(?:remember|save|add note|create note|note this)[:\-—]?\s+(.+)/i);
  if (noteMatch) return _createNote(noteMatch[1].trim());

  const taskMatch = q.match(/^(?:todo|add task|create task|remind me to)[:\-—]?\s+(.+)/i);
  if (taskMatch) return _createTask(taskMatch[1].trim());

  const name = State.get('userName');
  const prefix = name ? `${name}, ` : '';
  return `${prefix}I can answer that better with a Gemini API key. Go to Settings → Gemini API Key to enable real AI. Until then, try: "show my notes", "pending tasks", "give me a summary", or "help".`;
}

// ── Local response builders ───────────────────────────────────

function _helpText() {
  return hasGeminiKey()
    ? [
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
      ].join('\n')
    : [
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
    if (!all.length) return 'No notes yet. Say "note: [text]" to create one.';
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
    if (!all.length) return 'No tasks yet. Say "task: [description]" to add one.';
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
    const all   = await DB.memories.getAll();
    const facts = all.filter(m => m.type !== 'session_summary');
    if (!facts.length) return "No memories yet. They're saved when you share personal facts — try telling me something important.";
    const recent = [...facts].sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1)).slice(0, 4);
    const lines  = [`${facts.length} memor${facts.length !== 1 ? 'ies' : 'y'} stored:`];
    recent.forEach(m => lines.push(`• ${m.content.slice(0, 90)}${m.content.length > 90 ? '…' : ''}`));
    if (facts.length > 4) lines.push(`…and ${facts.length - 4} more in the Memories panel.`);
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
    const lines   = ['System status:'];
    lines.push(`• ${noteCount} note${noteCount !== 1 ? 's' : ''}`);
    lines.push(`• ${pending.length} pending task${pending.length !== 1 ? 's' : ''}`);
    lines.push(`• ${memCount} memor${memCount !== 1 ? 'ies' : 'y'}`);
    if (pending.length) {
      const top = [...pending].sort((a, b) => a.priority - b.priority)[0];
      lines.push(`Next: "${top.title || 'Untitled'}"`);
    }
    lines.push(`• AI: ${hasGeminiKey() ? 'Gemini connected' : 'No key — see Settings'}`);
    return lines.join('\n');
  } catch { return "I couldn't get a summary right now."; }
}

async function _createNote(content) {
  try {
    const title = content.slice(0, 60);
    const id    = await DB.notes.create({ title, content });
    Bus.emit(EVENTS.NOTE_CREATED, { id, title });
    await logEvent(EVENT_TYPES.NOTE_CREATED, `Note: ${title}`);
    showToast('◇ Note saved', 'success', 2000);
    return `Note saved: "${title}${content.length > 60 ? '…' : ''}". Find it in the Notes panel.`;
  } catch { return "I couldn't create that note. Try the Notes panel."; }
}

async function _createTask(content) {
  try {
    const title = content.slice(0, 80);
    const id    = await DB.tasks.create({ title });
    Bus.emit(EVENTS.TASK_CREATED, { id, title });
    await logEvent(EVENT_TYPES.TASK_CREATED, `Task: ${title}`);
    showToast('◉ Task added', 'success', 2000);
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
