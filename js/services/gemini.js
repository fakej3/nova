/**
 * NOVA Gemini API Service
 *
 * Wraps the Gemini 2.0 Flash REST API.
 * Key is stored in DB.settings + localStorage for fast reads.
 *
 * Usage:
 *   setGeminiKey(key)            — store key
 *   hasGeminiKey()               — check if key is set
 *   callGemini(history, prompt)  — make a chat completion
 */

const MODEL    = 'gemini-2.0-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 15_000;

const LS_KEY = 'nova_gemini_key';

let _key            = '';
let _callCount      = 0;
let _lastSource     = null;
let _lastCallAt     = null;
let _lastResponseMs = null;
let _lastSuccessAt  = null;
let _lastFailAt     = null;
let _lastFailMsg    = null;
let _lastStatus     = null;
let _lastTokensIn   = null;
let _lastTokensOut  = null;

export function getGeminiStats() {
  return {
    model:          MODEL,
    endpoint:       ENDPOINT,
    callCount:      _callCount,
    lastSource:     _lastSource,
    lastCallAt:     _lastCallAt,
    lastResponseMs: _lastResponseMs,
    lastSuccessAt:  _lastSuccessAt,
    lastFailAt:     _lastFailAt,
    lastFailMsg:    _lastFailMsg,
    lastStatus:     _lastStatus,
    lastTokensIn:   _lastTokensIn,
    lastTokensOut:  _lastTokensOut,
  };
}

export function resetGeminiStats() {
  _callCount = 0; _lastSource = null; _lastCallAt = null;
  _lastResponseMs = null; _lastSuccessAt = null; _lastFailAt = null;
  _lastFailMsg = null; _lastStatus = null; _lastTokensIn = null; _lastTokensOut = null;
}

// ── Key management ────────────────────────────────────────────

export function setGeminiKey(key) {
  _key = (key ?? '').trim();
  try { localStorage.setItem(LS_KEY, _key); } catch {}
}

export function getGeminiKey() {
  if (!_key) {
    try { _key = localStorage.getItem(LS_KEY) || ''; } catch {}
  }
  return _key;
}

export function hasGeminiKey() {
  return !!getGeminiKey();
}

// ── API call ──────────────────────────────────────────────────

/**
 * @param {Array<{role:'user'|'nova', text:string}>} history
 *   Full conversation history. Last item must be the user's latest message.
 * @param {string} systemPrompt  — NOVA persona + live context
 * @returns {Promise<string>}    — raw model text (may contain action markers)
 */
export async function callGemini(history, systemPrompt, source = 'chat') {
  const key = getGeminiKey();
  if (!key) throw new Error('NO_KEY');

  _callCount++;
  _lastSource = source;
  _lastCallAt = new Date().toISOString();
  console.log(`[Gemini] call #${_callCount} — source: "${source}"`);


  // Convert to Gemini format. Gemini requires alternating user/model turns,
  // ending on a user turn. Filter consecutive same-role messages by keeping last.
  const cleaned = [];
  for (const msg of history) {
    const role = msg.role === 'nova' ? 'model' : 'user';
    if (cleaned.length && cleaned[cleaned.length - 1].role === role) {
      // Merge consecutive same-role messages
      cleaned[cleaned.length - 1].parts[0].text += '\n' + msg.text;
    } else {
      cleaned.push({ role, parts: [{ text: msg.text }] });
    }
  }

  // Gemini requires the last message to be 'user'
  if (!cleaned.length || cleaned[cleaned.length - 1].role !== 'user') {
    throw new Error('Conversation must end with a user message');
  }

  const body = {
    contents: cleaned,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature:     0.72,
      maxOutputTokens: 600,
      topK:            40,
      topP:            0.95,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  const t0  = Date.now();
  const res = await _fetchWithTimeout(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  _lastStatus = res.status;

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    let errBody = null;
    try {
      errBody = await res.json();
      errMsg  = errBody?.error?.message || errMsg;
    } catch {}

    _lastFailAt  = new Date().toISOString();
    _lastFailMsg = errMsg;
    console.warn(`[Gemini] error — status: ${res.status}, body:`, errBody ?? errMsg);

    if (res.status === 400) throw new Error('BAD_REQUEST: ' + errMsg);
    if (res.status === 401 || res.status === 403) throw new Error('INVALID_KEY');
    if (res.status === 429) {
      // Single retry after 1s — free-tier quota sometimes recovers immediately
      console.warn('[Gemini] 429 rate limit — retrying in 1s');
      await new Promise(r => setTimeout(r, 1000));
      const retry = await _fetchWithTimeout(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      _lastStatus = retry.status;
      if (!retry.ok) {
        _lastFailAt  = new Date().toISOString();
        _lastFailMsg = `HTTP ${retry.status} (retry)`;
        throw new Error('RATE_LIMIT');
      }
      const retryData = await retry.json();
      const retryText = retryData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!retryText) throw new Error('EMPTY_RESPONSE');
      _lastResponseMs = Date.now() - t0;
      _lastSuccessAt  = new Date().toISOString();
      _recordTokens(retryData);
      console.log(`[Gemini] retry succeeded in ${_lastResponseMs}ms`);
      return retryText;
    }
    throw new Error('API_ERROR: ' + errMsg);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    _lastFailAt  = new Date().toISOString();
    _lastFailMsg = 'empty response';
    throw new Error('EMPTY_RESPONSE');
  }

  _lastResponseMs = Date.now() - t0;
  _lastSuccessAt  = new Date().toISOString();
  _recordTokens(data);
  console.log(`[Gemini] responded in ${_lastResponseMs}ms | in: ${_lastTokensIn ?? '?'} out: ${_lastTokensOut ?? '?'} tokens`);
  return text;
}

function _fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .then(r  => { clearTimeout(timer); return r; })
    .catch(e => { clearTimeout(timer); throw e.name === 'AbortError' ? new Error('TIMEOUT') : e; });
}

function _recordTokens(data) {
  const usage = data?.usageMetadata;
  if (usage) {
    _lastTokensIn  = usage.promptTokenCount    ?? null;
    _lastTokensOut = usage.candidatesTokenCount ?? null;
  }
}
