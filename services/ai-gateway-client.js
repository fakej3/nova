// Browser-side adapters for Wulan's provider-neutral AI gateway.
// API keys never live in the browser; /api/ai owns provider credentials.

export function createRemoteProvider({ id, name, capabilities = [], priority = 100 }) {
  return {
    id,
    name,
    capabilities,
    priority,
    async generate(request = {}) {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          provider: id,
          messages: request.messages ?? [],
          system: request.system ?? '',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data?.error || `AI_${response.status}`);
        error.status = response.status;
        error.provider = id;
        throw error;
      }
      return data.text;
    },
  };
}
