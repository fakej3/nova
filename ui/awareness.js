/**
 * NOVA Awareness System — Phase A
 * Tracks mouse velocity, typing cadence, idle time, and time of day.
 * Publishes a combined energy signal that drives orb renderer modulation.
 *
 * Idle levels:
 *   0 = active    (user recently interacted)
 *   1 = calm      (30s idle → animations soften)
 *   2 = sleep     (5min idle → animations at 50% speed)
 *
 * Time modifiers:
 *   Morning    0.95× — bright, awake
 *   Afternoon  1.0×  — neutral
 *   Evening    0.82× — warmer, softer
 *   Night      0.65× — dim, mysterious
 */

import { Bus, EVENTS } from '../core/bus.js';

// ── Config ────────────────────────────────────────────────────

const IDLE_CALM_MS  = 30_000;    // 30s → calm
const IDLE_SLEEP_MS = 300_000;   // 5min → sleep

const TIME_BANDS = [
  { start: 0,  end: 5,  mod: 0.62 },  // deep night
  { start: 5,  end: 9,  mod: 0.90 },  // early morning
  { start: 9,  end: 12, mod: 1.05 },  // morning peak
  { start: 12, end: 17, mod: 1.00 },  // afternoon
  { start: 17, end: 21, mod: 0.82 },  // evening
  { start: 21, end: 24, mod: 0.65 },  // night
];

// ── State ─────────────────────────────────────────────────────

let _mouseX = 0, _mouseY = 0;
let _prevMouseX = 0, _prevMouseY = 0;
let _mouseSpeed   = 0;   // 0–1, decays each frame
let _typingEnergy = 0;   // 0–1, spikes on keypress, decays

let _lastActivity = Date.now();
let _idleLevel    = 0;

let _timeModifier = 1.0;

let _rafId       = null;
let _initialized = false;

// ── Public API ─────────────────────────────────────────────────

export function initAwareness() {
  if (_initialized) return;
  _initialized = true;

  document.addEventListener('mousemove',  _onMouseMove, { passive: true });
  document.addEventListener('keydown',    _onKeyDown,   { passive: true });
  document.addEventListener('touchstart', _onTouch,     { passive: true });
  document.addEventListener('touchmove',  _onTouch,     { passive: true });
  document.addEventListener('click',      _resetIdle,   { passive: true });

  _updateTimeModifier();
  setInterval(_updateTimeModifier, 60_000);

  _rafId = requestAnimationFrame(_tick);
}

/**
 * Returns the current awareness snapshot.
 * Called each frame by hud.js, reactor.js, etc.
 */
export function getAwareness() {
  return {
    energy:       Math.min(1, _mouseSpeed * 0.55 + _typingEnergy * 0.45),
    mouseSpeed:   _mouseSpeed,
    typingEnergy: _typingEnergy,
    idleLevel:    _idleLevel,     // 0 | 1 | 2
    timeModifier: _timeModifier,  // 0.62–1.05
  };
}

// ── Input handlers ─────────────────────────────────────────────

function _onMouseMove(e) {
  _mouseX = e.clientX;
  _mouseY = e.clientY;
  _resetIdle();
}

function _onKeyDown() {
  // Each keypress injects a burst of typing energy
  _typingEnergy = Math.min(1, _typingEnergy + 0.15);
  _resetIdle();
}

function _onTouch(e) {
  const t = e.touches[0];
  if (t) { _mouseX = t.clientX; _mouseY = t.clientY; }
  _resetIdle();
}

function _resetIdle() {
  _lastActivity = Date.now();
  if (_idleLevel > 0) {
    _idleLevel = 0;
    Bus.emit(EVENTS.AWARENESS_CHANGED, { idleLevel: 0 });
  }
}

// ── Per-frame tick ─────────────────────────────────────────────

function _tick() {
  // Mouse speed — distance moved this frame, decays with drag
  const dx   = _mouseX - _prevMouseX;
  const dy   = _mouseY - _prevMouseY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  _mouseSpeed = Math.min(1, _mouseSpeed * 0.90 + dist * 0.015);
  _prevMouseX = _mouseX;
  _prevMouseY = _mouseY;

  // Typing decay — falls to zero ~4s after last keypress
  _typingEnergy *= 0.968;
  if (_typingEnergy < 0.004) _typingEnergy = 0;

  // Idle level check
  const idleMs   = Date.now() - _lastActivity;
  const prev     = _idleLevel;
  _idleLevel = idleMs >= IDLE_SLEEP_MS ? 2
             : idleMs >= IDLE_CALM_MS  ? 1
             : 0;

  if (_idleLevel !== prev) {
    Bus.emit(EVENTS.AWARENESS_CHANGED, { idleLevel: _idleLevel });
  }

  _rafId = requestAnimationFrame(_tick);
}

// ── Time of day ────────────────────────────────────────────────

function _updateTimeModifier() {
  const h = new Date().getHours();
  for (const { start, end, mod } of TIME_BANDS) {
    if (h >= start && h < end) { _timeModifier = mod; return; }
  }
  _timeModifier = 0.65;
}
