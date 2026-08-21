/**
 * Wulan Gemini provider adapter.
 *
 * The browser talks only to /api/gemini. The Gemini API key stays in Vercel's
 * server-side environment and is never shipped to the client.
 */

const ENDPOINT = '/api/gemini';
const MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 30_000;

let _callCount = 0;
let _lastCallAt = null;
let _lastResponseMs = null;
let _lastSuccessAt = null;
let _lastFailAt = null;
let _lastFailMsg = null;
let _lastStatus = null;
let _lastTokensIn = null;
let _lastTokensOut = null;

export function getGeminiStats() {
  return { model: MODEL, endpoint: ENDPOINT, callCount: _callCount, lastCallAt: _lastCallAt, lastResponseMs: _lastResponseMs, lastSuccessAt: _lastSuccessAt, lastFailAt: _lastFailAt, lastFailMsg: _lastFailMsg, lastStatus: _lastStatus, lastTokensIn: _lastTokensIn, lastTokensOut: _lastTokensOut };
}

export function resetGeminiStats() {
  _callCount = 0; _lastCallAt = null; _lastResponseMs = null; _lastSuccessAt = null;
  _lastFailAt = null; _lastFailMsg = null; _lastStatus = null; _lastTokensIn = null; _lastTokensOut = null;
}

export function hasGeminiKey() {
  // The key is intentionally server-side. The endpoint is the readiness signal.
  return true;
}

export async function callGemini(messages, system = '', source = 'chat') {
  _callCount += 1;
  _lastCallAt = new Date().toISOString();
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system, source }),
      signal: controller.signal,
    });
    _lastStatus = res.status;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data?.error || `HTTP ${res.status}`;
      _lastFailAt = new Date().toISOString();
      _lastFailMsg = message;
      throw new Error(message);
    }
    const text = data?.text?.trim();
    if (!text) {
      _lastFailAt = new Date().toISOString();
      _lastFailMsg = 'EMPTY_RESPONSE';
      throw new Error('EMPTY_RESPONSE');
    }
    _lastResponseMs = Date.now() - started;
    _lastSuccessAt = new Date().toISOString();
    _lastTokensIn = data?.usage?.promptTokenCount ?? null;
    _lastTokensOut = data?.usage?.candidatesTokenCount ?? null;
    return text;
  } catch (error) {
    _lastResponseMs = Date.now() - started;
    if (!_lastFailAt) {
      _lastFailAt = new Date().toISOString();
      _lastFailMsg = error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.message || error);
    }
    throw error?.name === 'AbortError' ? new Error('TIMEOUT') : error;
  } finally {
    clearTimeout(timer);
  }
}
