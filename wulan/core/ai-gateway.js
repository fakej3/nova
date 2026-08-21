// Wulan AI Gateway — provider-neutral model boundary.
// Providers are adapters. Wulan Core never depends directly on one vendor/model.
export class WulanAIGateway {
  constructor() {
    this.providers = new Map();
    this.defaultProvider = null;
  }

  registerProvider({ id, name, generate, capabilities = [], priority = 100 }) {
    if (!id || !name || typeof generate !== 'function') throw new TypeError('AI provider requires id, name and generate()');
    if (this.providers.has(id)) throw new Error(`AI provider already registered: ${id}`);
    const provider = { id, name, generate, capabilities: [...capabilities], priority };
    this.providers.set(id, provider);
    if (!this.defaultProvider) this.defaultProvider = id;
    return provider;
  }

  setDefaultProvider(id) {
    if (!this.providers.has(id)) throw new Error(`Unknown AI provider: ${id}`);
    this.defaultProvider = id;
  }

  listProviders() {
    return [...this.providers.values()]
      .sort((a, b) => a.priority - b.priority)
      .map(({ generate, ...metadata }) => metadata);
  }

  async generate(request, { providerId } = {}) {
    if (providerId) {
      const provider = this.providers.get(providerId);
      if (!provider) throw new Error(`Unknown AI provider: ${providerId}`);
      return provider.generate(request);
    }

    const ordered = [...this.providers.values()].sort((a, b) => a.priority - b.priority);
    if (!ordered.length) throw new Error('No AI provider is configured');

    const preferred = this.providers.get(this.defaultProvider);
    const candidates = preferred ? [preferred, ...ordered.filter(p => p.id !== preferred.id)] : ordered;
    let lastError = null;

    for (const provider of candidates) {
      try {
        return await provider.generate(request);
      } catch (error) {
        lastError = error;
        // A 503 means the provider is not configured on the server. It is safe
        // to try another provider. Real provider failures are surfaced instead
        // of silently multiplying paid requests.
        if (error?.status !== 503) throw error;
      }
    }

    throw lastError ?? new Error('No AI provider is configured');
  }
}
