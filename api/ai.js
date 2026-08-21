const MODELS = {
  gemini: process.env.GEMINI_MODEL || 'gemini-3.7-flash',
  openai: process.env.OPENAI_MODEL || 'gpt-5.4',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
};

function normalizeMessages(messages = []) {
  return messages
    .map(message => ({
      role: message.role === 'assistant' || message.role === 'model' ? 'assistant' : 'user',
      text: String(message.content ?? message.text ?? '').trim(),
    }))
    .filter(message => message.text);
}

function configured(provider) {
  return provider === 'gemini'
    ? !!process.env.GEMINI_API_KEY
    : provider === 'openai'
      ? !!process.env.OPENAI_API_KEY
      : provider === 'anthropic'
        ? !!process.env.ANTHROPIC_API_KEY
        : false;
}

async function callGemini(messages, system) {
  const key = process.env.GEMINI_API_KEY;
  const model = MODELS.gemini;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.text }],
  }));

  const response = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system || defaultSystem() }] },
      contents,
      generationConfig: { maxOutputTokens: 1200 },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(response.status, data?.error?.message || `GEMINI_${response.status}`);
  const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  if (!text) throw providerError(502, 'EMPTY_MODEL_RESPONSE');
  return { text, model, usage: data?.usageMetadata ?? null };
}

async function callOpenAI(messages, system) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODELS.openai,
      instructions: system || defaultSystem(),
      input: messages.map(message => ({
        role: message.role,
        content: [{ type: 'input_text', text: message.text }],
      })),
      max_output_tokens: 1200,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(response.status, data?.error?.message || `OPENAI_${response.status}`);
  const text = data?.output_text?.trim();
  if (!text) throw providerError(502, 'EMPTY_MODEL_RESPONSE');
  return { text, model: MODELS.openai, usage: data?.usage ?? null };
}

async function callAnthropic(messages, system) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELS.anthropic,
      max_tokens: 1200,
      system: system || defaultSystem(),
      messages: messages.map(message => ({ role: message.role, content: message.text })),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(response.status, data?.error?.message || `ANTHROPIC_${response.status}`);
  const text = data?.content?.filter(part => part.type === 'text').map(part => part.text).join('').trim();
  if (!text) throw providerError(502, 'EMPTY_MODEL_RESPONSE');
  return { text, model: MODELS.anthropic, usage: data?.usage ?? null };
}

function providerError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function defaultSystem() {
  return 'You are Wulan, a private personal operating environment. Be concise, useful and honest. Do not claim an action happened unless Wulan actually performed it.';
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      providers: Object.keys(MODELS).map(id => ({
        id,
        model: MODELS[id],
        configured: configured(id),
      })),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const body = req.body ?? {};
  const provider = body.provider || 'gemini';
  if (!Object.hasOwn(MODELS, provider)) return res.status(400).json({ error: 'UNKNOWN_PROVIDER' });
  if (!configured(provider)) return res.status(503).json({ error: 'AI_PROVIDER_NOT_CONFIGURED', provider });

  const messages = normalizeMessages(body.messages);
  if (!messages.length || messages.at(-1).role !== 'user') {
    return res.status(400).json({ error: 'LAST_MESSAGE_MUST_BE_USER' });
  }

  try {
    const result = provider === 'gemini'
      ? await callGemini(messages, body.system)
      : provider === 'openai'
        ? await callOpenAI(messages, body.system)
        : await callAnthropic(messages, body.system);

    return res.status(200).json({ ...result, provider });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return res.status(status).json({ error: error instanceof Error ? error.message : String(error), provider });
  }
}
