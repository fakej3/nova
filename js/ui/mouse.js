/**
 * NOVA Mouse Reactive System
 * Tracks mouse position and applies layered parallax to the orb.
 * Each layer moves at a different rate to create depth.
 * Uses lerp for smooth, inertia-based motion.
 * Also passes normalized mouse position to the HUD canvas for
 * a subtle directional glow that follows the cursor.
 */

import { setHudMouseInfluence } from './hud.js';

const LERP_SPEED = 0.072;   // smoothing (lower = more lag = heavier feel)
const MAX_SHIFT  = 22;       // max px any layer can shift

let targetX = 0, targetY = 0;   // normalized -1..1
let currentX = 0, currentY = 0; // smoothed values

let _orbRect = null;
let _rafId   = null;
let _active  = true;

// Layer elements and their parallax multipliers.
// Positive = follows mouse, Negative = counter-moves (depth illusion)
const LAYERS = [
  { id: 'orb-field',            mul:  0.80 },  // furthest, follows most
  { id: 'orb-glow-outer',       mul:  0.55 },
  { id: 'orb-ring-3',           mul:  0.40 },
  { id: 'orb-ring-2',           mul:  0.28 },
  { id: 'orb-ring-1',           mul:  0.16 },
  { id: 'orb',                  mul: -0.08 },  // slight counter-move = depth
];

let _els     = [];
let _highlight = null;

export function initMouse() {
  _els = LAYERS.map(({ id, mul }) => ({
    el:  document.getElementById(id),
    mul,
  })).filter(({ el }) => el !== null);

  _highlight = document.getElementById('orb-sphere-highlight');

  _cacheRect();
  window.addEventListener('resize', _cacheRect, { passive: true });
  window.addEventListener('scroll', _cacheRect, { passive: true });

  document.addEventListener('mousemove',  _onMove,       { passive: true });
  document.addEventListener('mouseleave', _onLeave,      { passive: true });
  document.addEventListener('touchmove',  _onTouchMove,  { passive: true });

  // Respect reduced motion preference
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    _active = false;
    return;
  }

  _rafId = requestAnimationFrame(_tick);
}

function _cacheRect() {
  const c = document.getElementById('orb-container');
  if (c) _orbRect = c.getBoundingClientRect();
}

function _onMove(e) {
  if (!_orbRect || !_active) return;
  const cx = _orbRect.left + _orbRect.width  / 2;
  const cy = _orbRect.top  + _orbRect.height / 2;

  // Normalize over 45% of viewport — wider range = more responsive
  targetX = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth  * 0.45)));
  targetY = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight * 0.45)));
}

function _onLeave() {
  targetX = 0;
  targetY = 0;
}

function _onTouchMove(e) {
  if (!_orbRect || !_active) return;
  const t  = e.touches[0];
  if (!t) return;
  const cx = _orbRect.left + _orbRect.width  / 2;
  const cy = _orbRect.top  + _orbRect.height / 2;
  targetX  = Math.max(-1, Math.min(1, (t.clientX - cx) / (window.innerWidth  * 0.45)));
  targetY  = Math.max(-1, Math.min(1, (t.clientY - cy) / (window.innerHeight * 0.45)));
}

function _tick() {
  // Lerp toward target
  currentX += (targetX - currentX) * LERP_SPEED;
  currentY += (targetY - currentY) * LERP_SPEED;

  const dx = currentX;
  const dy = currentY;

  setHudMouseInfluence(currentX, currentY);

  // Skip tiny movements for parallax and light source
  if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) {
    _applyParallax(dx, dy);
    _applyLightSource(dx, dy);
  }

  _rafId = requestAnimationFrame(_tick);
}

function _applyParallax(dx, dy) {
  for (const { el, mul } of _els) {
    const x = dx * MAX_SHIFT * mul;
    const y = dy * MAX_SHIFT * mul;
    // Use the CSS `translate` property — independent from `transform` in the cascade.
    // CSS @keyframes animations set `transform` (scale/rotate); this sets `translate`.
    // Both apply simultaneously so orb animations are not disrupted.
    el.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
  }
}

function _applyLightSource(dx, dy) {
  if (!_highlight) return;
  // Sphere highlight simulates a moving light source.
  // When mouse is top-left, highlight moves top-left; bottom-right moves it away.
  const hx = 12 + dx * 22;  // base 12%, range -10% to 34%
  const hy = 6  + dy * 18;  // base 6%,  range -12% to 24%
  _highlight.style.left = `${hx}%`;
  _highlight.style.top  = `${hy}%`;
}
