// Wulan AI Gateway — provider-neutral model boundary.
// Providers are adapters. Wulan Core never depends directly on one vendor/model.
export class WulanAIGateway {
  constructor() { this.providers = new Map(); this.defaultProvider = null; }
  registerProvider({ id, name, generate, embed, capabilities = [] }) {
    if (!id || !name || typeof generate !== 'function') throw new TypeError('AI provider requires id, name and generate()');
    if (this.providers.has(id)) throw new Error(`AI provider already registered: ${id}`);
    const provider = { id, name, generate, embed: typeof embed === 'function' ? embed : null, capabilities: [...new Set(capabilities)] };
    this.providers.set(id, provider); if (!this.defaultProvider) this.defaultProvider = id; return provider;
  }
  setDefaultProvider(id) { if (!this.providers.has(id)) throw new Error(`Unknown provider: ${id}`); this.defaultProvider = id; }
  listProviders() { return [...this.providers.values()].map(({ generate, embed, ...metadata }) => ({ ...metadata, embedding: Boolean(embed) })); }
  async generate(request, { providerId } = {}) { const id = providerId ?? this.defaultProvider; const provider = this.providers.get(id); if (!provider) throw new Error('No AI provider is configured'); return provider.generate(request); }
  async embed(input, { providerId } = {}) { const id = providerId ?? this.defaultProvider; const provider = this.providers.get(id); if (!provider) throw new Error('No AI provider is configured'); if (!provider.embed) throw new Error(`Provider ${id} does not expose embeddings`); return provider.embed(input); }
}
