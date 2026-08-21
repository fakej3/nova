export async function generateGemini({ messages = [], system = '', maxOutputTokens = 1200 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const error = new Error('AI_PROVIDER_NOT_CONFIGURED'); error.status = 503; throw error; }
  const model = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const contents = messages.map(message => ({ role:message.role === 'assistant' ? 'model' : 'user', parts:[{ text:String(message.content ?? message.text ?? '') }] }));
  const response = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ systemInstruction:{parts:[{text:system}]}, contents, generationConfig:{maxOutputTokens} }) });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) { const error = new Error(data?.error?.message || `GEMINI_${response.status}`); error.status=response.status; throw error; }
  const text = data?.candidates?.[0]?.content?.parts?.map(part=>part.text||'').join('').trim();
  if (!text) { const error=new Error('EMPTY_MODEL_RESPONSE'); error.status=502; throw error; }
  return { text, model, usage:data?.usageMetadata ?? null };
}
