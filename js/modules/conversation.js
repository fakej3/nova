/**
 * NOVA Conversation System v4
 *
 * v4 — Response engine upgrade:
 *   - Full NOVA persona: direct, aware, personal — not a generic AI assistant
 *   - Offline intelligence: task analysis, memory patterns, priorities, recommendations
 *   - Context awareness: time of day, overdue tasks, streak, recurring topics
 *   - Natural continuity language: "Last week you mentioned…" not "I found in memory…"
 *   - Rich Gemini system prompt with progress + pattern data
 *
 * Message routing (unchanged):
 *   1. Local fast intents  (clear, time, date, note:, task:)
 *   2. Gemini API          (when key configured)
 *   3. Offline intelligence (no key / offline)
 *
 * Action markers (Gemini only):
 *   [SAVE_MEMORY: "…"]  [CREATE_TASK: "…"]
 *   [CREATE_NOTE: "title | content"]  [COMPLETE_TASK: "id or title"]
 */

import { DB }                       from '../core/db.js';
import { Bus, EVENTS }              from '../core/bus.js';
import { State }                    from '../core/state.js';
import { setOrbState }              from '../ui/orb.js';
import { showToast }                from '../ui/toast.js';
import { logEvent, EVENT_TYPES }    from '../services/events.js';
import { callGemini, hasGeminiKey } from '../services/gemini.js';

const MAX_HISTORY      = 100;
const LS_KEY           = 'nova_conversation';
const LS_SESSION_INDEX = 'nova_session_msg_index';
const LS_BRIEFING_DATE = 'nova_briefing_date';

let _messages         = [];
let _busy             = false;
let _summarizing      = false;
let _lastSummaryIndex = 0;

// ── Keyword stop-words ────────────────────────────────────────

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
    if (_lastSummaryIndex > _messages.length) {
      _lastSummaryIndex = Math.max(0, _messages.length - 5);
    }
  } catch { _lastSummaryIndex = 0; }

  Bus.on(EVENTS.VIEW_CHANGED, ({ view } = {}) => {
    if (view !== 'chat') {
      _maybeGenerateSessionSummary().catch(e =>
        console.warn('[Session]', e.message)
      );
    }
  });
}

export function isBusy()  { return _busy; }

export function clearConversation() {
  _messages         = [];
  _lastSummaryIndex = 0;
  _saveHistory();
  try { localStorage.removeItem(LS_SESSION_INDEX); } catch {}
}

// ── Utility: time + relative language ────────────────────────

function _timeContext() {
  const h = new Date().getHours();
  if (h < 6)  return 'late night';
  if (h < 12) return 'morning';
  if (h < 14) return 'midday';
  if (h < 18) return 'afternoon';
  if (h < 22) return 'evening';
  return 'late night';
}

function _relativeTime(isoStr) {
  if (!isoStr) return 'recently';
  const diff = Date.now() - new Date(isoStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (diff < 3600000)  return 'earlier today';
  if (days === 0)      return 'earlier today';
  if (days === 1)      return 'yesterday';
  if (days < 7)        return `${days} days ago`;
  if (days < 14)       return 'last week';
  if (days < 30)       return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function _taskAge(task) {
  const days = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 86400000);
  if (days === 0) return 'added today';
  if (days === 1) return '1 day old';
  return `${days} days old`;
}

// ── Utility: pattern detection ────────────────────────────────

function _detectRecurringTopics(memories, minCount = 2) {
  const freq    = {};
  const lastTs  = {};
  const skip    = new Set([
    'the','and','for','that','this','with','have','from','about','been',
    'they','will','your','what','when','user','nova','just','also','more',
    'some','into','than','then','were','said','like','even','well','back',
    'would','could','should','task','note','memory','mentioned','session',
  ]);

  for (const m of memories) {
    if (m.type === 'session_summary') continue;
    const words = m.content.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !skip.has(w));

    for (const w of new Set(words)) {
      freq[w]   = (freq[w]   || 0) + 1;
      if (!lastTs[w] || m.timestamp > lastTs[w]) lastTs[w] = m.timestamp;
    }
  }

  return Object.entries(freq)
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count, lastMentioned: lastTs[topic] }));
}

function _computeStreak(completedTasks) {
  const dates = [...new Set(
    completedTasks
      .filter(t => t.completedAt)
      .map(t => new Date(t.completedAt).toDateString()),
  )].sort((a, b) => new Date(a) - new Date(b));

  if (!dates.length) return 0;

  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const last      = dates[dates.length - 1];
  if (last !== today && last !== yesterday) return 0;

  let streak = 1;
  for (let i = dates.length - 2; i >= 0; i--) {
    const gap = (new Date(dates[i + 1]) - new Date(dates[i])) / 86400000;
    if (gap === 1) streak++;
    else break;
  }
  return streak;
}

// ── Shared data loader (used by offline functions) ────────────

async function _loadUserData() {
  const [allTasks, allNotes, allMems] = await Promise.all([
    DB.tasks.getAll(),
    DB.notes.getAll(),
    DB.memories.getAll(),
  ]);

  const now        = new Date();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekAgo    = new Date(now - 7 * 86400000);

  const pending   = allTasks.filter(t => t.status === 'pending');
  const completed = allTasks.filter(t => t.status === 'completed');
  const overdue   = pending.filter(t => t.dueDate && new Date(t.dueDate) < todayStart);
  const dueToday  = pending.filter(t => {
    if (!t.dueDate) return false;
    const d = new Date(t.dueDate); d.setHours(0, 0, 0, 0);
    return d.getTime() === todayStart.getTime();
  });
  const highPri   = pending.filter(t => t.priority === 1 && !overdue.includes(t));
  const stale     = pending.filter(t =>
    new Date(t.createdAt) < weekAgo && !overdue.includes(t)
  );
  const completedThisWeek = completed.filter(t =>
    t.completedAt && new Date(t.completedAt) > weekAgo
  );
  const completedToday = completed.filter(t =>
    t.completedAt && new Date(t.completedAt) >= todayStart
  );

  const facts    = allMems.filter(m => m.type !== 'session_summary');
  const sessions = allMems
    .filter(m => m.type === 'session_summary')
    .sort((a, b) => b.timestamp > a.timestamp ? 1 : -1)
    .slice(0, 3);

  const recurringTopics = _detectRecurringTopics(facts);
  const streak          = _computeStreak(completed);

  return {
    pending, completed, overdue, dueToday, highPri, stale,
    completedThisWeek, completedToday, allNotes, facts, sessions,
    recurringTopics, streak, now,
  };
}

// ── Feature 1: Daily Briefing ─────────────────────────────────

export async function generateDailyBriefing() {
  const today    = new Date().toDateString();
  const lastDate = localStorage.getItem(LS_BRIEFING_DATE);
  if (lastDate === today) return;

  try {
    const data = await _loadUserData();
    setOrbState('thinking');

    const briefing = hasGeminiKey()
      ? await _geminiDailyBriefing(data)
      : _localDailyBriefing(data);

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
    console.warn('[Briefing]', e.message);
    setOrbState('idle');
  }
}

async function _geminiDailyBriefing(data) {
  const { pending, overdue, dueToday, completedThisWeek, streak,
          facts, sessions, recurringTopics } = data;
  const userName = State.get('userName') || '';
  const dateStr  = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const taskLines = pending.length
    ? pending.slice(0, 8).map(t => {
        const pri  = t.priority === 1 ? 'HIGH' : t.priority === 3 ? 'LOW' : 'MED';
        const due  = t.dueDate
          ? ` (due ${new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
          : '';
        const flag = overdue.includes(t) ? ' [OVERDUE]' : dueToday.includes(t) ? ' [DUE TODAY]' : '';
        return `• [${pri}]${flag} ${t.title}${due} — ${_taskAge(t)}`;
      }).join('\n')
    : 'No pending tasks.';

  const factLines = facts.slice(0, 5).map(m =>
    `• ${m.content.slice(0, 100)} (${_relativeTime(m.timestamp)})`
  ).join('\n') || 'None.';

  const sessionLines = sessions.map(s =>
    `• ${s.content.slice(0, 150)}`
  ).join('\n') || 'No previous sessions.';

  const topicLines = recurringTopics.length
    ? recurringTopics.map(t => `• "${t.topic}" mentioned ${t.count}x (last: ${_relativeTime(t.lastMentioned)})`).join('\n')
    : 'None detected.';

  const progressNote = completedThisWeek.length
    ? `${completedThisWeek.length} tasks completed this week${streak > 1 ? `, ${streak}-day streak` : ''}.`
    : 'No completions this week yet.';

  const sysPrompt = _novaPersonaPrompt();

  const userPrompt = `Generate my morning briefing for ${dateStr}${userName ? `, ${userName}` : ''}.

TASKS (${pending.length} pending, ${overdue.length} overdue, ${dueToday.length} due today):
${taskLines}

PROGRESS: ${progressNote}

RECURRING TOPICS (from memory):
${topicLines}

RECENT FACTS:
${factLines}

PREVIOUS SESSIONS:
${sessionLines}

Rules for this briefing:
- Under 100 words.
- Lead with what's most urgent (overdue > due today > high priority).
- Reference a recurring topic if it's relevant to the tasks.
- End with one specific question or focus prompt.
- Do NOT use action markers.
- Speak as NOVA, not as a generic assistant.`;

  const raw = await callGemini([{ role: 'user', text: userPrompt }], sysPrompt);
  return raw.replace(ACTION_RE, '').trim();
}

function _localDailyBriefing(data) {
  const { pending, overdue, dueToday, highPri, stale,
          completedToday, completedThisWeek, streak,
          facts, sessions, recurringTopics } = data;

  const userName = State.get('userName') || '';
  const tc       = _timeContext();
  const greet    = userName
    ? `Good ${tc}, ${userName}.`
    : `Good ${tc}.`;

  const lines = [greet, ''];

  // Task state
  if (!pending.length) {
    lines.push("No open tasks. The slate is clear.");
  } else {
    if (overdue.length) {
      const names = overdue.slice(0, 2).map(t => `"${t.title}"`).join(', ');
      lines.push(`${overdue.length} overdue: ${names}${overdue.length > 2 ? ` +${overdue.length - 2} more` : ''}.`);
    }
    if (dueToday.length) {
      lines.push(`Due today: ${dueToday.map(t => `"${t.title}"`).join(', ')}.`);
    }
    // Top priority recommendation
    const top = overdue[0] || dueToday[0] || highPri[0] ||
      [...pending].sort((a, b) => a.priority - b.priority)[0];
    if (top) {
      const age = Math.floor((Date.now() - new Date(top.createdAt)) / 86400000);
      lines.push(`\nStart with: "${top.title}"${age > 3 ? ` — ${age} days old` : ''}.`);
    }
  }

  // Progress
  if (completedToday.length) {
    lines.push(`\n${completedToday.length} task${completedToday.length !== 1 ? 's' : ''} already done today.`);
  }
  if (streak > 1) {
    lines.push(`${streak}-day completion streak — keep it going.`);
  }

  // Recurring topics
  if (recurringTopics.length) {
    const top = recurringTopics[0];
    lines.push(`\nYou've been focused on "${top.topic}" lately (${top.count}x in memory).`);
  }

  // Stale tasks callout
  if (stale.length && !overdue.length) {
    lines.push(`${stale.length} task${stale.length !== 1 ? 's have' : ' has'} been sitting untouched for over a week.`);
  }

  // Session context
  if (sessions.length) {
    lines.push(`\nLast session: ${sessions[0].content.slice(0, 100)}${sessions[0].content.length > 100 ? '…' : ''}`);
  }

  lines.push('\nWhat are you working on today?');
  return lines.join('\n');
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
      const context      = await _buildContext(text);
      const systemPrompt = _buildSystemPrompt(context);
      const history      = _messages.slice(-24);
      const raw          = await callGemini(history, systemPrompt);
      response           = await _parseActions(raw);
    } else {
      response = await _offlineResponse(text);
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
    const errMsg =
      err.message === 'NO_KEY'         ? 'No API key configured. Go to Settings → Gemini API Key.' :
      err.message === 'INVALID_KEY'    ? 'Invalid Gemini key. Check Settings → Gemini API Key.' :
      err.message === 'RATE_LIMIT'     ? 'Rate limit hit. Give it a moment.' :
      err.message === 'EMPTY_RESPONSE' ? 'Empty response from Gemini. Try again.' :
                                         'Something went wrong. Try again.';
    _addMessage('nova', errMsg);
    _saveHistory();
    _renderIfOpen();
    setOrbState('error');
  } finally {
    _busy = false;
  }
}

// ── Local intent router ───────────────────────────────────────

async function _tryLocalIntent(text) {
  const q = text.toLowerCase().trim();

  if (/^(clear|reset|new chat|start over)$/.test(q)) {
    _messages = _messages.slice(-1);
    _saveHistory();
    return 'Cleared.';
  }
  if (/^(what time is it|what('s| is) the time|current time|time\??)$/.test(q)) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (/^(what('s| is) (today|the date)|today's date|date\??)$/.test(q)) {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  const noteCmd = text.match(/^note:\s+(.+)/i);
  if (noteCmd) return _createNote(noteCmd[1].trim());

  const taskCmd = text.match(/^task:\s+(.+)/i);
  if (taskCmd) return _createTask(taskCmd[1].trim());

  return null;
}

// ── NOVA Persona (used in Gemini system prompts) ──────────────

function _novaPersonaPrompt() {
  const userName = State.get('userName') || '';
  const aiName   = State.get('aiName')   || 'NOVA';
  const tc       = _timeContext();
  const dateStr  = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const timeStr  = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return `You are ${aiName} — a personal operating system, not a chatbot.
${userName ? `The user's name is ${userName}.` : ''}
Current time: ${timeStr} (${tc}) on ${dateStr}.

VOICE AND STYLE:
- Direct. No filler. No "Certainly!", "Of course!", "Great question!", "As an AI…"
- Confident. You have the user's data. Use it without hedging.
- Personal. Reference their actual tasks, notes, and memories by name.
- Proactive. Surface what matters — don't just answer the literal question.
- Brief. Under 100 words unless asked for detail.
- One or two short paragraphs, or a tight list. Never bullet-dumps.

HOW TO REFERENCE MEMORY AND HISTORY:
- Never say: "I found in your memory…" / "According to your notes…" / "Based on your data…"
- Say instead: "Last week you mentioned…" / "You've been working on this for a few days." / "This keeps coming up — you've noted it three times."
- Use relative time: yesterday, last week, three days ago, earlier this month.

HOW TO HANDLE TASKS:
- Overdue items always get mentioned first.
- When asked for focus or priority, give ONE specific recommendation with a reason.
- Notice task age: a 10-day-old pending task deserves a flag.
- If a task has been mentioned in memories AND is still pending, call that out.

HOW TO HANDLE PATTERNS:
- If a topic appears repeatedly in memory, say so directly.
- Notice unfinished commitments: "You said you'd finish X — still pending."
- Reference streaks positively: "Three days of completions — don't break it."

WHAT TO AVOID:
- Restating the question before answering
- Long preambles before getting to the point
- Saying "I" when you can just state the fact
- Lists when a sentence works better
- Any language that sounds like a help desk or customer support bot`;
}

// ── Context builder for Gemini ────────────────────────────────

async function _buildContext(userMessage = '') {
  try {
    const data = await _loadUserData();
    const {
      pending, completed, overdue, dueToday, highPri, stale,
      completedThisWeek, completedToday, allNotes, facts,
      sessions, recurringTopics, streak,
    } = data;

    const recentNotes = [...allNotes]
      .sort((a, b) => b.updatedAt > a.updatedAt ? 1 : -1)
      .slice(0, 5);

    const recentPending = [...pending]
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 8);

    const relevantMems = await _getRelevantMemories(userMessage, 6);

    return {
      recentNotes, recentPending, completed, overdue, dueToday, highPri, stale,
      completedThisWeek, completedToday, allNotes, relevantMems,
      sessionSummaries: sessions, recurringTopics, streak,
      memCount: facts.length,
    };
  } catch {
    return {
      recentNotes: [], recentPending: [], completed: [], overdue: [], dueToday: [],
      highPri: [], stale: [], completedThisWeek: [], completedToday: [], allNotes: [],
      relevantMems: [], sessionSummaries: [], recurringTopics: [], streak: 0, memCount: 0,
    };
  }
}

function _buildSystemPrompt(ctx) {
  const {
    recentNotes, recentPending, completed, overdue, dueToday, stale,
    completedThisWeek, completedToday, allNotes, relevantMems,
    sessionSummaries, recurringTopics, streak, memCount,
  } = ctx;

  const notesSummary = recentNotes.length
    ? recentNotes.map(n => `• "${n.title || 'Untitled'}"`).join('\n')
    : 'None.';

  const tasksSummary = recentPending.length
    ? recentPending.map(t => {
        const p    = t.priority === 1 ? 'HIGH' : t.priority === 3 ? 'LOW' : 'MED';
        const due  = t.dueDate
          ? ` · due ${new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : '';
        const flag = overdue.includes(t) ? ' ⚠ OVERDUE' : dueToday.includes(t) ? ' · DUE TODAY' : '';
        return `• [ID:${t.id}] [${p}]${flag} "${t.title}"${due} (${_taskAge(t)})`;
      }).join('\n')
    : 'No pending tasks.';

  const overdueNote = overdue.length
    ? `OVERDUE (${overdue.length}): ${overdue.map(t => `"${t.title}"`).join(', ')}`
    : 'None overdue.';

  const staleNote = stale.length
    ? `STALE >7 days (${stale.length}): ${stale.slice(0, 3).map(t => `"${t.title}"`).join(', ')}`
    : '';

  const progressNote = [
    completedToday.length ? `${completedToday.length} completed today` : '',
    completedThisWeek.length ? `${completedThisWeek.length} this week` : '',
    streak > 1 ? `${streak}-day streak` : '',
  ].filter(Boolean).join(' · ') || 'No completions yet.';

  const topicNote = recurringTopics.length
    ? recurringTopics.map(t =>
        `• "${t.topic}" (${t.count}x, last ${_relativeTime(t.lastMentioned)})`
      ).join('\n')
    : 'None detected.';

  const memsSummary = relevantMems.length
    ? relevantMems.map(m =>
        `• ${m.content.slice(0, 80)} (${_relativeTime(m.timestamp || m.updatedAt)})`
      ).join('\n')
    : 'None.';

  const sessionCtx = sessionSummaries.length
    ? sessionSummaries.map(s => `• ${s.content.slice(0, 150)}`).join('\n')
    : 'No previous sessions.';

  return `${_novaPersonaPrompt()}

== USER DATA ==

Notes (${allNotes.length} total):
${notesSummary}

Pending tasks (${recentPending.length} shown):
${tasksSummary}

${overdueNote}
${staleNote}

Progress: ${progressNote}
Completed total: ${completed.length} · Stored memories: ${memCount}

Recurring topics in memory:
${topicNote}

Relevant memories (keyword-matched to this conversation):
${memsSummary}

Previous sessions:
${sessionCtx}

== ACTION MARKERS ==
Append at the END of your response only. Never mention them to the user.

[SAVE_MEMORY: "one sentence fact"]
[CREATE_TASK: "task title"]
[CREATE_NOTE: "title | content"]
[COMPLETE_TASK: "task id or title substring"]`;
}

// ── Semantic memory retrieval ─────────────────────────────────

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
    console.debug('[Memory] No keywords — using recent');
    return DB.memories.getRecent(limit);
  }

  const all   = await DB.memories.getAll();
  const facts = all.filter(m => m.type !== 'session_summary');
  if (!facts.length) return [];

  const scored = facts.map(m => {
    const hay   = (m.content + ' ' + (m.tags || []).join(' ')).toLowerCase();
    const score = keywords.reduce((n, kw) => n + (hay.includes(kw) ? 1 : 0), 0);
    return { memory: m, score };
  });

  const relevant = scored.filter(s => s.score > 0);

  console.debug(`[Memory] "${userMessage.slice(0, 50)}" → keywords: [${keywords.join(', ')}]`);
  relevant.slice(0, 5).forEach(s =>
    console.debug(`  [${s.score}] ${s.memory.content.slice(0, 60)}`)
  );
  if (!relevant.length) console.debug('[Memory] No matches — fallback to recent');

  if (!relevant.length) return DB.memories.getRecent(limit);

  return relevant
    .sort((a, b) => b.score - a.score || (b.memory.updatedAt > a.memory.updatedAt ? 1 : -1))
    .slice(0, limit)
    .map(s => s.memory);
}

// ── Session memory ────────────────────────────────────────────

async function _getSessionSummaries(limit = 3) {
  try {
    const all = await DB.memories.getByType('session_summary');
    return all
      .sort((a, b) => b.timestamp > a.timestamp ? 1 : -1)
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
    hasGeminiKey()
      ? await _geminiSessionSummary(sessionMsgs)
      : await _localSessionSummary(sessionMsgs);

    _lastSummaryIndex = _messages.length;
    try { localStorage.setItem(LS_SESSION_INDEX, String(_lastSummaryIndex)); } catch {}
  } catch (e) {
    console.warn('[Session]', e.message);
  } finally {
    _summarizing = false;
  }
}

async function _geminiSessionSummary(messages) {
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'User' : 'NOVA'}: ${m.text.slice(0, 100)}`)
    .join('\n');

  const prompt = `Summarize this conversation in 2-3 sentences. Focus on: goals, worries, commitments, and important facts. Be specific — use actual names and topics, not vague descriptions. No action markers.

${transcript}`;

  const raw = await callGemini(
    [{ role: 'user', text: prompt }],
    'You are a concise summarizer. Return only the summary. No action markers. No preamble.'
  );

  const summary = raw.replace(ACTION_RE, '').trim().slice(0, 500);
  if (!summary) return;

  await DB.memories.create({
    type: 'session_summary', content: summary, source: 'ai', tags: ['session'],
  });
  console.log('[Session] Saved:', summary.slice(0, 80));
}

async function _localSessionSummary(messages) {
  const userMsgs = messages.filter(m => m.role === 'user').map(m => m.text);
  if (!userMsgs.length) return;
  const topics  = userMsgs.slice(0, 4).map(t => `"${t.slice(0, 60)}"`).join(', ');
  await DB.memories.create({
    type: 'session_summary',
    content: `Session: User discussed ${topics}.`,
    source: 'local', tags: ['session'],
  });
}

// ── Offline Intelligence Layer ────────────────────────────────
// Full analysis without Gemini. Dispatches by intent.

async function _offlineResponse(text) {
  const q    = text.toLowerCase().trim();
  const data = await _loadUserData();

  // Priority / focus
  if (/\b(focus|priority|priorities|what.*work|start|tackle|important|urgent|first)\b/.test(q)) {
    return _offlinePriority(data);
  }
  // Progress / how am I doing
  if (/\b(progress|how.*doing|productive|accomplish|complet|done|finish|streak)\b/.test(q)) {
    return _offlineProgress(data);
  }
  // Overview / summary
  if (/\b(summary|overview|status|caught up|brief|update|everything)\b/.test(q)) {
    return _offlineSummary(data);
  }
  // Recommendation
  if (/\b(recommend|suggest|advice|what should|next step|plan)\b/.test(q)) {
    return _offlineRecommendation(data, q);
  }
  // Memory / what I've been thinking
  if (/\b(memor|remember|know about|thinking about|mention|discuss|topic|pattern)\b/.test(q)) {
    return _offlineMemories(data, q);
  }
  // Tasks
  if (/\b(task|todo|pending|overdue|due|list)\b/.test(q)) {
    return _offlineTasks(data, q);
  }
  // Notes
  if (/\b(note|wrote|saved|document|notes)\b/.test(q)) {
    return _offlineNotes(data);
  }
  // Help
  if (/\b(help|what can|commands|capabilities)\b/.test(q)) {
    return _offlineHelp();
  }
  // Quick note/task creation
  const noteMatch = q.match(/^(?:remember|save|note this)[:\-—]?\s+(.+)/i);
  if (noteMatch) return _createNote(noteMatch[1].trim());
  const taskMatch = q.match(/^(?:todo|add task|create task|remind me to)[:\-—]?\s+(.+)/i);
  if (taskMatch) return _createTask(taskMatch[1].trim());

  // Fallback — still be useful
  return _offlineGeneral(data, text);
}

function _offlinePriority(data) {
  const { pending, overdue, dueToday, highPri, stale, recurringTopics } = data;

  if (!pending.length) return "No open tasks right now.";

  const lines = [];

  if (overdue.length) {
    lines.push(`${overdue.length} overdue — deal with ${overdue.length === 1 ? 'it' : 'these'} first:`);
    overdue.slice(0, 3).forEach(t =>
      lines.push(`  • "${t.title}" (${_taskAge(t)})`)
    );
  }

  if (dueToday.length) {
    lines.push(`Due today: ${dueToday.map(t => `"${t.title}"`).join(', ')}.`);
  }

  const top = overdue[0] || dueToday[0] || highPri[0] ||
    [...pending].sort((a, b) => a.priority - b.priority)[0];

  if (top && !overdue.length && !dueToday.length) {
    const age = Math.floor((Date.now() - new Date(top.createdAt)) / 86400000);
    lines.push(`Top priority: "${top.title}"${age > 2 ? ` — ${age} days old` : ''}.`);
  }

  if (stale.length) {
    lines.push(`\n${stale.length} task${stale.length !== 1 ? 's have' : ' has'} been open over a week — worth reviewing.`);
  }

  if (recurringTopics.length && !overdue.length) {
    lines.push(`\nYou keep coming back to "${recurringTopics[0].topic}" — make sure it's represented in your tasks.`);
  }

  return lines.join('\n');
}

function _offlineProgress(data) {
  const { completed, completedToday, completedThisWeek, pending, overdue, streak } = data;

  const lines = [];

  if (completedToday.length) {
    lines.push(`${completedToday.length} task${completedToday.length !== 1 ? 's' : ''} done today.`);
  }
  if (completedThisWeek.length) {
    lines.push(`${completedThisWeek.length} completed this week out of ${pending.length + completedThisWeek.length} total.`);
  }
  if (streak > 1) {
    lines.push(`${streak}-day completion streak.`);
  }
  if (!completedToday.length && !completedThisWeek.length) {
    lines.push("Nothing completed yet this week.");
  }

  if (overdue.length) {
    lines.push(`\n${overdue.length} overdue task${overdue.length !== 1 ? 's' : ''} — that's the gap worth closing.`);
  }

  lines.push(`\n${completed.length} total tasks completed across all time.`);

  return lines.join('\n');
}

function _offlineSummary(data) {
  const { pending, completed, overdue, dueToday, allNotes, facts, sessions,
          recurringTopics, streak, completedThisWeek } = data;

  const lines = [];

  // Tasks
  if (pending.length) {
    lines.push(`${pending.length} open task${pending.length !== 1 ? 's' : ''}${overdue.length ? `, ${overdue.length} overdue` : ''}${dueToday.length ? `, ${dueToday.length} due today` : ''}.`);
  } else {
    lines.push('No open tasks.');
  }

  // Notes
  if (allNotes.length) lines.push(`${allNotes.length} note${allNotes.length !== 1 ? 's' : ''} saved.`);

  // Memory
  if (facts.length) lines.push(`${facts.length} memor${facts.length !== 1 ? 'ies' : 'y'} stored.`);

  // Progress
  if (completedThisWeek.length || streak > 1) {
    const parts = [];
    if (completedThisWeek.length) parts.push(`${completedThisWeek.length} completed this week`);
    if (streak > 1) parts.push(`${streak}-day streak`);
    lines.push(parts.join(', ') + '.');
  }

  // Recurring topic
  if (recurringTopics.length) {
    lines.push(`\nYou've mentioned "${recurringTopics[0].topic}" ${recurringTopics[0].count} times recently.`);
  }

  // Last session
  if (sessions.length) {
    lines.push(`\nLast session: ${sessions[0].content.slice(0, 100)}${sessions[0].content.length > 100 ? '…' : ''}`);
  }

  return lines.join('\n');
}

function _offlineRecommendation(data, query) {
  const { pending, overdue, dueToday, highPri, stale, recurringTopics, completedThisWeek } = data;

  if (!pending.length) {
    return "No open tasks. Add something to work toward — task: [description].";
  }

  const lines = [];

  if (overdue.length) {
    lines.push(`Clear the overdue queue first — "${overdue[0].title}" has been waiting the longest.`);
    if (overdue.length > 1) {
      lines.push(`Then: ${overdue.slice(1, 3).map(t => `"${t.title}"`).join(', ')}.`);
    }
    return lines.join('\n');
  }

  if (dueToday.length) {
    lines.push(`Today's focus: "${dueToday[0].title}".`);
    if (dueToday.length > 1) lines.push(`Also due: ${dueToday.slice(1).map(t => `"${t.title}"`).join(', ')}.`);
    return lines.join('\n');
  }

  const top = highPri[0] || [...pending].sort((a, b) => a.priority - b.priority)[0];
  if (top) {
    const age = Math.floor((Date.now() - new Date(top.createdAt)) / 86400000);
    lines.push(`Focus on: "${top.title}"${age > 3 ? ` — it's been open ${age} days` : ''}.`);
  }

  if (stale.length) {
    lines.push(`\n${stale.length} task${stale.length !== 1 ? 's have' : ' has'} been untouched for 7+ days. Worth closing or deleting.`);
  }

  if (recurringTopics.length) {
    lines.push(`\n"${recurringTopics[0].topic}" keeps coming up in your notes — make sure it's accounted for.`);
  }

  return lines.join('\n');
}

async function _offlineMemories(data, query) {
  const { facts, sessions, recurringTopics } = data;

  if (!facts.length && !sessions.length) {
    return "Nothing stored in memory yet. Start talking — I'll pick up what matters.";
  }

  const lines = [];

  if (recurringTopics.length) {
    lines.push(`Recurring topics across your memories:`);
    recurringTopics.forEach(t =>
      lines.push(`  • "${t.topic}" — ${t.count}x, last ${_relativeTime(t.lastMentioned)}`)
    );
    lines.push('');
  }

  if (facts.length) {
    const recent = [...facts].sort((a, b) => b.timestamp > a.timestamp ? 1 : -1).slice(0, 4);
    lines.push(`Recent facts (${facts.length} total):`);
    recent.forEach(m =>
      lines.push(`  • ${m.content.slice(0, 80)} — ${_relativeTime(m.timestamp)}`)
    );
  }

  if (sessions.length) {
    lines.push(`\nLast session: ${sessions[0].content.slice(0, 120)}`);
  }

  return lines.join('\n');
}

async function _offlineTasks(data, query) {
  const { pending, overdue, dueToday, highPri, stale, completed } = data;

  if (!pending.length) return "No pending tasks. Use task: [text] to add one.";

  const lines = [];

  if (overdue.length) {
    lines.push(`Overdue (${overdue.length}):`);
    overdue.forEach(t => lines.push(`  • "${t.title}" — ${_taskAge(t)}`));
    lines.push('');
  }
  if (dueToday.length) {
    lines.push(`Due today: ${dueToday.map(t => `"${t.title}"`).join(', ')}.`);
  }
  if (highPri.length) {
    lines.push(`High priority: ${highPri.slice(0, 3).map(t => `"${t.title}"`).join(', ')}.`);
  }
  if (stale.length) {
    lines.push(`\nStale (7+ days open): ${stale.slice(0, 3).map(t => `"${t.title}"`).join(', ')}.`);
  }

  lines.push(`\n${pending.length} open, ${completed.length} completed total.`);
  return lines.join('\n');
}

async function _offlineNotes(data) {
  const { allNotes } = data;

  if (!allNotes.length) return 'No notes saved yet. Use note: [text] to create one.';

  const pinned = allNotes.filter(n => n.pinned);
  const recent = [...allNotes]
    .sort((a, b) => b.updatedAt > a.updatedAt ? 1 : -1)
    .slice(0, 5);

  const lines = [`${allNotes.length} note${allNotes.length !== 1 ? 's' : ''} saved.`];
  if (pinned.length) lines.push(`Pinned: ${pinned.map(n => `"${n.title || 'Untitled'}"`).join(', ')}.`);
  lines.push(`Recent: ${recent.map(n => `"${n.title || 'Untitled'}"`).join(', ')}.`);

  return lines.join('\n');
}

function _offlineHelp() {
  return [
    'Without a Gemini key, I can still analyze your data directly.',
    '',
    'Ask me:',
    '• **"What should I focus on?"** — priority analysis',
    '• **"How\'s my progress?"** — completion + streak',
    '• **"Give me a summary"** — full system overview',
    '• **"What have I been thinking about?"** — memory patterns',
    '• **"Recommend something"** — data-driven suggestion',
    '',
    'Shortcuts: **note: [text]** · **task: [text]** · **clear**',
    '',
    'Add a Gemini key in Settings for full conversational AI.',
  ].join('\n');
}

function _offlineGeneral(data, text) {
  const { pending, overdue, facts, recurringTopics } = data;
  const lines = [];

  // Still try to be useful
  if (overdue.length) {
    lines.push(`You have ${overdue.length} overdue task${overdue.length !== 1 ? 's' : ''} — "${overdue[0].title}" is the oldest.`);
  } else if (pending.length) {
    const top = [...pending].sort((a, b) => a.priority - b.priority)[0];
    lines.push(`${pending.length} open tasks. Top priority: "${top.title}".`);
  }

  if (recurringTopics.length) {
    lines.push(`You've mentioned "${recurringTopics[0].topic}" ${recurringTopics[0].count} times.`);
  }

  lines.push('\nAdd a Gemini key in Settings for full AI responses. Or ask about tasks, priorities, or memories — I can analyze those directly.');

  return lines.join('\n');
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
    catch (e) { console.warn('[Action]', action.type, e); }
  }
  return clean;
}

async function _executeAction(type, value) {
  switch (type) {
    case 'SAVE_MEMORY': {
      const id = await DB.memories.create({ type: 'ai_fact', content: value, source: 'ai', tags: [] });
      Bus.emit(EVENTS.MEMORY_CREATED, { id, content: value });
      await logEvent(EVENT_TYPES.MEMORY_CREATED, `Memory: ${value.slice(0, 60)}`);
      showToast('◈ Memory saved', 'success', 2200);
      break;
    }
    case 'CREATE_TASK': {
      const id = await DB.tasks.create({ title: value.slice(0, 80) });
      Bus.emit(EVENTS.TASK_CREATED, { id, title: value });
      await logEvent(EVENT_TYPES.TASK_CREATED, `Task: ${value.slice(0, 60)}`);
      showToast(`◉ Task: "${value.slice(0, 40)}"`, 'success', 2500);
      break;
    }
    case 'CREATE_NOTE': {
      const [title, ...rest] = value.split('|');
      const content = rest.join('|').trim();
      const id = await DB.notes.create({ title: title.trim().slice(0, 60), content: content || title.trim() });
      Bus.emit(EVENTS.NOTE_CREATED, { id, title: title.trim() });
      await logEvent(EVENT_TYPES.NOTE_CREATED, `Note: ${title.trim().slice(0, 60)}`);
      showToast(`◇ Note: "${title.trim().slice(0, 35)}"`, 'success', 2500);
      break;
    }
    case 'COMPLETE_TASK': {
      const all    = await DB.tasks.getAll();
      const target = all.find(t =>
        t.id === value || t.title.toLowerCase().includes(value.toLowerCase())
      );
      if (target && target.status !== 'completed') {
        await DB.tasks.update(target.id, { status: 'completed', completedAt: new Date().toISOString() });
        Bus.emit(EVENTS.TASK_COMPLETED, { id: target.id, title: target.title });
        await logEvent(EVENT_TYPES.TASK_COMPLETED, `Done: ${target.title}`);
        showToast(`✓ "${target.title.slice(0, 40)}"`, 'success', 2500);
      }
      break;
    }
  }
}

// ── Note / task creators ──────────────────────────────────────

async function _createNote(content) {
  try {
    const title = content.slice(0, 60);
    const id    = await DB.notes.create({ title, content });
    Bus.emit(EVENTS.NOTE_CREATED, { id, title });
    await logEvent(EVENT_TYPES.NOTE_CREATED, `Note: ${title}`);
    showToast('◇ Saved', 'success', 2000);
    return `Saved: "${title}${content.length > 60 ? '…' : ''}".`;
  } catch { return "Couldn't save that note."; }
}

async function _createTask(content) {
  try {
    const title = content.slice(0, 80);
    const id    = await DB.tasks.create({ title });
    Bus.emit(EVENTS.TASK_CREATED, { id, title });
    await logEvent(EVENT_TYPES.TASK_CREATED, `Task: ${title}`);
    showToast('◉ Added', 'success', 2000);
    return `Added: "${title}${content.length > 80 ? '…' : ''}".`;
  } catch { return "Couldn't add that task."; }
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
        <p class="conv-empty-desc">${hasGeminiKey()
          ? 'Gemini connected. Talk naturally.'
          : 'No Gemini key — but I can still analyze your tasks, memories, and priorities.'
        }</p>
        <div class="conv-suggestions">
          <button class="conv-suggest" data-q="What should I focus on?">Focus</button>
          <button class="conv-suggest" data-q="How's my progress?">Progress</button>
          <button class="conv-suggest" data-q="Give me a summary">Summary</button>
          <button class="conv-suggest" data-q="What have I been thinking about?">Patterns</button>
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

  content.innerHTML = `<div class="conv-list">${_messages.map(_renderMessage).join('')}</div>`;
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
