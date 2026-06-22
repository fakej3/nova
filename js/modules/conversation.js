/**
 * NOVA Conversation System v5
 *
 * Phases implemented in this version:
 *
 * Phase 1 — Natural Language Actions
 *   NL due dates (tomorrow, Friday, in 3 days, June 30…)
 *   NL task creation (remind me to, I need to, don't forget…)
 *   NL memory creation (remember that, my exam is, I prefer…)
 *   NL goal creation (goal: …, I'm working toward…)
 *   Commitment detection (I'll finish…, I'm going to…)
 *
 * Phase 2 — Proactive NOVA
 *   Opening briefing with goals + commitment checks
 *   Dynamic idle suggestions from real user data
 *   Commitment storage and unresolved tracking in briefings
 *
 * Phase 3 — Goals System
 *   Goals injected into every Gemini context and offline responses
 *   Progress computed from linked tasks
 *
 * Phase 4 — Daily Retention
 *   Morning review (once per day)
 *   Evening review (once per evening, 17:00–23:59)
 *   Weekly summary (once per 7 days)
 *
 * Phase 5 — Smarter Memory
 *   Synonym expansion before keyword matching
 *   Scoring via nlp.scoreMemory
 *
 * Routes:
 *   1. Fast local intents  (clear, time, date, goal:, note:, task:)
 *   2. NL intents          (high-confidence task / memory / goal / commitment)
 *   3. Gemini API          (when key configured)
 *   4. Offline intelligence (no key / offline)
 *
 * Action markers (Gemini):
 *   [SAVE_MEMORY: "…"] [CREATE_TASK: "…"]
 *   [CREATE_NOTE: "title | content"] [COMPLETE_TASK: "id or title"]
 *   [CREATE_GOAL: "title"] [COMPLETE_GOAL: "title substring"]
 */

import { DB }                       from '../core/db.js';
import { Bus, EVENTS }              from '../core/bus.js';
import { State }                    from '../core/state.js';
import { setOrbState }              from '../ui/orb.js';
import { showToast }                from '../ui/toast.js';
import { logEvent, EVENT_TYPES }    from '../services/events.js';
import { callGemini, hasGeminiKey } from '../services/gemini.js';
import {
  parseDueDate, detectTaskIntent, detectMemoryIntent,
  detectCommitment, detectGoalIntent, expandKeywords, scoreMemory,
} from '../services/nlp.js';
import {
  createGoal, getGoalsWithProgress, formatGoalsBrief, formatGoalsForContext,
  findRelatedGoal, linkTaskToGoal,
} from './goals.js';
import { trackInteraction } from '../services/notifications.js';

// ── Constants ─────────────────────────────────────────────────

const MAX_HISTORY      = 100;
const LS_KEY           = 'nova_conversation';
const LS_SESSION_INDEX = 'nova_session_msg_index';
const LS_BRIEFING_DATE = 'nova_briefing_date';
const LS_EVENING_DATE  = 'nova_evening_date';
const LS_WEEKLY_DATE   = 'nova_weekly_date';

let _messages         = [];
let _busy             = false;
let _summarizing      = false;
let _lastSummaryIndex = 0;
let _conversationStarted = false;

// ── Stop words (used in _extractKeywords for topic detection) ─

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
    if (_lastSummaryIndex > _messages.length)
      _lastSummaryIndex = Math.max(0, _messages.length - 5);
  } catch { _lastSummaryIndex = 0; }

  // Session summary when navigating away from chat
  Bus.on(EVENTS.VIEW_CHANGED, ({ view } = {}) => {
    if (view !== 'chat')
      _maybeGenerateSessionSummary().catch(e => console.warn('[Session]', e.message));
  });
}

export function isBusy() { return _busy; }

export function clearConversation() {
  _messages = []; _lastSummaryIndex = 0; _conversationStarted = false;
  _saveHistory();
  try { localStorage.removeItem(LS_SESSION_INDEX); } catch {}
}

// ── Phase 1: NL intent handler ────────────────────────────────
// Runs BEFORE Gemini for high-confidence intents — fast, local, reliable.

async function _tryNLIntent(text) {
  // Goal creation
  const goalIntent = detectGoalIntent(text);
  if (goalIntent.isGoal && goalIntent.confidence === 'high') {
    const { clean: cleanTitle, date, phrase } = parseDueDate(goalIntent.title);
    const id = await createGoal(cleanTitle, '', date);
    await logEvent(EVENT_TYPES.TASK_CREATED, `Goal: ${cleanTitle}`);
    const duePart = phrase ? ` · target: ${phrase}` : '';
    return `Goal set: "${cleanTitle}"${duePart}. Link tasks to it by mentioning this goal when creating them.`;
  }

  // Task creation with NL due date
  const taskIntent = detectTaskIntent(text);
  if (taskIntent.isTask && taskIntent.confidence === 'high') {
    const { clean: cleanTitle, date, phrase } = parseDueDate(taskIntent.title);
    const title  = (cleanTitle || taskIntent.title).trim().replace(/\.$/, '');
    const taskId = await DB.tasks.create({ title: title.slice(0, 80), dueDate: date });
    Bus.emit(EVENTS.TASK_CREATED, { id: taskId, title });
    await logEvent(EVENT_TYPES.TASK_CREATED, `Task: ${title}`);
    showToast(`◉ Task: "${title.slice(0, 40)}"`, 'success', 2500);

    // Auto-link to a matching goal if one exists
    const relGoal = await findRelatedGoal(title);
    let goalNote  = '';
    if (relGoal) {
      await linkTaskToGoal(relGoal.id, taskId);
      goalNote = ` Linked to goal: "${relGoal.title}".`;
    }

    const duePart = phrase ? ` Due: ${phrase}.` : '';
    return `Added: "${title}".${duePart}${goalNote}`;
  }

  // Memory creation
  const memIntent = detectMemoryIntent(text);
  if (memIntent.isMemory && memIntent.confidence === 'high') {
    // Also check if there's a date — could imply a task too
    const { date, phrase } = parseDueDate(text);
    const id = await DB.memories.create({
      type: 'ai_fact', content: text, source: 'user', tags: [],
    });
    Bus.emit(EVENTS.MEMORY_CREATED, { id, content: text });
    await logEvent(EVENT_TYPES.MEMORY_CREATED, `Memory: ${text.slice(0, 60)}`);
    showToast('◈ Remembered', 'success', 2000);

    // If it has a date, offer to create a task
    const follow = phrase
      ? ` Want me to create a task with a ${phrase} due date?`
      : '';
    return `Got it.${follow}`;
  }

  return null; // fall through to Gemini / offline
}

// ── Phase 4: Daily / Evening / Weekly reviews ─────────────────

export async function generateDailyBriefing() {
  const today = new Date().toDateString();
  if (localStorage.getItem(LS_BRIEFING_DATE) === today) {
    await _maybeGenerateWeeklySummary();
    return;
  }
  try {
    const [data, goals] = await Promise.all([_loadUserData(), getGoalsWithProgress()]);
    setOrbState('thinking');

    // Background features always use the local path — never burn Gemini quota on boot.
    const briefing = _localBriefing('morning', data, goals);

    if (!briefing) { setOrbState('idle'); return; }

    _addMessage('nova', briefing);
    _saveHistory();
    localStorage.setItem(LS_BRIEFING_DATE, today);

    setOrbState('idle');
    _renderIfOpen();
    await _maybeGenerateWeeklySummary();
  } catch (e) {
    console.warn('[Briefing]', e.message);
    setOrbState('idle');
  }
}

export async function generateEveningReview() {
  const hour = new Date().getHours();
  if (hour < 17 || hour > 23) return;

  const today = new Date().toDateString();
  if (localStorage.getItem(LS_EVENING_DATE) === today) return;
  // Don't add a second proactive message if the morning briefing already ran today
  if (localStorage.getItem(LS_BRIEFING_DATE) === today) return;

  // Only if user has been active today
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const activeToday = _messages.some(m => m.ts > todayStart.getTime());
  if (!activeToday) return;

  try {
    const [data, goals] = await Promise.all([_loadUserData(), getGoalsWithProgress()]);
    const review = _localBriefing('evening', data, goals);   // local only
    if (!review) return;
    _addMessage('nova', review);
    _saveHistory();
    localStorage.setItem(LS_EVENING_DATE, today);
    _renderIfOpen();
  } catch (e) {
    console.warn('[Evening]', e.message);
  }
}

async function _maybeGenerateWeeklySummary() {
  const lastWeekly   = localStorage.getItem(LS_WEEKLY_DATE);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (lastWeekly && new Date(lastWeekly).getTime() > sevenDaysAgo) return;

  try {
    const [data, goals] = await Promise.all([_loadUserData(), getGoalsWithProgress()]);
    const summary = _localWeeklySummary(data, goals);         // local only
    if (!summary) return;
    _addMessage('nova', summary);
    _saveHistory();
    localStorage.setItem(LS_WEEKLY_DATE, new Date().toISOString());
    _renderIfOpen();
  } catch (e) {
    console.warn('[Weekly]', e.message);
  }
}

// ── Briefing builders ─────────────────────────────────────────

async function _geminiBriefing(type, data, goals) {
  const {
    pending, overdue, dueToday, stale, completedThisWeek, completedToday,
    streak, facts, sessions, recurringTopics,
  } = data;

  const userName = State.get('userName') || '';
  const dateStr  = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const taskLines = pending.slice(0, 8).map(t => {
    const pri  = t.priority === 1 ? 'HIGH' : t.priority === 3 ? 'LOW' : 'MED';
    const due  = t.dueDate
      ? ` (due ${new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
      : '';
    const flag = overdue.includes(t) ? ' [OVERDUE]' : dueToday.includes(t) ? ' [DUE TODAY]' : '';
    return `• [${pri}]${flag} ${t.title}${due} — ${_taskAge(t)}`;
  }).join('\n') || 'No pending tasks.';

  const commitments = await _getUnresolvedCommitments(data);
  const commitLines = commitments.length
    ? commitments.map(c => `• ${c}`).join('\n')
    : 'None.';

  const isEvening   = type === 'evening';
  const typeLabel   = isEvening ? 'evening check-in' : 'morning briefing';
  const progressNote = [
    completedToday.length   ? `${completedToday.length} done today` : '',
    completedThisWeek.length ? `${completedThisWeek.length} this week` : '',
    streak > 1               ? `${streak}-day streak` : '',
  ].filter(Boolean).join(', ') || 'No completions yet';

  const userPrompt = `Generate my ${typeLabel} for ${dateStr}${userName ? `, ${userName}` : ''}.

TASKS (${pending.length} pending, ${overdue.length} overdue, ${dueToday.length} due today):
${taskLines}

GOALS:
${formatGoalsForContext(goals)}

PROGRESS: ${progressNote}
UNRESOLVED COMMITMENTS:
${commitLines}

RECURRING TOPICS: ${recurringTopics.slice(0, 3).map(t => `"${t.topic}" (${t.count}x)`).join(', ') || 'none'}
PREVIOUS SESSIONS: ${sessions[0]?.content?.slice(0, 150) || 'none'}

Rules:
- Under 120 words.
- ${isEvening ? 'Review the day: what got done, what didn\'t. Set tomorrow\'s intention.' : 'Lead with overdue/urgent. Reference a goal. End with one focus question.'}
- Call out unresolved commitments directly.
- No action markers. Speak as NOVA.`;

  const raw = await callGemini([{ role: 'user', text: userPrompt }], _novaPersonaPrompt());
  return raw.replace(ACTION_RE, '').trim();
}

function _localBriefing(type, data, goals) {
  const {
    pending, overdue, dueToday, highPri, stale,
    completedToday, completedThisWeek, streak, sessions, recurringTopics,
  } = data;

  const userName = State.get('userName') || '';
  const isEvening = type === 'evening';
  const tc        = _timeContext();
  const greet     = userName ? `Good ${tc}, ${userName}.` : `Good ${tc}.`;

  const lines = [greet, ''];

  if (isEvening) {
    // Evening: day review
    if (completedToday.length) {
      lines.push(`${completedToday.length} task${completedToday.length !== 1 ? 's' : ''} done today.`);
    } else {
      lines.push('Nothing completed today yet.');
    }
    if (overdue.length) {
      lines.push(`${overdue.length} task${overdue.length !== 1 ? 's' : ''} still overdue — carry them into tomorrow?`);
    }
    if (streak > 1) lines.push(`${streak}-day streak — don't break it.`);
    lines.push('\nWhat did you learn or decide today?');
  } else {
    // Morning: forward-looking
    if (overdue.length) {
      const names = overdue.slice(0, 2).map(t => `"${t.title}"`).join(', ');
      lines.push(`${overdue.length} overdue: ${names}${overdue.length > 2 ? ` +${overdue.length - 2}` : ''}.`);
    }
    if (dueToday.length) {
      lines.push(`Due today: ${dueToday.map(t => `"${t.title}"`).join(', ')}.`);
    }
    const top = overdue[0] || dueToday[0] || highPri[0]
      || [...pending].sort((a, b) => a.priority - b.priority)[0];
    if (top) {
      const age = Math.floor((Date.now() - new Date(top.createdAt)) / 86400000);
      lines.push(`\nStart with: "${top.title}"${age > 3 ? ` — ${age} days open` : ''}.`);
    }
  }

  // Goals
  if (goals.length) {
    const brief = formatGoalsBrief(goals);
    lines.push(`\nGoals: ${brief}.`);
  }

  // Recurring topic
  if (recurringTopics.length) {
    lines.push(`You've been thinking about "${recurringTopics[0].topic}" lately.`);
  }

  // Last session context
  if (sessions.length && !isEvening) {
    lines.push(`\nLast time: ${sessions[0].content.slice(0, 90)}${sessions[0].content.length > 90 ? '…' : ''}`);
  }

  if (stale.length && !overdue.length) {
    lines.push(`\n${stale.length} task${stale.length !== 1 ? 's have' : ' has'} been open over a week.`);
  }

  lines.push(isEvening ? '\nGet some rest.' : '\nWhat are you working on today?');
  return lines.join('\n');
}

async function _geminiWeeklySummary(data, goals) {
  const { completedThisWeek, pending, overdue, recurringTopics, sessions } = data;
  const userName = State.get('userName') || '';

  const userPrompt = `Generate a weekly review${userName ? ` for ${userName}` : ''}.

WEEK OVERVIEW:
- ${completedThisWeek.length} tasks completed
- ${pending.length} still pending, ${overdue.length} overdue

GOALS:
${formatGoalsForContext(goals)}

TOP RECURRING TOPICS: ${recurringTopics.slice(0, 5).map(t => `"${t.topic}" (${t.count}x)`).join(', ') || 'none'}

RECENT SESSIONS SUMMARY: ${sessions.slice(0, 2).map(s => s.content.slice(0, 120)).join(' | ') || 'none'}

Write a concise weekly review (under 150 words). Include: what got done, what's slipping, goal progress, a recommended focus theme for next week. Speak as NOVA, not a generic assistant. No action markers.`;

  const raw = await callGemini([{ role: 'user', text: userPrompt }], _novaPersonaPrompt());
  const summary = raw.replace(ACTION_RE, '').trim();
  return `**Weekly Review**\n\n${summary}`;
}

function _localWeeklySummary(data, goals) {
  const { completedThisWeek, pending, overdue, recurringTopics, streak } = data;
  const lines = ['**Weekly Review**', ''];

  lines.push(`${completedThisWeek.length} task${completedThisWeek.length !== 1 ? 's' : ''} completed this week.`);
  if (overdue.length) lines.push(`${overdue.length} overdue — needs attention.`);
  if (streak > 1)     lines.push(`${streak}-day completion streak.`);

  if (goals.length) {
    lines.push('');
    lines.push('Goals:');
    goals.forEach(g => lines.push(`• "${g.title}" — ${g.progress}%`));
  }

  if (recurringTopics.length) {
    lines.push('');
    lines.push(`Top themes: ${recurringTopics.slice(0, 3).map(t => `"${t.topic}"`).join(', ')}.`);
  }

  const top = [...pending].sort((a, b) => a.priority - b.priority)[0];
  if (top) lines.push(`\nFocus for next week: "${top.title}".`);

  return lines.join('\n');
}

// ── Commitment tracking ───────────────────────────────────────

async function _saveCommitment(action, timeframe) {
  const content = timeframe
    ? `User committed to: ${action} (${timeframe})`
    : `User committed to: ${action}`;
  await DB.memories.create({ type: 'commitment', content, source: 'user', tags: ['commitment'] });
}

async function _getUnresolvedCommitments(data) {
  try {
    const commitments = await DB.memories.getByType('commitment');
    if (!commitments.length) return [];

    const { completed } = data;
    const now = Date.now();
    const unresolved = [];

    for (const c of commitments) {
      // Skip commitments older than 14 days
      if (now - new Date(c.timestamp).getTime() > 14 * 86400000) continue;

      const action = c.content.replace(/^User committed to:\s*/i, '');
      const words  = action.toLowerCase().split(/\s+/).filter(w => w.length > 3);

      // Check if a completed task matches
      const fulfilled = completed.some(t =>
        words.some(w => t.title.toLowerCase().includes(w))
      );
      if (!fulfilled) unresolved.push(action.slice(0, 80));
    }

    return unresolved.slice(0, 3);
  } catch { return []; }
}

// ── Main message handler ──────────────────────────────────────

export async function handleUserMessage(rawText) {
  const text = rawText.trim();
  if (!text || _busy) return;
  _busy = true;

  _addMessage('user', text);
  _saveHistory();

  Bus.emit(EVENTS.CHAT_MESSAGE_SENT, { preview: text.slice(0, 50) });
  if (!_conversationStarted) {
    _conversationStarted = true;
    Bus.emit(EVENTS.CONVERSATION_STARTED, {});
  }
  // Only switch to chat if not already there — switching to an already-open view closes it.
  if (State.get('activeView') !== 'chat' || !State.get('panelOpen')) {
    Bus.emit(EVENTS.REQUEST_SWITCH_VIEW, { view: 'chat' });
  }
  _renderIfOpen();
  setOrbState('thinking');

  // Track interaction for notification permission timing
  trackInteraction();

  // Side-effect: detect and store commitments regardless of routing path
  const commitment = detectCommitment(text);
  if (commitment.isCommitment) {
    _saveCommitment(commitment.action, commitment.timeframe).catch(() => {});
  }

  try {
    let response;

    // Route 1: fast local intents
    const fast = await _tryLocalIntent(text);
    if (fast !== null) {
      response = fast;
    } else {
      // Route 2: high-confidence NL intents (task / memory / goal)
      const nl = await _tryNLIntent(text);
      if (nl !== null) {
        response = nl;
      } else if (hasGeminiKey()) {
        // Route 3: Gemini — inner try/catch so transient errors fall through to offline
        try {
          const context      = await _buildContext(text);
          const systemPrompt = _buildSystemPrompt(context);
          const history      = _messages.slice(-12);
          const raw          = await callGemini(history, systemPrompt, 'chat');
          response           = await _parseActions(raw);
        } catch (geminiErr) {
          // Config errors propagate — everything else falls back to offline
          if (geminiErr.message === 'NO_KEY' || geminiErr.message === 'INVALID_KEY') {
            throw geminiErr;
          }
          console.warn('[Gemini] fallback to offline:', geminiErr.message);
          const note = geminiErr.message === 'RATE_LIMIT'
            ? 'Gemini hit its rate limit. Using local analysis for now.\n\n'
            : 'Gemini didn\'t respond. Using local analysis.\n\n';
          response = note + await _offlineResponse(text);
        }
      } else {
        // Route 4: offline intelligence
        response = await _offlineResponse(text);
      }
    }

    setOrbState('responding');
    _addMessage('nova', response);
    _saveHistory();
    _renderIfOpen();

    // Emit first meaningful sentence as preview for activity feed
    const feedPreview = response.replace(/^[^\w"]+/, '').split(/[.!?\n]/)[0].slice(0, 80);
    Bus.emit(EVENTS.AI_RESPONSE_RECEIVED, { preview: feedPreview });
    await logEvent(EVENT_TYPES.AI_RESPONDED, 'AI response generated');
    await _delay(500);
    setOrbState('success');

  } catch (err) {
    console.error('[Conversation]', err.message);
    const errMsg =
      err.message === 'NO_KEY'      ? 'No API key configured. Go to Settings → Gemini API Key.' :
      err.message === 'INVALID_KEY' ? 'Invalid Gemini key. Check Settings → Gemini API Key.' :
                                      'Something went wrong. Try again.';
    _addMessage('nova', errMsg);
    _saveHistory();
    _renderIfOpen();
    setOrbState('error');
  } finally {
    _busy = false;
  }
}

// ── Local intent router (fast, no DB) ────────────────────────

async function _tryLocalIntent(text) {
  const q = text.toLowerCase().trim();

  if (/^(clear|reset|new chat|start over)$/.test(q)) {
    _messages = _messages.slice(-1); _saveHistory(); return 'Cleared.';
  }
  if (/^(what time is it|what('s| is) the time|current time|time\??)$/.test(q)) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (/^(what('s| is) (today|the date)|today's date|date\??)$/.test(q)) {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  // Shorthand creators
  const goalCmd = text.match(/^goal:\s+(.+)/i);
  if (goalCmd) {
    const { clean, date, phrase } = parseDueDate(goalCmd[1].trim());
    const id = await createGoal(clean || goalCmd[1].trim(), '', date);
    return `Goal set: "${clean}"${phrase ? ` · target: ${phrase}` : ''}.`;
  }

  const noteCmd = text.match(/^note:\s+(.+)/i);
  if (noteCmd) return _createNote(noteCmd[1].trim());

  const taskCmd = text.match(/^task:\s+(.+)/i);
  if (taskCmd) {
    const raw = taskCmd[1].trim();
    const { clean, date, phrase } = parseDueDate(raw);
    return _createTaskWithDate(clean || raw, date, phrase);
  }

  return null;
}

// ── NOVA Persona ──────────────────────────────────────────────

function _novaPersonaPrompt() {
  const aiName   = State.get('aiName')   || 'NOVA';
  const userName = State.get('userName') || '';
  const tc       = _timeContext();
  const dateStr  = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr  = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const greeting = userName ? `You know this person well — their name is ${userName}.` : '';

  return `You are ${aiName}. ${greeting}
It is ${timeStr} on ${dateStr} (${tc}).

You are a thoughtful personal companion who knows the user's tasks, goals, memories, and patterns. You are not a chatbot, not a dashboard, and not a corporate assistant. You are someone who pays close attention and speaks like a trusted collaborator — calm, honest, and perceptive.

VOICE AND STYLE:
- Write like a person, not a product. Short sentences. No bullet points unless the user asks for a list.
- Lead with what matters most. Don't summarize what you're about to say before saying it.
- When you know something relevant, weave it in naturally: "You've been putting this off for a week" not "I see this task is 7 days old."
- If you have an opinion, share it. "That's worth doing first" beats "you may want to consider."
- Under 120 words unless the user asks for detail. One tight paragraph is usually right.

FORBIDDEN PHRASES — never use these:
"Certainly!", "Of course!", "Great question!", "Absolutely!", "As an AI", "I don't have access to", "Based on the information provided", "I found in your memory", "According to your notes", "I notice that", "It looks like", "It seems like", "Feel free to"

MEMORY AND TIME:
- Refer to what you know directly: "You mentioned this last week" not "I found a memory from last week."
- Use relative time always: yesterday, three days ago, last week — never raw dates in prose.
- When a pattern exists, name it: "This keeps coming up" or "Third time this week."

TASKS AND PRIORITIES:
- Overdue tasks come first — always. Be specific about how long something has been waiting.
- When recommending what to work on, give a reason. "Start with X — it's the oldest and blocks everything else."
- Notice when a task connects to a goal and say so plainly.
- If something has been open for more than a week, say so. It's likely stale or stuck.

COMMITMENTS:
- If the user said they would do something and haven't, say it plainly: "You said you'd finish this by Friday. Still open."
- Don't soften it. Accountability is why they're here.

GOALS:
- Surface goal progress when it's relevant, not on every response.
- When a task links to a goal, mention it once: "This moves you closer to [goal]."

ACTION MARKERS — append silently at the END of your response, never explain them:
[SAVE_MEMORY: "fact to remember"]
[CREATE_TASK: "task title, optionally with due date phrase"]
[CREATE_NOTE: "title | content"]
[COMPLETE_TASK: "task id or title substring"]
[CREATE_GOAL: "goal title"]
[COMPLETE_GOAL: "goal title substring"]`;
}

// ── Context builder for Gemini ────────────────────────────────

async function _buildContext(userMessage = '') {
  try {
    const [data, goalsWithProgress] = await Promise.all([
      _loadUserData(),
      getGoalsWithProgress(),
    ]);
    const {
      pending, completed, overdue, dueToday, highPri, stale,
      completedThisWeek, completedToday, allNotes, facts,
      sessions, recurringTopics, streak,
    } = data;

    const recentNotes   = [...allNotes].sort((a, b) => b.updatedAt > a.updatedAt ? 1 : -1).slice(0, 5);
    const recentPending = [...pending].sort((a, b) => a.priority - b.priority).slice(0, 8);
    const relevantMems  = await _getRelevantMemories(userMessage, 6);
    const commitments   = await _getUnresolvedCommitments(data);

    return {
      recentNotes, recentPending, completed, overdue, dueToday, highPri, stale,
      completedThisWeek, completedToday, allNotes, relevantMems,
      sessionSummaries: sessions, recurringTopics, streak,
      memCount: facts.length, goals: goalsWithProgress, commitments,
    };
  } catch {
    return {
      recentNotes: [], recentPending: [], completed: [], overdue: [], dueToday: [],
      highPri: [], stale: [], completedThisWeek: [], completedToday: [], allNotes: [],
      relevantMems: [], sessionSummaries: [], recurringTopics: [], streak: 0,
      memCount: 0, goals: [], commitments: [],
    };
  }
}

function _buildSystemPrompt(ctx) {
  const {
    recentNotes, recentPending, completed, overdue, dueToday, stale,
    completedThisWeek, completedToday, allNotes, relevantMems,
    sessionSummaries, recurringTopics, streak, memCount, goals, commitments,
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
        return `• [${t.id}] [${p}]${flag} "${t.title}"${due} (${_taskAge(t)})`;
      }).join('\n')
    : 'None.';

  const memsSummary = relevantMems.length
    ? relevantMems.map(m => `• ${m.content.slice(0, 80)} (${_relativeTime(m.timestamp || m.updatedAt)})`).join('\n')
    : 'None.';

  const sessionCtx = sessionSummaries.length
    ? sessionSummaries.map(s => `• ${s.content.slice(0, 150)}`).join('\n')
    : 'No previous sessions.';

  const topicLines = recurringTopics.length
    ? recurringTopics.map(t => `• "${t.topic}" — ${t.count}x, last ${_relativeTime(t.lastMentioned)}`).join('\n')
    : 'None detected.';

  const progressNote = [
    completedToday.length   ? `${completedToday.length} today` : '',
    completedThisWeek.length ? `${completedThisWeek.length} this week` : '',
    streak > 1               ? `${streak}-day streak` : '',
  ].filter(Boolean).join(' · ') || 'None yet.';

  const commitLines = commitments.length
    ? commitments.map(c => `• ${c}`).join('\n')
    : 'None.';

  return `${_novaPersonaPrompt()}

== GOALS ==
${formatGoalsForContext(goals)}

== TASKS ==
Notes (${allNotes.length}): ${notesSummary}
Pending (${recentPending.length} shown):
${tasksSummary}
Overdue: ${overdue.length} · Due today: ${dueToday.length} · Stale 7d+: ${stale.length}
Completed: ${completed.length} total · Progress: ${progressNote}

== MEMORY ==
Recurring topics:
${topicLines}
Relevant memories (keyword-matched, synonym-expanded):
${memsSummary}
Stored total: ${memCount}

== CONTINUITY ==
Previous sessions:
${sessionCtx}
Unresolved commitments:
${commitLines}`;
}

// ── Phase 5: Smarter Memory Retrieval ────────────────────────

function _extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

async function _getRelevantMemories(userMessage, limit = 6) {
  const baseKeywords     = _extractKeywords(userMessage);
  const expandedKeywords = expandKeywords(baseKeywords);   // synonym expansion (Phase 5)

  if (!expandedKeywords.length) return DB.memories.getRecent(limit);

  const all   = await DB.memories.getAll();
  const facts = all.filter(m => m.type !== 'session_summary' && m.type !== 'commitment');
  if (!facts.length) return [];

  const scored  = facts.map(m => ({ memory: m, score: scoreMemory(m, expandedKeywords) }));
  const relevant = scored.filter(s => s.score > 0);

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
    return all.sort((a, b) => b.timestamp > a.timestamp ? 1 : -1).slice(0, limit);
  } catch { return []; }
}

async function _maybeGenerateSessionSummary() {
  if (_busy || _summarizing) return;
  const sessionMsgs = _messages.slice(_lastSummaryIndex);
  if (sessionMsgs.filter(m => m.role === 'user').length < 3) return;

  _summarizing = true;
  try {
    // Session summaries always use the local path — background work must not call Gemini.
    await _localSessionSummary(sessionMsgs);
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

  const raw = await callGemini(
    [{ role: 'user', text: `Summarize this conversation in 2-3 sentences. Focus on goals, worries, commitments, and key facts. Be specific. No action markers.\n\n${transcript}` }],
    'You are a concise summarizer. Return only the summary. No action markers.'
  );
  const summary = raw.replace(ACTION_RE, '').trim().slice(0, 500);
  if (!summary) return;
  await DB.memories.create({ type: 'session_summary', content: summary, source: 'ai', tags: ['session'] });
  console.log('[Session] Saved:', summary.slice(0, 80));
}

async function _localSessionSummary(messages) {
  const userMsgs = messages.filter(m => m.role === 'user').map(m => m.text);
  if (!userMsgs.length) return;
  await DB.memories.create({
    type: 'session_summary',
    content: `Session: User discussed ${userMsgs.slice(0, 4).map(t => `"${t.slice(0, 60)}"`).join(', ')}.`,
    source: 'local', tags: ['session'],
  });
}

// ── Shared data loader ────────────────────────────────────────

async function _loadUserData() {
  const [allTasks, allNotes, allMems] = await Promise.all([
    DB.tasks.getAll(),
    DB.notes.getAll(),
    DB.memories.getAll(),
  ]);

  const now        = new Date();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekAgo    = new Date(now - 7 * 86400000);

  const pending            = allTasks.filter(t => t.status === 'pending');
  const completed          = allTasks.filter(t => t.status === 'completed');
  const overdue            = pending.filter(t => t.dueDate && new Date(t.dueDate) < todayStart);
  const dueToday           = pending.filter(t => {
    if (!t.dueDate) return false;
    const d = new Date(t.dueDate); d.setHours(0, 0, 0, 0);
    return d.getTime() === todayStart.getTime();
  });
  const highPri            = pending.filter(t => t.priority === 1 && !overdue.includes(t));
  const stale              = pending.filter(t => new Date(t.createdAt) < weekAgo && !overdue.includes(t));
  const completedThisWeek  = completed.filter(t => t.completedAt && new Date(t.completedAt) > weekAgo);
  const completedToday     = completed.filter(t => t.completedAt && new Date(t.completedAt) >= todayStart);

  const facts    = allMems.filter(m => m.type !== 'session_summary' && m.type !== 'commitment');
  const sessions = await _getSessionSummaries(3);
  const recurringTopics = _detectRecurringTopics(facts);
  const streak          = _computeStreak(completed);

  return {
    pending, completed, overdue, dueToday, highPri, stale,
    completedThisWeek, completedToday, allNotes, facts, sessions,
    recurringTopics, streak, now,
  };
}

// ── Offline Intelligence Layer ────────────────────────────────

async function _offlineResponse(text) {
  const q    = text.toLowerCase().trim();
  const data = await _loadUserData();
  const goals = await getGoalsWithProgress();

  // Intent routing
  if (/\b(focus|priority|priorities|what.*work|start|tackle|important|urgent|first)\b/.test(q))
    return _offlinePriority(data, goals);

  if (/\b(progress|how.*doing|productive|accomplish|complet|done|finish|streak)\b/.test(q))
    return _offlineProgress(data);

  if (/\b(summary|overview|status|caught up|brief|update|everything)\b/.test(q))
    return _offlineSummary(data, goals);

  if (/\b(recommend|suggest|advice|what should|next step|plan)\b/.test(q))
    return _offlineRecommendation(data, goals);

  if (/\b(goal|goals|objective|target|aim)\b/.test(q))
    return _offlineGoals(data, goals);

  if (/\b(memor|remember|know about|thinking about|mention|discuss|topic|pattern)\b/.test(q))
    return _offlineMemories(data);

  if (/\b(task|todo|pending|overdue|due|list)\b/.test(q))
    return _offlineTasks(data);

  if (/\b(note|wrote|saved|document|notes)\b/.test(q))
    return _offlineNotes(data);

  if (/\b(commitment|promise|said.*would|said.*finish)\b/.test(q))
    return _offlineCommitments(data);

  if (/\b(help|what can|commands|capabilities)\b/.test(q))
    return _offlineHelp();

  return _offlineGeneral(data, goals);
}

function _offlinePriority(data, goals) {
  const { pending, overdue, dueToday, highPri, stale } = data;
  if (!pending.length) return "Nothing on your list right now. Add something with: task: [description]";

  // Overdue — name the oldest one specifically
  if (overdue.length) {
    const oldest = overdue[0];
    const age    = Math.floor((Date.now() - new Date(oldest.createdAt)) / 86400000);
    const more   = overdue.length > 1 ? ` (${overdue.length - 1} more overdue after that)` : '';
    const relGoal = goals.find(g => (g.linkedTaskIds || []).includes(oldest.id));
    const goalNote = relGoal ? ` It connects to your "${relGoal.title}" goal.` : '';
    return `"${oldest.title}" has been waiting the longest${age > 3 ? ` — ${age} days` : ''}. Start there.${more}${goalNote}`;
  }

  // Due today
  if (dueToday.length) {
    if (dueToday.length === 1) return `"${dueToday[0].title}" is due today. That's your focus.`;
    return `${dueToday.length} things due today. "${dueToday[0].title}" first.`;
  }

  // High priority or top pending
  const top = highPri[0] || [...pending].sort((a, b) => a.priority - b.priority)[0];
  if (top) {
    const age     = Math.floor((Date.now() - new Date(top.createdAt)) / 86400000);
    const relGoal = goals.find(g => (g.linkedTaskIds || []).includes(top.id));
    const goalNote = relGoal ? ` Moves your "${relGoal.title}" goal forward (${relGoal.progress}% there).` : '';
    const ageNote  = age > 3 ? ` It's been open ${age} days.` : '';
    return `"${top.title}" is the most important thing on your list.${ageNote}${goalNote}`;
  }

  return `${pending.length} things open. No clear priority set — pick one and start.`;
}

function _offlineProgress(data) {
  const { completedToday, completedThisWeek, pending, overdue, streak, completed } = data;

  if (!completedToday.length && !completedThisWeek.length) {
    if (overdue.length) return `Nothing completed this week, and ${overdue.length > 1 ? overdue.length + ' tasks are' : 'one task is'} overdue. Worth pushing something over the line today.`;
    return `Nothing completed this week yet. You have ${pending.length} things open — pick one.`;
  }

  const parts = [];
  if (completedToday.length) parts.push(`${completedToday.length} done today`);
  if (completedThisWeek.length > completedToday.length) {
    parts.push(`${completedThisWeek.length - completedToday.length} more earlier this week`);
  }
  let response = parts.join(', ') + '.';
  if (streak > 2) response += ` ${streak}-day streak — that's real momentum.`;
  else if (streak === 2) response += ' Two days in a row.';
  if (overdue.length) response += ` Still ${overdue.length} thing${overdue.length !== 1 ? 's' : ''} overdue, though.`;
  return response;
}

function _offlineSummary(data, goals) {
  const { pending, overdue, dueToday, sessions, recurringTopics, streak, completedThisWeek, allNotes } = data;
  const sentences = [];

  // Task state
  if (overdue.length) {
    sentences.push(`${overdue.length} task${overdue.length !== 1 ? 's' : ''} overdue — "${overdue[0].title}" is the oldest.`);
  } else if (dueToday.length) {
    sentences.push(`${dueToday.length} thing${dueToday.length !== 1 ? 's' : ''} due today.`);
  } else {
    sentences.push(`${pending.length} open task${pending.length !== 1 ? 's' : ''}, none overdue.`);
  }

  // Progress
  if (streak > 1) sentences.push(`${streak}-day completion streak.`);
  else if (completedThisWeek.length) sentences.push(`${completedThisWeek.length} done this week.`);

  // Goals
  if (goals.length) {
    const active = goals.filter(g => g.progress < 100).slice(0, 2);
    if (active.length) sentences.push(`Working toward: ${active.map(g => `"${g.title}" (${g.progress}%)`).join(', ')}.`);
  }

  // Patterns
  if (recurringTopics.length) {
    sentences.push(`"${recurringTopics[0].topic}" keeps coming up — ${recurringTopics[0].count} times now.`);
  }

  // Continuity
  if (sessions.length) {
    sentences.push(`Last time: ${sessions[0].content.replace(/^Session:\s*/i, '').slice(0, 100)}…`);
  }

  return sentences.join(' ');
}

function _offlineRecommendation(data, goals) {
  const { pending, overdue, dueToday, highPri, stale, recurringTopics } = data;

  if (!pending.length) return "Nothing to work on. Add something with: task: [description]";

  if (overdue.length) {
    const oldest = overdue[0];
    const age = Math.floor((Date.now() - new Date(oldest.createdAt)) / 86400000);
    const more = overdue.length > 1 ? ` Then clear the other ${overdue.length - 1}.` : '';
    return `"${oldest.title}" first — it's been overdue for ${age} day${age !== 1 ? 's' : ''} and that's costing you attention.${more}`;
  }

  if (dueToday.length) {
    return `"${dueToday[0].title}" — it's due today.${dueToday.length > 1 ? ` Also: ${dueToday.slice(1).map(t => `"${t.title}"`).join(', ')}.` : ''}`;
  }

  const top = highPri[0] || [...pending].sort((a, b) => a.priority - b.priority)[0];
  if (top) {
    const age     = Math.floor((Date.now() - new Date(top.createdAt)) / 86400000);
    const relGoal = goals.find(g => (g.linkedTaskIds || []).includes(top.id));
    const ageNote  = age > 5 ? ` It's been open ${age} days — worth finishing or dropping.` : '';
    const goalNote = relGoal ? ` Part of your "${relGoal.title}" goal.` : '';
    return `"${top.title}" is your best next move.${ageNote}${goalNote}`;
  }

  return `${stale.length > 0 ? `${stale.length} thing${stale.length !== 1 ? 's' : ''} have been open over a week — worth a review.` : `${pending.length} things open. Pick the one that moves you forward most.`}`;
}

function _offlineGoals(data, goals) {
  if (!goals.length) return "No active goals yet. Say \"I'm working toward [goal]\" or use goal: [title] to create one.";

  const lines = [];
  goals.forEach(g => {
    const progress = g.linkedCount
      ? `${g.progress}% — ${g.completedCount} of ${g.linkedCount} tasks done`
      : 'no tasks linked yet';
    const due = g.targetDate
      ? `, target ${new Date(g.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : '';
    lines.push(`"${g.title}" — ${progress}${due}.`);
  });
  return lines.join('\n');
}

function _offlineMemories(data) {
  const { facts, sessions, recurringTopics } = data;

  if (!facts.length && !sessions.length) {
    return "Nothing stored yet. Tell me things you want to remember and I'll hold onto them.";
  }

  const sentences = [];

  if (recurringTopics.length) {
    const top = recurringTopics[0];
    sentences.push(`"${top.topic}" has come up ${top.count} times — that seems important to you.`);
    if (recurringTopics.length > 1) {
      sentences.push(`Also recurring: ${recurringTopics.slice(1, 3).map(t => `"${t.topic}"`).join(', ')}.`);
    }
  }

  if (facts.length) {
    const recent = [...facts].sort((a, b) => (b.updatedAt || b.timestamp) > (a.updatedAt || a.timestamp) ? 1 : -1).slice(0, 3);
    sentences.push(`Most recent: ${recent.map(m => `"${m.content.slice(0, 55)}"`).join(' · ')}.`);
  }

  if (sessions.length) {
    sentences.push(`Last session: ${sessions[0].content.replace(/^Session:\s*/i, '').slice(0, 100)}.`);
  }

  return sentences.join(' ');
}

function _offlineTasks(data) {
  const { pending, overdue, dueToday, stale, completed } = data;

  if (!pending.length) return `Nothing open. ${completed.length} task${completed.length !== 1 ? 's' : ''} completed so far. Add one with: task: [text]`;

  const sentences = [];

  if (overdue.length) {
    sentences.push(`${overdue.length} overdue: ${overdue.slice(0, 2).map(t => `"${t.title}"`).join(', ')}${overdue.length > 2 ? ` +${overdue.length - 2} more` : ''}.`);
  }
  if (dueToday.length) {
    sentences.push(`Due today: ${dueToday.map(t => `"${t.title}"`).join(', ')}.`);
  }
  if (!overdue.length && !dueToday.length) {
    const top = [...pending].sort((a, b) => a.priority - b.priority)[0];
    sentences.push(`Top priority: "${top.title}".`);
  }
  if (stale.length) {
    sentences.push(`${stale.length} thing${stale.length !== 1 ? 's' : ''} open over a week — might be worth a cleanup.`);
  }

  return sentences.join(' ');
}

function _offlineNotes(data) {
  const { allNotes } = data;

  if (!allNotes.length) return 'No notes yet. Use note: [text] to save one.';

  const pinned = allNotes.filter(n => n.pinned);
  const recent = [...allNotes].sort((a, b) => b.updatedAt > a.updatedAt ? 1 : -1).slice(0, 3);
  const sentences = [`${allNotes.length} note${allNotes.length !== 1 ? 's' : ''} saved.`];
  if (pinned.length) sentences.push(`Pinned: ${pinned.map(n => `"${n.title || 'Untitled'}"`).join(', ')}.`);
  sentences.push(`Most recent: ${recent.map(n => `"${n.title || 'Untitled'}"`).join(', ')}.`);
  return sentences.join(' ');
}

async function _offlineCommitments(data) {
  const unresolved = await _getUnresolvedCommitments(data);
  if (!unresolved.length) return "No unresolved commitments on record. You're following through.";
  if (unresolved.length === 1) return `You said you'd ${unresolved[0]} — still open.`;
  return `${unresolved.length} things you committed to and haven't finished yet:\n${unresolved.map(c => `• ${c}`).join('\n')}`;
}

function _offlineHelp() {
  return [
    'Here\'s what I can do without a Gemini key:',
    '',
    'Ask me about your **tasks**, **goals**, **memories**, or **progress** — I\'ll pull from what you\'ve actually stored.',
    '',
    'Shortcuts that work anywhere:',
    '• **task: [text]** — add a task (natural due dates work: "tomorrow", "Friday", "June 30")',
    '• **note: [text]** — save a note',
    '• **goal: [title]** — set a goal',
    '',
    'Natural language:',
    '• "Remind me to call the dentist Friday"',
    '• "Remember that my exam is Thursday"',
    '• "I\'m working toward finishing the project"',
    '',
    'Questions that work offline:',
    '• "What should I focus on?"',
    '• "How\'s my progress this week?"',
    '• "What have I been thinking about?"',
    '• "Any commitments I haven\'t kept?"',
    '',
    'Add a Gemini key in Settings for full AI conversation.',
  ].join('\n');
}

function _offlineGeneral(data, goals) {
  const { pending, overdue, recurringTopics } = data;
  const lines = [];
  if (overdue.length) {
    lines.push(`${overdue.length} overdue task${overdue.length !== 1 ? 's' : ''}: "${overdue[0].title}" is the oldest.`);
  } else if (pending.length) {
    const top = [...pending].sort((a, b) => a.priority - b.priority)[0];
    lines.push(`${pending.length} open tasks. Top: "${top.title}".`);
  }
  if (goals.length) lines.push(formatGoalsBrief(goals));
  if (recurringTopics.length) lines.push(`"${recurringTopics[0].topic}" comes up often.`);
  if (!lines.length) lines.push("What's on your mind?");
  return lines.join('\n');
}

// ── Phase 2: Dynamic idle suggestions ─────────────────────────

async function _getIdleSuggestions() {
  try {
    const [data, goals] = await Promise.all([_loadUserData(), getGoalsWithProgress()]);
    const { overdue, pending, recurringTopics, sessions } = data;
    const suggestions = [];

    if (overdue.length)
      suggestions.push(`Work on "${overdue[0].title}"?`);
    else if (pending.length) {
      const top = [...pending].sort((a, b) => a.priority - b.priority)[0];
      suggestions.push(`Continue "${top.title}"?`);
    }

    if (recurringTopics.length)
      suggestions.push(`Update on "${recurringTopics[0].topic}"?`);

    if (goals.length) {
      const incomplete = goals.filter(g => g.progress < 100);
      if (incomplete.length)
        suggestions.push(`Check on "${incomplete[0].title}"?`);
    }

    if (sessions.length)
      suggestions.push('Pick up where we left off?');

    const fallbacks = ['What should I focus on?', "How's my progress?", 'Plan my day', 'Any commitments I missed?'];
    while (suggestions.length < 4) {
      const f = fallbacks.shift();
      if (f && !suggestions.includes(f)) suggestions.push(f);
    }
    return suggestions.slice(0, 4);
  } catch {
    return ["What should I focus on?", "How's my progress?", 'Plan my day', 'What are my goals?'];
  }
}

// ── Action marker parser ──────────────────────────────────────

const ACTION_RE = /\[(SAVE_MEMORY|CREATE_TASK|CREATE_NOTE|COMPLETE_TASK|CREATE_GOAL|COMPLETE_GOAL):\s*["“]([^"”]+)["”]\]/g;

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
      showToast('◈ Remembered', 'success', 2200);
      break;
    }
    case 'CREATE_TASK': {
      const { clean, date, phrase } = parseDueDate(value);
      const title  = (clean || value).trim().slice(0, 80);
      const taskId = await DB.tasks.create({ title, dueDate: date });
      Bus.emit(EVENTS.TASK_CREATED, { id: taskId, title });
      await logEvent(EVENT_TYPES.TASK_CREATED, `Task: ${title}`);
      showToast(`◉ Task: "${title.slice(0, 40)}"${phrase ? ` · ${phrase}` : ''}`, 'success', 2500);
      break;
    }
    case 'CREATE_NOTE': {
      const [title, ...rest] = value.split('|');
      const content = rest.join('|').trim() || title.trim();
      const id = await DB.notes.create({ title: title.trim().slice(0, 60), content });
      Bus.emit(EVENTS.NOTE_CREATED, { id, title: title.trim() });
      await logEvent(EVENT_TYPES.NOTE_CREATED, `Note: ${title.trim().slice(0, 60)}`);
      showToast(`◇ Note: "${title.trim().slice(0, 35)}"`, 'success', 2500);
      break;
    }
    case 'COMPLETE_TASK': {
      const all    = await DB.tasks.getAll();
      const target = all.find(t => t.id === value || t.title.toLowerCase().includes(value.toLowerCase()));
      if (target && target.status !== 'completed') {
        await DB.tasks.update(target.id, { status: 'completed', completedAt: new Date().toISOString() });
        Bus.emit(EVENTS.TASK_COMPLETED, { id: target.id, title: target.title });
        await logEvent(EVENT_TYPES.TASK_COMPLETED, `Done: ${target.title}`);
        showToast(`✓ "${target.title.slice(0, 40)}"`, 'success', 2500);
      }
      break;
    }
    case 'CREATE_GOAL': {
      const { clean, date } = parseDueDate(value);
      await createGoal(clean || value, '', date);
      break;
    }
    case 'COMPLETE_GOAL': {
      const allGoals = await DB.goals.getActive();
      const g = allGoals.find(g => g.title.toLowerCase().includes(value.toLowerCase()));
      if (g) {
        await DB.goals.update(g.id, { status: 'completed' });
        showToast(`◎ Goal achieved: "${g.title}"`, 'success', 3000);
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

async function _createTaskWithDate(title, date, phrase) {
  try {
    const id = await DB.tasks.create({ title: title.slice(0, 80), dueDate: date });
    Bus.emit(EVENTS.TASK_CREATED, { id, title });
    await logEvent(EVENT_TYPES.TASK_CREATED, `Task: ${title}`);
    showToast(`◉ Task: "${title.slice(0, 40)}"${phrase ? ` · ${phrase}` : ''}`, 'success', 2500);
    const relGoal = await findRelatedGoal(title);
    let goalNote  = '';
    if (relGoal) { await linkTaskToGoal(relGoal.id, id); goalNote = ` Linked to "${relGoal.title}".`; }
    return `Added: "${title}"${phrase ? `. Due: ${phrase}.` : '.'}${goalNote}`;
  } catch { return "Couldn't add that task."; }
}

// ── Utility functions ─────────────────────────────────────────

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
  if (diff < 3600000) return 'earlier today';
  if (days === 0)     return 'earlier today';
  if (days === 1)     return 'yesterday';
  if (days < 7)       return `${days} days ago`;
  if (days < 14)      return 'last week';
  if (days < 30)      return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function _taskAge(task) {
  const days = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 86400000);
  if (days === 0) return 'added today';
  if (days === 1) return '1 day old';
  return `${days} days old`;
}

function _detectRecurringTopics(memories, minCount = 2) {
  const freq = {}, lastTs = {};
  const skip = new Set([
    'the','and','for','that','this','with','have','from','about','been',
    'they','will','your','what','when','user','nova','just','also','more',
    'some','into','than','then','were','said','like','even','well','back',
    'would','could','should','task','note','memory','mentioned','session',
  ]);
  for (const m of memories) {
    if (m.type === 'session_summary') continue;
    const words = m.content.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !skip.has(w));
    for (const w of new Set(words)) {
      freq[w] = (freq[w] || 0) + 1;
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
    completedTasks.filter(t => t.completedAt).map(t => new Date(t.completedAt).toDateString()),
  )].sort((a, b) => new Date(a) - new Date(b));
  if (!dates.length) return 0;
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const last      = dates[dates.length - 1];
  if (last !== today && last !== yesterday) return 0;
  let streak = 1;
  for (let i = dates.length - 2; i >= 0; i--) {
    if ((new Date(dates[i + 1]) - new Date(dates[i])) / 86400000 === 1) streak++;
    else break;
  }
  return streak;
}

// ── Panel renderer ────────────────────────────────────────────

export function renderConversationPanel() {
  const content = document.getElementById('panel-content');
  if (!content) return;

  if (!_messages.length) {
    // Async idle suggestions — render placeholder first, then update
    const placeholderId = 'conv-suggestions-' + Date.now();
    content.innerHTML = `
      <div class="conv-empty">
        <div class="conv-empty-icon">◎</div>
        <p class="conv-empty-title">NOVA</p>
        <p class="conv-empty-desc">${hasGeminiKey()
          ? 'AI connected. Talk naturally.'
          : 'Analyzing your data. Ask about tasks, goals, or priorities.'
        }</p>
        <div class="conv-suggestions" id="${placeholderId}">
          <button class="conv-suggest" data-q="What should I focus on?">Focus</button>
          <button class="conv-suggest" data-q="How's my progress?">Progress</button>
          <button class="conv-suggest" data-q="Give me a summary">Summary</button>
          <button class="conv-suggest" data-q="What are my goals?">Goals</button>
        </div>
      </div>`;

    // Wire placeholder buttons
    _wireSuggestionButtons(content);

    // Replace with personalized suggestions async
    _getIdleSuggestions().then(suggestions => {
      const container = document.getElementById(placeholderId);
      if (!container) return;
      container.innerHTML = suggestions
        .map(s => `<button class="conv-suggest" data-q="${s.replace(/"/g, '&quot;')}">${s}</button>`)
        .join('');
      _wireSuggestionButtons(content);
    }).catch(() => {});
    return;
  }

  content.innerHTML = `<div class="conv-list">${_messages.map(_renderMessage).join('')}</div>`;
  requestAnimationFrame(() => { content.scrollTop = content.scrollHeight; });
}

function _wireSuggestionButtons(content) {
  content.querySelectorAll('.conv-suggest').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('nova-input');
      if (input) { input.value = btn.dataset.q; input.focus(); }
    });
  });
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
  if (State.get('activeView') === 'chat' && State.get('panelOpen')) renderConversationPanel();
}

function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
