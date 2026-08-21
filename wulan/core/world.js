// Wulan World Model
// The world is the substrate underneath the interface: entities, relations,
// capabilities and live observations. UI should render this state, not invent it.

const STORAGE_KEY = 'wulan_world_v1';

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

export class WulanWorld {
  constructor(seed = {}) {
    this.entities = new Map();
    this.relations = new Map();
    this.capabilities = new Map();
    this.observations = [];
    this.activities = [];
    this.hooks = new Set();
    this.hydrate(seed);
  }

  hydrate(snapshot = {}) {
    for (const entity of snapshot.entities ?? []) this.entities.set(entity.id, entity);
    for (const relation of snapshot.relations ?? []) this.relations.set(relation.id, relation);
    for (const capability of snapshot.capabilities ?? []) this.capabilities.set(capability.id, capability);
    this.observations = Array.isArray(snapshot.observations) ? snapshot.observations.slice(-200) : [];
    this.activities = Array.isArray(snapshot.activities) ? snapshot.activities.slice(-200) : [];
    return this;
  }

  subscribe(fn) { this.hooks.add(fn); return () => this.hooks.delete(fn); }

  emit(event, payload) {
    for (const hook of this.hooks) {
      try { hook({ event, payload, at: now() }); } catch {}
    }
  }

  upsertEntity(entity) {
    if (!entity?.id || !entity?.name || !entity?.kind) throw new TypeError('World entity requires id, name and kind');
    const existing = this.entities.get(entity.id) ?? {};
    const next = { status: 'unknown', metadata: {}, ...existing, ...entity, updatedAt: now() };
    this.entities.set(next.id, next);
    this.emit('entity.updated', next);
    return next;
  }

  relate(from, to, type, metadata = {}) {
    if (!this.entities.has(from) || !this.entities.has(to)) throw new Error('World relation requires existing entities');
    const relation = { id: id('rel'), from, to, type, metadata, createdAt: now() };
    this.relations.set(relation.id, relation);
    this.emit('relation.created', relation);
    return relation;
  }

  registerCapability(capability) {
    if (!capability?.id || !capability?.name || typeof capability.execute !== 'function') {
      throw new TypeError('World capability requires id, name and execute()');
    }
    const next = { risk: 'low', permissions: [], ...capability };
    this.capabilities.set(next.id, next);
    this.emit('capability.registered', { ...next, execute: undefined });
    return next;
  }

  async invoke(capabilityId, input = {}, context = {}) {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) throw new Error(`Unknown world capability: ${capabilityId}`);
    const started = now();
    this.activities.push({ id: id('act'), type: 'capability.started', capabilityId, input, startedAt: started });
    this.activities = this.activities.slice(-200);
    this.emit('capability.started', { capabilityId, input });
    try {
      const result = await capability.execute(input, { ...context, world: this });
      this.activities.push({ id: id('act'), type: 'capability.completed', capabilityId, result, startedAt: started, completedAt: now() });
      this.activities = this.activities.slice(-200);
      this.emit('capability.completed', { capabilityId, result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.activities.push({ id: id('act'), type: 'capability.failed', capabilityId, error: message, startedAt: started, completedAt: now() });
      this.activities = this.activities.slice(-200);
      this.emit('capability.failed', { capabilityId, error: message });
      throw error;
    }
  }

  observe(source, data) {
    const observation = { id: id('obs'), source, data, at: now() };
    this.observations.push(observation);
    this.observations = this.observations.slice(-200);
    this.emit('observation.created', observation);
    return observation;
  }

  snapshot() {
    return {
      version: 1,
      generatedAt: now(),
      entities: [...this.entities.values()],
      relations: [...this.relations.values()],
      capabilities: [...this.capabilities.values()].map(({ execute, ...metadata }) => metadata),
      observations: this.observations.slice(-50),
      activities: this.activities.slice(-50),
    };
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot())); } catch {}
  }

  static load(seed = {}) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return new WulanWorld({ ...seed, ...JSON.parse(raw) });
    } catch {}
    return new WulanWorld(seed);
  }
}

export function seedWulanWorld(world) {
  const entities = [
    ['wulan', 'Wulan', 'system', 'online'],
    ['sentinel', 'Sentinel', 'project', 'registered'],
    ['edgelab', 'EdgeLab', 'project', 'registered'],
    ['github', 'GitHub', 'integration', 'ready'],
    ['vercel', 'Vercel', 'integration', 'ready'],
    ['memory', 'Memory', 'system', 'ready'],
    ['context', 'Context', 'system', 'ready'],
    ['atlas', 'Atlas', 'agent', 'idle'],
    ['leon', 'Leon', 'agent', 'idle'],
    ['oracle', 'Oracle', 'agent', 'idle'],
    ['pixel', 'Pixel', 'agent', 'idle'],
  ];
  for (const [id, name, kind, status] of entities) world.upsertEntity({ id, name, kind, status });
  const relations = [
    ['wulan', 'memory', 'uses'], ['wulan', 'context', 'uses'],
    ['wulan', 'atlas', 'orchestrates'], ['wulan', 'leon', 'orchestrates'],
    ['wulan', 'oracle', 'orchestrates'], ['wulan', 'pixel', 'orchestrates'],
    ['wulan', 'sentinel', 'controls'], ['wulan', 'edgelab', 'controls'],
    ['wulan', 'github', 'connected_to'], ['wulan', 'vercel', 'connected_to'],
    ['leon', 'github', 'uses'], ['atlas', 'edgelab', 'uses'],
  ];
  const existingPairs = new Set([...world.relations.values()].map(r => `${r.from}:${r.to}:${r.type}`));
  for (const [from, to, type] of relations) if (!existingPairs.has(`${from}:${to}:${type}`)) world.relate(from, to, type);
  return world;
}
