/**
 * NOVA Orb UI
 * State machine for the central orb animation.
 * All state changes are CSS class swaps on #orb-container.
 */

import { State } from '../core/state.js';

const VALID_STATES = ['idle', 'listening', 'thinking', 'speaking', 'offline'];

let _container = null;
let _statusText = null;

const STATE_LABELS = {
  idle:      'Ready',
  listening: 'Listening...',
  thinking:  'Thinking...',
  speaking:  'Speaking...',
  offline:   'Offline',
};

export function initOrb() {
  _container  = document.getElementById('orb-container');
  _statusText = document.getElementById('orb-status-text');
  setOrbState('idle');
}

export function setOrbState(newState) {
  if (!VALID_STATES.includes(newState)) {
    console.warn(`[Orb] Unknown state: "${newState}"`);
    return;
  }

  if (!_container) return;

  VALID_STATES.forEach((s) => _container.classList.remove(`state-${s}`));
  _container.classList.add(`state-${newState}`);

  State.set('orbState', newState);

  if (_statusText) {
    const connectivity = State.get('connectivity');
    if (!connectivity) {
      _statusText.textContent = 'Offline · Local mode';
    } else {
      _statusText.textContent = `Online · ${STATE_LABELS[newState] ?? newState}`;
    }
  }
}

export function getOrbState() {
  return State.get('orbState');
}

/**
 * Fires a one-shot celebration animation (3 pulses).
 * Automatically removes the class when done.
 */
export function pulseOrb() {
  if (!_container) return;
  _container.classList.remove('orb-celebrate');
  // Force reflow to restart the animation
  void _container.offsetWidth;
  _container.classList.add('orb-celebrate');

  // orb-celebrate runs 3 iterations × 0.6s = 1.8s
  setTimeout(() => _container.classList.remove('orb-celebrate'), 1900);
}
