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

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const LS_KEY = 'nova_gemini_key';

let _key = '';

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
export async function callGemini(history, systemPrompt) {
  const key = getGeminiKey();
  if (!key) throw new Error('NO_KEY');

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

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const errData = await res.json();
      errMsg = errData?.error?.message || errMsg;
    } catch {}

    if (res.status === 400) throw new Error('BAD_REQUEST: ' + errMsg);
    if (res.status === 401 || res.status === 403) throw new Error('INVALID_KEY');
    if (res.status === 429) throw new Error('RATE_LIMIT');
    throw new Error('API_ERROR: ' + errMsg);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('EMPTY_RESPONSE');
  return text;
}
