/**
 * NOVA Orb UI
 * State machine for the central orb animation.
 * All state changes are CSS class swaps with a brief crossfade transition.
 */

import { State } from '../core/state.js';

const VALID_STATES = ['idle', 'listening', 'thinking', 'speaking', 'offline'];

const STATE_LABELS = {
  idle:      'Ready',
  listening: 'Listening...',
  thinking:  'Processing...',
  speaking:  'Speaking...',
  offline:   'Offline · Local mode',
};

let _container  = null;
let _statusText = null;
let _nameDisplay = null;
let _transitioning = false;

export function initOrb() {
  _container   = document.getElementById('orb-container');
  _statusText  = document.getElementById('orb-status-text');
  _nameDisplay = document.getElementById('ai-name-display');
  setOrbState('idle');
}

export function setOrbState(newState) {
  if (!VALID_STATES.includes(newState)) {
    console.warn(`[Orb] Unknown state: "${newState}"`);
    return;
  }
  if (!_container) return;

  const current = State.get('orbState');
  if (current === newState) return;

  // Brief opacity dip between states for a clean crossfade feel
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
}

function _applyState(state) {
  VALID_STATES.forEach(s => _container.classList.remove(`state-${s}`));
  _container.classList.add(`state-${state}`);
  State.set('orbState', state);
  _updateLabel(state);
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

/**
 * Update the displayed AI name on the orb label.
 * Called when user changes the AI name in settings.
 */
export function updateOrbName(name) {
  if (_nameDisplay) {
    _nameDisplay.textContent = name || 'NOVA';
  }
}

/**
 * One-shot celebration pulse (3 bursts).
 * Automatically restores state when done.
 */
export function pulseOrb() {
  if (!_container) return;
  _container.classList.remove('orb-celebrate');
  void _container.offsetWidth; // force reflow to restart animation
  _container.classList.add('orb-celebrate');
  // 3 iterations × 0.55s = 1.65s
  setTimeout(() => _container.classList.remove('orb-celebrate'), 1750);
}
