const MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function normalizeHistory(messages = []) {
  return messages.map(message => ({
    role: message.role === 'assistant' || message.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(message.content ?? message.text ?? '') }],
  })).filter(message => message.parts[0].text.trim());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI_PROVIDER_NOT_CONFIGURED' });

  const { messages = [], system = '' } = req.body ?? {};
  const contents = normalizeHistory(messages);
  if (!contents.length || contents.at(-1).role !== 'user') {
    return res.status(400).json({ error: 'LAST_MESSAGE_MUST_BE_USER' });
  }

  try {
    const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: String(system || 'You are Wulan, a personal operating environment. Be concise, useful and honest about actions.') }] },
        contents,
        generationConfig: { maxOutputTokens: 1200 },
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || `GEMINI_${response.status}` });
    const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!text) return res.status(502).json({ error: 'EMPTY_MODEL_RESPONSE' });

    return res.status(200).json({
      text,
      model: MODEL,
      usage: data?.usageMetadata ?? null,
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
