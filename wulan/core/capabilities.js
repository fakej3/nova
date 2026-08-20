// Wulan Core — capability registry.
// Capabilities are contracts, not implementations. Integrations can be written in
// any suitable language and exposed through an adapter later.

export class CapabilityRegistry {
  constructor() {
    this.capabilities = new Map();
  }

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
      permissions: [],
      inputSchema: null,
      ...definition,
    };
    this.capabilities.set(capability.id, capability);
    return capability;
  }

  get(id) {
    return this.capabilities.get(id) ?? null;
  }

  list() {
    return [...this.capabilities.values()].map(({ execute, ...metadata }) => metadata);
  }

  async invoke(id, input, context = {}) {
    const capability = this.get(id);
    if (!capability) throw new Error(`Unknown capability: ${id}`);

    // Permission enforcement will live here once the permission provider is wired.
    return capability.execute(input, context);
  }
}
