const clone = value => JSON.parse(JSON.stringify(value ?? null));
const contextId = () => `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export class WulanTeamContext {
  constructor({ persistence = null, maxEntries = 200 } = {}) {
    this.persistence = persistence;
    this.maxEntries = maxEntries;
    this.contexts = new Map();
    this.restore(persistence?.load?.()?.teamContexts ?? []);
  }

  create({ id = contextId(), name = 'Wulan team context', teamId = null, metadata = {} } = {}) {
    if (this.contexts.has(id)) throw new Error(`TEAM_CONTEXT_EXISTS: ${id}`);
    const context = { id, teamId, name: String(name), metadata: clone(metadata), facts: [], decisions: [], warnings: [], artifacts: [], updatedAt: new Date().toISOString() };
    this.contexts.set(id, context);
    this.#persist();
    return clone(context);
  }

  get(id) { const context = this.contexts.get(id); return context ? clone(context) : null; }

  ensure(id, options = {}) { return this.get(id) ?? this.create({ ...options, id }); }

  #write(id, collection, value, source = 'agent') {
    const context = this.contexts.get(id);
    if (!context) throw new Error(`UNKNOWN_TEAM_CONTEXT: ${id}`);
    const entry = { id: `${collection}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, value: clone(value), source: String(source), createdAt: new Date().toISOString() };
    context[collection].push(entry);
    if (context[collection].length > this.maxEntries) context[collection].splice(0, context[collection].length - this.maxEntries);
    context.updatedAt = new Date().toISOString();
    this.#persist();
    return clone(entry);
  }

  addFact(id, value, source) { return this.#write(id, 'facts', value, source); }
  addDecision(id, value, source) { return this.#write(id, 'decisions', value, source); }
  addWarning(id, value, source) { return this.#write(id, 'warnings', value, source); }
  addArtifact(id, value, source) { return this.#write(id, 'artifacts', value, source); }

  snapshot(id) { return this.get(id); }

  summarize(id, { limit = 20 } = {}) {
    const context = this.get(id);
    if (!context) throw new Error(`UNKNOWN_TEAM_CONTEXT: ${id}`);
    return { id: context.id, teamId: context.teamId, name: context.name, facts: context.facts.slice(-limit), decisions: context.decisions.slice(-limit), warnings: context.warnings.slice(-limit), artifacts: context.artifacts.slice(-limit), updatedAt: context.updatedAt };
  }

  #persist() {
    try { this.persistence?.saveTeamContexts?.(this.contexts); } catch {}
  }

  restore(snapshot = []) {
    this.contexts = new Map(Array.isArray(snapshot) ? snapshot.filter(item => item?.id).map(item => [item.id, clone(item)]) : []);
    return this.contexts.size;
  }

  recent(limit = 20) { return [...this.contexts.values()].slice(-limit).reverse().map(clone); }
}
