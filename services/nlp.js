/**
 * NOVA Natural Language Processing Service
 *
 * Pure string → structured data. Zero external dependencies.
 *
 * Exports:
 *   parseDueDate(text)       → { date, confidence, clean, phrase }
 *   detectTaskIntent(text)   → { isTask, title, confidence }
 *   detectMemoryIntent(text) → { isMemory, confidence }
 *   detectCommitment(text)   → { isCommitment, action, timeframe }
 *   detectGoalIntent(text)   → { isGoal, title, confidence }
 *   expandKeywords(kws)      → string[]   (synonym expansion)
 *   scoreMemory(mem, kws)    → number
 */

// ── Date parsing ──────────────────────────────────────────────

const DAYS  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const MONTHS = ['january','february','march','april','may','june',
                'july','august','september','october','november','december'];
const MON3  = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

/**
 * Find and extract a due date from a string.
 * Returns:
 *   date       — ISO string, or null if none found
 *   confidence — 'high' | null
 *   clean      — original text with the date phrase removed
 *   phrase     — the matched substring
 */
export function parseDueDate(text) {
  const today = _midnight();

  const rules = [
    // Relative ranges
    { re: /\btonight\b|\bthis evening\b/i,       resolve: () => today                          },
    { re: /\btoday\b/i,                           resolve: () => today                          },
    { re: /\btomorrow\b/i,                        resolve: () => _offset(today, 1)              },
    { re: /\bin (\d+) days?\b/i,                  resolve: m  => _offset(today, +m[1])          },
    { re: /\bin a week\b|\bnext week\b/i,         resolve: () => _offset(today, 7)              },
    { re: /\bin (\d+) weeks?\b/i,                 resolve: m  => _offset(today, +m[1] * 7)      },
    { re: /\bin a month\b|\bnext month\b/i,       resolve: () => _offsetMonth(today, 1)         },
    { re: /\bthis weekend\b/i,                    resolve: () => _nextWeekday(today, 6)         },
    { re: /\bend of (?:the )?week\b/i,            resolve: () => _nextWeekday(today, 5)         },
    { re: /\bend of (?:the )?month\b/i,           resolve: () => _endOfMonth(today)             },
    // Named day (next occurrence or "next Monday")
    { re: /\b(?:next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      resolve: m => _nextWeekday(today, DAYS.indexOf(m[1].toLowerCase())) },
    // "June 30" / "June 30th"
    { re: /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
      resolve: m => _nextMonthDay(today, MONTHS.indexOf(m[1].toLowerCase()), +m[2]) },
    // "30th June"
    { re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
      resolve: m => _nextMonthDay(today, MONTHS.indexOf(m[2].toLowerCase()), +m[1]) },
    // "Jan 30"
    { re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
      resolve: m => _nextMonthDay(today, MON3.indexOf(m[1].toLowerCase()), +m[2]) },
    // MM/DD or MM/DD/YYYY
    { re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/,
      resolve: m => {
        const yr = m[3] ? +m[3] : today.getFullYear();
        const d  = new Date(yr, +m[1] - 1, +m[2]);
        if (d < today && !m[3]) d.setFullYear(d.getFullYear() + 1);
        return d;
      }
    },
  ];

  for (const { re, resolve } of rules) {
    const match = text.match(re);
    if (!match) continue;
    const date  = resolve(match);
    const clean = text.replace(match[0], '').replace(/\s{2,}/g, ' ').trim();
    return { date: date.toISOString(), confidence: 'high', clean, phrase: match[0] };
  }

  return { date: null, confidence: null, clean: text, phrase: null };
}

function _midnight() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function _offset(base, days) {
  const d = new Date(base); d.setDate(d.getDate() + days); return d;
}
function _offsetMonth(base, months) {
  const d = new Date(base); d.setMonth(d.getMonth() + months); return d;
}
function _endOfMonth(base) {
  return new Date(base.getFullYear(), base.getMonth() + 1, 0);
}
function _nextWeekday(base, target) {
  const d = new Date(base);
  let diff = target - d.getDay();
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}
function _nextMonthDay(base, month, day) {
  const d = new Date(base.getFullYear(), month, day);
  if (d <= base) d.setFullYear(d.getFullYear() + 1);
  return d;
}

// ── Task intent ───────────────────────────────────────────────

const TASK_PATTERNS = [
  { re: /^(?:remind me to|reminder to|reminder:)\s+(.+)/i,           conf: 'high'   },
  { re: /^don'?t (?:let me forget|forget)(?: to)?\s+(.+)/i,          conf: 'high'   },
  { re: /^(?:create|add|make)(?: a)? task(?:(?: to)|(?: for))?:?\s+(.+)/i, conf: 'high' },
  { re: /^(?:todo?|to-do):?\s+(.+)/i,                                conf: 'high'   },
  { re: /^(?:i need to|i have to|i must)\s+(.+)/i,                   conf: 'high'   },
  { re: /^(?:need to|have to|must)\s+(.+)/i,                         conf: 'medium' },
  { re: /^(?:i'm going to|i am going to|i'?ll)\s+(.+)/i,             conf: 'medium' },
  { re: /^(?:schedule|book|plan)(?: a| an| my)?\s+(.+)/i,            conf: 'medium' },
];

/** Returns { isTask, title, confidence } */
export function detectTaskIntent(text) {
  for (const { re, conf } of TASK_PATTERNS) {
    const m = text.match(re);
    if (m) return { isTask: true, title: m[1].trim(), confidence: conf };
  }
  return { isTask: false, title: '', confidence: null };
}

// ── Memory intent ─────────────────────────────────────────────

/** Returns { isMemory, confidence } */
export function detectMemoryIntent(text) {
  // Explicit save signals
  if (/^(?:remember (?:that |this )?|save this:?|note this:?|fyi:?|heads up:?)/i.test(text))
    return { isMemory: true, confidence: 'high' };

  // "My X is…"
  if (/^my .{2,30} (?:is|are|was|will be)\b/i.test(text))
    return { isMemory: true, confidence: 'high' };

  // Preferences / habits
  if (/^i (?:prefer|like|hate|love|dislike|enjoy|always|never)\b/i.test(text))
    return { isMemory: true, confidence: 'high' };

  // Emotional state
  if (/^i'?m (?:worried|concerned|scared|nervous|excited|stressed|anxious) (?:about|that)\b/i.test(text))
    return { isMemory: true, confidence: 'high' };

  // Scheduled event with a date signal
  if (/\b(?:exam|test|interview|appointment|meeting|deadline|birthday|anniversary)\b/i.test(text) &&
      /\b(?:on|this|next|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d+)\b/i.test(text))
    return { isMemory: true, confidence: 'high' };

  // Goal statements
  if (/\bmy (?:goal|target|aim|objective)(?: is| this (?:week|month|year))?\b/i.test(text))
    return { isMemory: true, confidence: 'high' };

  return { isMemory: false, confidence: null };
}

// ── Commitment detection ──────────────────────────────────────

const COMMIT_PATTERNS = [
  /\bi'?ll\s+(.{5,100}?)(?:\s+(?:tonight|today|tomorrow|by|before|this (?:week|evening|morning)).{0,30})?$/i,
  /\bi will\s+(.{5,100})/i,
  /\bi'?m going to\s+(.{5,100})/i,
  /\bi promise (?:to )?(.{5,100})/i,
  /\bi(?:'m| am) (?:planning|going) to\s+(.{5,100})/i,
  /\bcommitted to\s+(.{5,100})/i,
  /\bi intend to\s+(.{5,100})/i,
];

const TIMEFRAME_RE = /\b(tonight|today|tomorrow|this (?:week|evening|morning|afternoon)|by (?:friday|monday|tomorrow|tonight|end of (?:the )?week)|in (?:a few days|a week))\b/i;

/** Returns { isCommitment, action, timeframe } */
export function detectCommitment(text) {
  for (const re of COMMIT_PATTERNS) {
    const m = text.match(re);
    if (!m || !m[1]) continue;
    const action = m[1].trim().replace(/[.,!?]+$/, '').slice(0, 120);
    if (action.split(/\s+/).length < 2) continue;    // too short to be meaningful
    const tf = text.match(TIMEFRAME_RE);
    return { isCommitment: true, action, timeframe: tf ? tf[0] : null };
  }
  return { isCommitment: false, action: '', timeframe: null };
}

// ── Goal intent ───────────────────────────────────────────────

const GOAL_PATTERNS = [
  { re: /^(?:goal:?\s+|my goal (?:is |for \S+ )?:?\s*)(.+)/i,             conf: 'high'   },
  { re: /^(?:create|add|set)(?: a)? goal(?:(?: to)|(?: of)|(?: for))?:?\s+(.+)/i, conf: 'high' },
  { re: /^(?:i want to achieve|i'?m working (?:toward|towards))\s+(.+)/i, conf: 'high'   },
  { re: /^(?:objective|target|aim):?\s+(.+)/i,                             conf: 'medium' },
];

/** Returns { isGoal, title, confidence } */
export function detectGoalIntent(text) {
  for (const { re, conf } of GOAL_PATTERNS) {
    const m = text.match(re);
    if (m) return { isGoal: true, title: m[1].trim().slice(0, 80), confidence: conf };
  }
  return { isGoal: false, title: '', confidence: null };
}

// ── Synonym expansion (Phase 5) ───────────────────────────────

const SYNONYM_GROUPS = [
  ['exam','test','quiz','examination','assessment','midterm','finals','viva','exams','tests'],
  ['study','studying','revision','revise','review','learn','learning','practice','prep','prepare','preparation'],
  ['article','blog','post','content','writing','draft','essay','piece','publish','write'],
  ['crypto','bitcoin','binance','trading','trade','coin','token','blockchain','defi','nft','investment','invest'],
  ['deadline','due','overdue','expire','submit','submission','hand','deliver'],
  ['meeting','call','appointment','interview','presentation','standup','sync','conference'],
  ['money','budget','finance','financial','payment','bill','invoice','salary','income','expense','pay'],
  ['exercise','workout','gym','fitness','run','running','training','sport','health','yoga'],
  ['doctor','medical','sick','illness','medication','dentist','hospital','checkup','health'],
  ['work','job','career','office','professional','client','project','business'],
  ['family','mom','dad','parent','brother','sister','spouse','partner','friend','girlfriend','boyfriend'],
  ['goal','objective','target','aim','ambition','aspiration','milestone'],
  ['worry','worried','anxious','stress','stressed','nervous','concerned','afraid','anxiety'],
  ['finish','complete','done','finished','completed','submit','deliver','close','wrap'],
  ['note','notes','write','wrote','jot','journal','log','record','save','saved'],
];

/** Expand keywords with synonyms and light stemming. Returns deduped array. */
export function expandKeywords(keywords) {
  const out = new Set(keywords);

  for (const kw of keywords) {
    for (const group of SYNONYM_GROUPS) {
      if (group.includes(kw)) { group.forEach(s => out.add(s)); break; }
    }
    // Simple stem: strip trailing s / ing / ed and check group prefix matches
    const stems = [kw.replace(/s$/, ''), kw.replace(/ing$/, ''), kw.replace(/ed$/, '')];
    for (const stem of stems) {
      if (stem === kw || stem.length < 3) continue;
      for (const group of SYNONYM_GROUPS) {
        if (group.some(s => s.startsWith(stem) || stem.startsWith(s))) {
          group.forEach(s => out.add(s));
          break;
        }
      }
    }
  }
  return [...out];
}

/** Score how relevant a memory is to a set of (already-expanded) keywords. */
export function scoreMemory(memory, expandedKeywords) {
  const hay = (memory.content + ' ' + (memory.tags || []).join(' ')).toLowerCase();
  return expandedKeywords.reduce((n, kw) => n + (hay.includes(kw) ? 1 : 0), 0);
}
