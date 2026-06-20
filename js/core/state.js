/**
 * NOVA Shared State
 * Single source of truth for live runtime state.
 * Reactive: subscribers are notified on every set().
 * Does NOT persist — preferences come from DB.settings on boot.
 */

const _state = {
  theme:        'ironman',
  aiName:       'NOVA',
  userName:     '',
  orbState:     'idle',        // idle | listening | thinking | speaking | offline
  connectivity: true,
  activeView:   'home',        // home | notes | tasks | events
  panelOpen:    false,
  initialized:  false,
  autoTheme:    false,
  themeManualAt: null,         // ISO timestamp of last manual theme switch
};

const _subscribers = new Map();

export const State = {
  get(key) {
    return _state[key];
  },

  getAll() {
    return { ..._state };
  },

  set(key, value) {
    if (_state[key] === value) return;
    _state[key] = value;
    _subscribers.get(key)?.forEach((fn) => {
      try { fn(value); } catch (e) { console.error(`[State] subscriber error for "${key}":`, e); }
    });
    _subscribers.get('*')?.forEach((fn) => {
      try { fn(key, value); } catch (e) { console.error(`[State] wildcard subscriber error:`, e); }
    });
  },

  on(key, handler) {
    if (!_subscribers.has(key)) _subscribers.set(key, new Set());
    _subscribers.get(key).add(handler);
  },

  off(key, handler) {
    _subscribers.get(key)?.delete(handler);
  },
};
