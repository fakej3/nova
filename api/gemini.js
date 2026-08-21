const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'GEMINI_NOT_CONFIGURED' });
    return;
  }

  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = typeof body.system === 'string' ? body.system : '';

    const contents = [];
    for (const message of messages) {
      const role = message?.role === 'assistant' || message?.role === 'model' ? 'model' : 'user';
      const text = String(message?.content ?? message?.text ?? '').trim();
      if (!text) continue;
      if (contents.length && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += `\n${text}`;
      } else {
        contents.push({ role, parts: [{ text }] });
      }
    }

    if (!contents.length || contents[contents.length - 1].role !== 'user') {
      res.status(400).json({ error: 'INVALID_CONVERSATION' });
      return;
    }

    const upstream = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800,
          topK: 40,
          topP: 0.95,
        },
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: data?.error?.message || `GEMINI_HTTP_${upstream.status}`,
      });
      return;
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('')?.trim();
    if (!text) {
      res.status(502).json({ error: 'EMPTY_GEMINI_RESPONSE' });
      return;
    }

    res.status(200).json({
      text,
      model: MODEL,
      usage: data?.usageMetadata || null,
    });
  } catch (error) {
    console.error('[Wulan Gemini]', error);
    res.status(500).json({ error: 'GEMINI_PROXY_ERROR' });
  }
}
