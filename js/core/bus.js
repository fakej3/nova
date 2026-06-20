/**
 * NOVA Internal Event Bus
 * Decouples modules — no module imports directly from another module.
 * All cross-module communication goes through Bus.emit / Bus.on.
 */

const _listeners = new Map();

export const Bus = {
  on(event, handler) {
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(handler);
  },

  off(event, handler) {
    _listeners.get(event)?.delete(handler);
  },

  emit(event, data) {
    _listeners.get(event)?.forEach((fn) => {
      try {
        fn(data);
      } catch (err) {
        console.error(`[Bus] Handler error on "${event}":`, err);
      }
    });
  },
};

/**
 * Canonical event names used across NOVA.
 * Import this object anywhere to avoid magic strings.
 */
export const EVENTS = {
  // Notes
  NOTE_CREATED:  'note:created',
  NOTE_UPDATED:  'note:updated',
  NOTE_DELETED:  'note:deleted',

  // Tasks
  TASK_CREATED:   'task:created',
  TASK_UPDATED:   'task:updated',
  TASK_COMPLETED: 'task:completed',
  TASK_DELETED:   'task:deleted',

  // App
  THEME_CHANGED:  'theme:changed',
  VIEW_CHANGED:   'view:changed',
  PANEL_TOGGLE:   'panel:toggle',
  EVENT_LOGGED:   'event:logged',
  SETTINGS_SAVED: 'settings:saved',
  APP_READY:      'app:ready',

  // Connectivity
  ONLINE:         'connectivity:online',
  OFFLINE:        'connectivity:offline',

  // Install
  FIRST_ACTION:   'user:first_action',

  // Memory (Phase 2)
  MEMORY_CREATED: 'memory:created',
  MEMORY_UPDATED: 'memory:updated',
  MEMORY_DELETED: 'memory:deleted',

  // Orb
  ORB_STATE_CHANGED: 'orb:state_changed',
};
