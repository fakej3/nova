// Wulan Core — capability registry.
export class CapabilityRegistry {
  constructor() { this.capabilities = new Map(); }
  register(definition) {
    if (!definition?.id || !definition?.name || typeof definition.execute !== 'function') throw new TypeError('Capability requires id, name and execute()');
    if (this.capabilities.has(definition.id)) throw new Error(`Capability already registered: ${definition.id}`);
    if (definition.inputSchema != null && typeof definition.inputSchema !== 'object') throw new TypeError('Capability inputSchema must be an object');
    const capability = { version:'1.0', description:'', permissions:[], inputSchema:null, risk:'read', ...definition };
    this.capabilities.set(capability.id, capability); return capability;
  }
  get(id) { return this.capabilities.get(id) ?? null; }
  list() { return [...this.capabilities.values()].map(({ execute, verify, ...metadata }) => metadata); }
  validateInput(capability, input = {}) {
    const schema = capability?.inputSchema;
    if (!schema) return { ok:true, value:input };
    if (schema.type === 'object' && (input == null || typeof input !== 'object' || Array.isArray(input))) return { ok:false, error:'INPUT_MUST_BE_OBJECT' };
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) if (!(key in input)) return { ok:false, error:`MISSING_INPUT:${key}` };
    if (schema.properties) {
      for (const [key, definition] of Object.entries(schema.properties)) {
        if (!(key in input)) continue;
        const value = input[key];
        if (definition.type === 'string' && typeof value !== 'string') return { ok:false, error:`INVALID_INPUT_TYPE:${key}` };
        if (definition.type === 'number' && typeof value !== 'number') return { ok:false, error:`INVALID_INPUT_TYPE:${key}` };
        if (definition.type === 'boolean' && typeof value !== 'boolean') return { ok:false, error:`INVALID_INPUT_TYPE:${key}` };
        if (definition.pattern && typeof value === 'string' && !(new RegExp(definition.pattern).test(value))) return { ok:false, error:`INVALID_INPUT_PATTERN:${key}` };
      }
    }
    return { ok:true, value:input };
  }
  async invoke(id,input,context={}) {
    const capability=this.get(id); if(!capability) throw new Error(`Unknown capability: ${id}`);
    const validation=this.validateInput(capability,input);
    if(!validation.ok) throw new Error(validation.error);
    return capability.execute(validation.value,context);
  }
}