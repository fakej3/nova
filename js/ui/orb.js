/**
 * NOVA Orb — Enhanced State Machine
 * 6-state AI core: idle, listening, thinking, responding, success, error.
 * Smooth CSS transitions, auto-restore for transient states, Bus events.
 */

import { State }          from '../core/state.js';
import { Bus, EVENTS }    from '../core/bus.js';

// All valid states (canonical names)
const VALID_STATES = ['idle', 'listening', 'thinking', 'responding', 'success', 'error', 'offline'];

// Legacy alias — maps old name to canonical
const STATE_ALIAS = { speaking: 'responding' };

const STATE_LABELS = {
  idle:       'Ready',
  listening:  'Listening...',
  thinking:   'Processing...',
  responding: 'Responding...',
  success:    'Done',
  error:      'Error',
  offline:    'Offline · Local mode',
};

let _container    = null;
let _statusText   = null;
let _nameDisplay  = null;
let _transitioning = false;
let _restoreTimer  = null;

export function initOrb() {
  _container   = document.getElementById('orb-container');
  _statusText  = document.getElementById('orb-status-text');
  _nameDisplay = document.getElementById('ai-name-display');
  setOrbState('idle');
}

export function setOrbState(rawState) {
  const newState = STATE_ALIAS[rawState] ?? rawState;

  if (!VALID_STATES.includes(newState)) {
    console.warn(`[Orb] Unknown state: "${rawState}"`);
    return;
  }
  if (!_container) return;

  const current = State.get('orbState');
  if (current === newState) return;

  // Cancel any pending auto-restore
  clearTimeout(_restoreTimer);

  if (current && !_transitioning) {
    _transitioning = true;
    _container.classList.add('state-transitioning');
    setTimeout(() => {
      _applyState(newState);
      _container.classList.remove('state-transitioning');
      _transitioning = false;
    }, 120);
  } else {
    _applyState(newState);
  }

  // Transient states: auto-restore to idle after display
  if (newState === 'success') {
    _restoreTimer = setTimeout(() => setOrbState('idle'), 2500);
  } else if (newState === 'error') {
    _restoreTimer = setTimeout(() => setOrbState('idle'), 3000);
  }
}

function _applyState(state) {
  VALID_STATES.forEach(s => _container.classList.remove(`state-${s}`));
  _container.classList.add(`state-${state}`);
  State.set('orbState', state);
  _updateLabel(state);
  Bus.emit(EVENTS.ORB_STATE_CHANGED, { state });
}

function _updateLabel(state) {
  if (!_statusText) return;
  const online = State.get('connectivity');
  if (state === 'offline' || !online) {
    _statusText.textContent = 'Offline · Local mode';
  } else {
    _statusText.textContent = `Online · ${STATE_LABELS[state] ?? state}`;
  }
}

export function getOrbState() {
  return State.get('orbState');
}

export function updateOrbName(name) {
  if (_nameDisplay) _nameDisplay.textContent = name || 'NOVA';
}

/**
 * One-shot pulse animation.
 * variant='default' → 3-burst celebration
 * variant='error'   → shake + desaturate
 */
export function pulseOrb(variant = 'default') {
  if (!_container) return;
  const cls = variant === 'error' ? 'orb-pulse-error' : 'orb-celebrate';
  _container.classList.remove(cls);
  void _container.offsetWidth;
  _container.classList.add(cls);
  const dur = variant === 'error' ? 1500 : 1750;
  setTimeout(() => _container.classList.remove(cls), dur);
}
