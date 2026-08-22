// Wulan Core — capability registry.
// Capabilities are the only approved boundary for external actions.
export class CapabilityRegistry {
  constructor() { this.capabilities = new Map(); }

  register(definition) {
    if (!definition?.id || !definition?.name || typeof definition.execute !== 'function') {
      throw new TypeError('Capability requires id, name and execute()');
    }
    if (this.capabilities.has(definition.id)) {
      throw new Error(`Capability already registered: ${definition.id}`);
    }
    const capability = {
      version: '1.0',
      description: '',
      risk: 'read',
      permissions: [],
      inputSchema: null,
      verify: null,
      ...definition
    };
    this.capabilities.set(capability.id, capability);
    return capability;
  }

  get(id) { return this.capabilities.get(id) ?? null; }

  list() {
    return [...this.capabilities.values()].map(({ execute, verify, ...metadata }) => metadata);
  }

  async invoke(id, input, context = {}) {
    const capability = this.get(id);
    if (!capability) throw new Error(`Unknown capability: ${id}`);
    return capability.execute(input, context);
  }

  async verify(id, result, expected, context = {}) {
    const capability = this.get(id);
    if (!capability) throw new Error(`Unknown capability: ${id}`);
    if (typeof capability.verify !== 'function') return { verified: true, method: 'unavailable' };
    const verified = await capability.verify(result, expected, context);
    return { verified: Boolean(verified), method: 'capability' };
  }
}
