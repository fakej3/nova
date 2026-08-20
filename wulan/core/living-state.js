export const LIVING_STATES = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  REMEMBERING: 'remembering',
  ACTING: 'acting',
  LEARNING: 'learning',
  ERROR: 'error'
});

const ENERGY = Object.freeze({
  idle: 0.18,
  listening: 0.45,
  thinking: 0.9,
  remembering: 0.62,
  acting: 1,
  learning: 0.74,
  error: 0.25
});

export class WulanLivingState {
  constructor() {
    this.state = LIVING_STATES.IDLE;
    this.previous = null;
    this.reason = 'boot';
    this.attention = 0.35;
    this.energy = ENERGY.idle;
    this.focus = 'you';
    this.activity = 'Listening for you.';
    this.startedAt = Date.now();
    this.changedAt = Date.now();
    this.listeners = new Set();
    this.decayTimer = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return {
      state: this.state,
      previous: this.previous,
      reason: this.reason,
      attention: this.attention,
      energy: this.energy,
      focus: this.focus,
      activity: this.activity,
      changedAt: this.changedAt
    };
  }

  transition(next, { reason = 'interaction', focus = this.focus, activity } = {}) {
    if (!Object.values(LIVING_STATES).includes(next)) throw new Error(`Unknown Wulan state: ${next}`);
    this.previous = this.state;
    this.state = next;
    this.reason = reason;
    this.focus = focus;
    this.energy = ENERGY[next];
    this.attention = next === 'idle' ? 0.35 : next === 'listening' ? 0.82 : next === 'error' ? 0.2 : 0.62 + this.energy * 0.3;
    this.activity = activity ?? this.activity;
    this.changedAt = Date.now();
    this.#notify();
    return this.snapshot();
  }

  pulse({ attention = this.attention, focus = this.focus } = {}) {
    this.attention = Math.min(1, Math.max(0, attention));
    this.focus = focus;
    this.#notify();
  }

  decayToIdle(delay = 1800) {
    clearTimeout(this.decayTimer);
    this.decayTimer = setTimeout(() => {
      if (this.state !== LIVING_STATES.IDLE && this.state !== LIVING_STATES.LISTENING) {
        this.transition(LIVING_STATES.IDLE, { reason: 'completed', activity: 'Listening for you.' });
      }
    }, delay);
  }

  #notify() {
    const snapshot = this.snapshot();
    this.listeners.forEach(listener => listener(snapshot));
  }
}

export class WulanLocalPersistence {
  constructor(key = 'wulan.private.core.v1') {
    this.key = key;
  }

  load(core) {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return { memories: 0, learning: 0 };
      const saved = JSON.parse(raw);
      let memories = 0;
      let learning = 0;
      for (const entry of saved.memories ?? []) {
        if (!entry?.id || !entry?.content || !entry?.type) continue;
        core.memory.entries.set(entry.id, entry);
        memories += 1;
      }
      for (const record of saved.learning ?? []) {
        if (!record?.id || !record?.outcome || !record?.context) continue;
        core.learning.records.push(record);
        learning += 1;
      }
      return { memories, learning };
    } catch {
      return { memories: 0, learning: 0 };
    }
  }

  save(core) {
    try {
      localStorage.setItem(this.key, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        memories: core.memory.list({ limit: 500 }),
        learning: core.learning.recent(500)
      }));
      return true;
    } catch {
      return false;
    }
  }
}
