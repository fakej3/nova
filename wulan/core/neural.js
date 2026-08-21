/**
 * Wulan Neural Substrate
 *
 * This is intentionally NOT a fake LLM trainer. It is a small, inspectable
 * associative network that Wulan can grow from memories and feedback.
 *
 * Neurons represent concepts, memories, agents and learned preferences.
 * Synapses represent observed relationships. Activation is query-driven and
 * deterministic, so the UI can show real pathways instead of decorative motion.
 */

const STOP = new Set([
  'about','after','again','also','and','are','been','being','but','can','could','did','does','for','from','have','how','into','just','like','more','most','not','now','only','our','that','the','their','then','there','these','they','this','was','what','when','where','which','with','would','you','your','wulan'
]);

const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9_\- ]+/g, ' ').trim();

function terms(text, limit = 18) {
  return [...new Set(normalize(text).split(/\s+/).filter(word => word.length >= 3 && !STOP.has(word)))].slice(0, limit);
}

function idFor(type, key) {
  return `${type}:${normalize(key).replace(/\s+/g, '_').slice(0, 80)}`;
}

export class WulanNeuralSubstrate {
  constructor({ maxNeurons = 1200, maxSynapses = 5000 } = {}) {
    this.maxNeurons = maxNeurons;
    this.maxSynapses = maxSynapses;
    this.neurons = new Map();
    this.synapses = new Map();
    this.activations = [];
    this.updates = 0;
    this.lastTrace = [];
    this.lastInput = '';
  }

  ensureNeuron({ id, label, type = 'concept', strength = 0.5, tags = [] }) {
    if (!id) return null;
    const existing = this.neurons.get(id);
    if (existing) {
      existing.strength = clamp(Math.max(existing.strength, strength));
      existing.tags = [...new Set([...existing.tags, ...tags])].slice(0, 24);
      return existing;
    }
    const neuron = {
      id,
      label: String(label ?? id),
      type,
      strength: clamp(strength),
      activation: 0,
      visits: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [...new Set(tags)].slice(0, 24),
    };
    this.neurons.set(id, neuron);
    this.trim();
    return neuron;
  }

  connect(source, target, weight = 0.35, evidence = 1) {
    if (!source || !target || source === target) return null;
    const key = `${source}>${target}`;
    const existing = this.synapses.get(key);
    if (existing) {
      existing.weight = clamp(existing.weight * 0.72 + clamp(weight) * 0.28);
      existing.evidence += evidence;
      existing.updatedAt = new Date().toISOString();
      this.updates += 1;
      return existing;
    }
    const synapse = {
      id: key,
      source,
      target,
      weight: clamp(weight),
      evidence,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.synapses.set(key, synapse);
    this.updates += 1;
    this.trim();
    return synapse;
  }

  ingestMemory(memory) {
    if (!memory?.content) return null;
    const memoryId = idFor('memory', memory.id);
    const memoryNeuron = this.ensureNeuron({
      id: memoryId,
      label: memory.content.slice(0, 72),
      type: 'memory',
      strength: memory.importance ?? 0.5,
      tags: memory.tags ?? [],
    });
    const concepts = terms(`${memory.content} ${(memory.tags ?? []).join(' ')}`);
    concepts.forEach((term, index) => {
      const neuron = this.ensureNeuron({ id: idFor('concept', term), label: term, type: 'concept', strength: 0.35, tags: ['learned'] });
      this.connect(memoryNeuron.id, neuron.id, clamp((memory.confidence ?? 0.8) * (1 - index * 0.025), 0.08, 0.95), 1);
      this.connect(neuron.id, memoryNeuron.id, 0.18, 1);
    });
    return memoryNeuron;
  }

  ingestFeedback(record) {
    if (!record?.context) return null;
    const contextTerms = terms(record.context);
    const outcome = record.outcome ?? 'unknown';
    const agent = record.candidatePreference || 'general';
    const agentNeuron = this.ensureNeuron({ id: idFor('agent', agent), label: agent, type: 'agent', strength: 0.5, tags: ['routing'] });
    const delta = outcome === 'accepted' ? 0.12 : outcome === 'corrected' ? 0.06 : outcome === 'rejected' ? -0.1 : 0.02;
    agentNeuron.strength = clamp(agentNeuron.strength + delta);
    agentNeuron.visits += 1;
    agentNeuron.updatedAt = new Date().toISOString();

    for (const term of contextTerms) {
      const concept = this.ensureNeuron({ id: idFor('concept', term), label: term, type: 'concept', strength: 0.4, tags: ['feedback'] });
      this.connect(concept.id, agentNeuron.id, Math.max(0.05, 0.25 + delta), Math.abs(delta) * 10);
      this.connect(agentNeuron.id, concept.id, Math.max(0.04, 0.18 + delta * 0.6), Math.abs(delta) * 10);
    }
    return agentNeuron;
  }

  activate(input, { limit = 14 } = {}) {
    const query = terms(input);
    this.lastInput = String(input ?? '');
    const scores = new Map();
    for (const term of query) {
      const neuron = this.neurons.get(idFor('concept', term));
      if (neuron) scores.set(neuron.id, (scores.get(neuron.id) ?? 0) + 1);
    }

    for (const [id, score] of [...scores]) {
      const source = this.neurons.get(id);
      if (!source) continue;
      source.activation = clamp(score / Math.max(1, query.length));
      source.visits += 1;
      source.updatedAt = new Date().toISOString();
      for (const synapse of this.synapses.values()) {
        if (synapse.source !== id) continue;
        scores.set(synapse.target, (scores.get(synapse.target) ?? 0) + source.activation * synapse.weight);
      }
    }

    const ranked = [...scores.entries()]
      .map(([id, score]) => ({ neuron: this.neurons.get(id), score }))
      .filter(item => item.neuron)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const neuron of this.neurons.values()) neuron.activation *= 0.84;
    ranked.forEach(({ neuron, score }) => { neuron.activation = clamp(score); });
    this.lastTrace = ranked.map(({ neuron, score }) => ({ id: neuron.id, label: neuron.label, type: neuron.type, activation: clamp(score) }));
    this.activations.push({ timestamp: new Date().toISOString(), input: this.lastInput, trace: this.lastTrace });
    if (this.activations.length > 100) this.activations.shift();
    return this.lastTrace;
  }

  predict(input) {
    const trace = this.activate(input, { limit: 24 });
    const agents = trace.filter(node => node.type === 'agent');
    if (!agents.length) return { agent: 'general', confidence: 0.2, trace };
    const best = agents[0];
    return { agent: best.label, confidence: clamp(best.activation), trace };
  }

  snapshot({ limit = 80 } = {}) {
    const neurons = [...this.neurons.values()]
      .sort((a, b) => (b.activation - a.activation) || (b.strength - a.strength))
      .slice(0, limit);
    const ids = new Set(neurons.map(neuron => neuron.id));
    const synapses = [...this.synapses.values()]
      .filter(edge => ids.has(edge.source) && ids.has(edge.target))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, Math.min(this.maxSynapses, limit * 3));
    return {
      neurons: neurons.map(neuron => ({ ...neuron })),
      synapses: synapses.map(edge => ({ ...edge })),
      trace: this.lastTrace.map(item => ({ ...item })),
      lastInput: this.lastInput,
      updates: this.updates,
    };
  }

  stats() {
    return {
      neurons: this.neurons.size,
      synapses: this.synapses.size,
      activations: this.activations.length,
      updates: this.updates,
      active: [...this.neurons.values()].filter(n => n.activation > 0.18).length,
      concepts: [...this.neurons.values()].filter(n => n.type === 'concept').length,
      memories: [...this.neurons.values()].filter(n => n.type === 'memory').length,
      agents: [...this.neurons.values()].filter(n => n.type === 'agent').length,
    };
  }

  exportState() {
    return {
      neurons: [...this.neurons.values()],
      synapses: [...this.synapses.values()],
      activations: this.activations,
      updates: this.updates,
    };
  }

  importState(state) {
    this.neurons.clear();
    this.synapses.clear();
    for (const neuron of Array.isArray(state?.neurons) ? state.neurons : []) this.neurons.set(neuron.id, { ...neuron });
    for (const synapse of Array.isArray(state?.synapses) ? state.synapses : []) this.synapses.set(synapse.id, { ...synapse });
    this.activations = Array.isArray(state?.activations) ? state.activations.slice(-100) : [];
    this.updates = Number(state?.updates ?? 0);
    return this.stats();
  }

  trim() {
    while (this.neurons.size > this.maxNeurons) {
      const victim = [...this.neurons.values()].sort((a, b) => (a.activation + a.strength) - (b.activation + b.strength))[0];
      if (!victim) break;
      this.neurons.delete(victim.id);
      for (const [key, edge] of this.synapses) if (edge.source === victim.id || edge.target === victim.id) this.synapses.delete(key);
    }
    while (this.synapses.size > this.maxSynapses) {
      const victim = [...this.synapses.values()].sort((a, b) => a.weight - b.weight)[0];
      if (!victim) break;
      this.synapses.delete(victim.id);
    }
  }
}
