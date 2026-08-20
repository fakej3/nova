export const LIVING_STATES = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  REMEMBERING: 'remembering',
  ACTING: 'acting',
  LEARNING: 'learning',
  ERROR: 'error'
});

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export class WulanLivingState {
  constructor(initial = {}) {
    this.state = initial.state ?? LIVING_STATES.IDLE;
    this.attention = clamp(initial.attention ?? 0.18);
    this.energy = clamp(initial.energy ?? 0.22);
    this.focus = initial.focus ?? null;
    this.activity = initial.activity ?? 'Listening for you.';
    this.listeners = new Set();
    this.idleTimer = null;
  }

  snapshot() {
    return Object.freeze({
      state: this.state,
      attention: this.attention,
      energy: this.energy,
      focus: this.focus,
      activity: this.activity
    });
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  transition(state, patch = {}) {
    if (!Object.values(LIVING_STATES).includes(state)) throw new TypeError(`Unknown living state: ${state}`);
    this.state = state;
    this.attention = clamp(patch.attention ?? this.attention);
    this.energy = clamp(patch.energy ?? this.energy);
    this.focus = patch.focus ?? this.focus;
    this.activity = patch.activity ?? patch.reason ?? this.activity;
    this.#notify();
    return this.snapshot();
  }

  pulse(patch = {}) {
    this.attention = clamp(patch.attention ?? this.attention + 0.03);
    this.energy = clamp(patch.energy ?? this.energy + 0.02);
    if (patch.focus !== undefined) this.focus = patch.focus;
    if (patch.activity) this.activity = patch.activity;
    this.#notify();
    return this.snapshot();
  }

  decayToIdle(delay = 1200) {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.transition(LIVING_STATES.IDLE, {
        attention: Math.max(0.12, this.attention * 0.45),
        energy: Math.max(0.16, this.energy * 0.55),
        activity: 'Listening for you.'
      });
    }, delay);
  }

  #notify() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* UI listeners must not break the core. */ }
    }
  }
}

export class WulanLocalPersistence {
  constructor(key = 'wulan-local-v1') {
    this.key = key;
  }

  save(core) {
    try {
      const payload = {
        memories: core.memory?.list?.({ limit: 5000 }) ?? [],
        learning: core.learning?.recent?.(5000) ?? []
      };
      localStorage.setItem(this.key, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  load(core) {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return { memories: 0, learning: 0 };
      const payload = JSON.parse(raw);
      let memories = 0;
      let learning = 0;
      for (const memory of Array.isArray(payload.memories) ? payload.memories : []) {
        try { core.remember(memory); memories += 1; } catch { /* skip malformed local data */ }
      }
      for (const record of Array.isArray(payload.learning) ? payload.learning : []) {
        try { core.learning?.record(record); learning += 1; } catch { /* skip malformed local data */ }
      }
      return { memories, learning };
    } catch {
      return { memories: 0, learning: 0 };
    }
  }
}
