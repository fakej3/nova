// Thin persistence API. The adapter behind this endpoint can later be backed by
// a real database/authenticated shared store without changing Wulan's core.
const memory = globalThis.__WULAN_PERSISTENCE__ ?? new Map();
globalThis.__WULAN_PERSISTENCE__ = memory;

function authorized(request) {
  // Prototype boundary only. Shared persistence must add real authentication
  // and per-user authorization before it is enabled for production data.
  return request.method === 'GET' || request.method === 'PUT' || request.method === 'DELETE';
}

export default async function handler(request, response) {
  if (!authorized(request)) return response.status(405).json({error:'Method not allowed'});
  const key = String(request.query?.key ?? request.body?.key ?? '').trim();
  if (!key || key.length > 256) return response.status(400).json({error:'Invalid persistence key'});

  if (request.method === 'GET') return response.status(200).json({value: memory.get(key) ?? null});
  if (request.method === 'DELETE') { memory.delete(key); return response.status(204).end(); }

  const value = request.body?.value;
  memory.set(key,value);
  return response.status(200).json({ok:true});
}
