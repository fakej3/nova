/**
 * NOVA Reactor Core — Phase B
 * Procedural canvas renderer injected into #orb.
 * Layers: background nebula → energy rings → radial flow lines →
 *         orbiting flow particles → core glow point.
 *
 * Replaces the CSS #orb-core element entirely.
 * State-aware and awareness-aware: energy level drives brightness/activity.
 * Skips animation on prefers-reduced-motion.
 */

import { Bus, EVENTS }   from '../core/bus.js';
import { State }         from '../core/state.js';
import { getAwareness }  from './awareness.js';

// ── Config ────────────────────────────────────────────────────

const FLOW_COUNT = 7;   // orbiting micro-particles around core

const STATE_ENERGY = {
  idle:       0.30,
  listening:  0.58,
  thinking:   0.92,
  responding: 0.80,
  success:    0.68,
  error:      0.42,
  offline:    0.08,
};

// ── State ─────────────────────────────────────────────────────

let _canvas   = null;
let _ctx      = null;
let _dpr      = 1;
let _rafId    = null;
let _reduced  = false;
let _isMobile = false;

let _colorRgb = '0, 212, 255';

// Continuous animation values
let _ring1Angle = 0;
let _ring2Angle = Math.PI;
let _ring3Angle = Math.PI * 0.5;
let _pulseT     = 0;

// Energy surge state
let _surge     = 0;
let _surgeNext = Date.now() + _randMs(8000, 22000);

// Flow particles orbiting the inner core
const _flow = [];

// Awareness idle level (updated via Bus)
let _awIdleLevel = 0;

// ── Init ──────────────────────────────────────────────────────

export function initReactor() {
  _reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  _isMobile = window.innerWidth <= 640;

  const orb = document.getElementById('orb');
  if (!orb) return;

  // Hide CSS core — reactor canvas takes over completely
  const coreEl = document.getElementById('orb-core');
  if (coreEl) coreEl.style.display = 'none';

  _canvas = document.createElement('canvas');
  _canvas.id = 'orb-reactor-canvas';
  _canvas.setAttribute('aria-hidden', 'true');
  _canvas.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    'z-index:2',
  ].join(';');

  orb.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');

  _dpr = Math.min(window.devicePixelRatio || 1, 2);
  _sizeCanvas();
  window.addEventListener('resize', _sizeCanvas, { passive: true });

  _readColor();
  Bus.on(EVENTS.THEME_CHANGED, () => requestAnimationFrame(_readColor));

  Bus.on(EVENTS.AWARENESS_CHANGED, ({ idleLevel }) => { _awIdleLevel = idleLevel; });

  // Spawn flow particles
  for (let i = 0; i < FLOW_COUNT; i++) {
    _flow.push({
      angle: (i / FLOW_COUNT) * Math.PI * 2 + Math.random() * 0.4,
      r:     12 + Math.random() * 9,
      speed: (0.018 + Math.random() * 0.014) * (Math.random() > 0.5 ? 1 : -1),
      size:  0.7 + Math.random() * 0.7,
      alpha: 0.28 + Math.random() * 0.28,
    });
  }

  if (_reduced) {
    _drawStatic();
  } else {
    _rafId = requestAnimationFrame(_loop);
  }
}

// ── Canvas sizing ─────────────────────────────────────────────

function _sizeCanvas() {
  if (!_canvas || !_ctx) return;
  const parent = _canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const sz   = Math.max(rect.width, rect.height, 10);
  _canvas.width  = sz * _dpr;
  _canvas.height = sz * _dpr;
  // Re-establish scale after resize
  _ctx = _canvas.getContext('2d');
  _ctx.scale(_dpr, _dpr);
}

// ── Color ─────────────────────────────────────────────────────

function _readColor() {
  _colorRgb = getComputedStyle(document.documentElement)
    .getPropertyValue('--orb-color-rgb').trim() || '0, 212, 255';
}

function _rgba(a) {
  return `rgba(${_colorRgb},${a.toFixed(3)})`;
}

// ── Main loop ─────────────────────────────────────────────────

function _loop() {
  if (!_ctx || !_canvas) return;

  const w  = _canvas.width  / _dpr;
  const h  = _canvas.height / _dpr;
  const cx = w / 2;
  const cy = h / 2;

  const ora         = getAwareness();
  const state       = State.get('orbState') || 'idle';
  const stateEnergy = STATE_ENERGY[state] ?? 0.35;
  const energy      = Math.min(1, stateEnergy + ora.energy * 0.22);

  // Speed multiplier from idle level
  const idleMul = _awIdleLevel === 2 ? 0.45 : _awIdleLevel === 1 ? 0.72 : 1.0;
  const timeMod = ora.timeModifier;

  // Advance animation values
  const spd    = idleMul * timeMod;
  _ring1Angle += 0.0080 * spd * (1 + energy * 0.6);
  _ring2Angle -= 0.0048 * spd;
  _ring3Angle += 0.0120 * spd * (1 + energy * 0.4);
  _pulseT     += 0.026  * spd;

  const pulseSin = (Math.sin(_pulseT) + 1) / 2;          // 0–1
  const pulseAlt = (Math.sin(_pulseT * 1.7 + 1) + 1) / 2; // offset wave

  // Surge
  if (Date.now() >= _surgeNext && state !== 'offline') {
    _surge     = 1;
    _surgeNext = Date.now() + _randMs(9000, 24000);
  }
  if (_surge > 0) _surge = Math.max(0, _surge - 0.030);
  const surgeBoost = _surge * 0.40;

  _ctx.clearRect(0, 0, w, h);

  // ── Layer 1: Background nebula ─────────────────────────────
  const nebAlpha = (0.035 + pulseSin * 0.025 + energy * 0.040) * timeMod;
  const nebula   = _ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.48);
  nebula.addColorStop(0,   _rgba(nebAlpha * 3.5));
  nebula.addColorStop(0.35,_rgba(nebAlpha * 1.2));
  nebula.addColorStop(1,   _rgba(0));
  _ctx.fillStyle = nebula;
  _ctx.fillRect(0, 0, w, h);

  // ── Layer 2: Concentric energy rings ──────────────────────
  const rBase = w * 0.42;  // relative to canvas
  _drawEnergyRing(cx, cy, rBase * 0.66, _ring1Angle, (0.10 + energy * 0.08) * timeMod, 0.82);
  _drawEnergyRing(cx, cy, rBase * 0.48, _ring2Angle, (0.14 + energy * 0.09) * timeMod, 0.72);
  _drawEnergyRing(cx, cy, rBase * 0.30, _ring3Angle, (0.18 + energy * 0.12) * timeMod, 0.55);

  // ── Layer 3: Radial flow lines ─────────────────────────────
  if (!_isMobile) {
    _drawFlowLines(cx, cy, w, energy, pulseSin, timeMod);
  }

  // ── Layer 4: Orbiting micro-particles ─────────────────────
  for (const fp of _flow) {
    fp.angle += fp.speed * spd;
    const scale = w / 220; // normalize to 220px reference
    const fx = cx + Math.cos(fp.angle) * fp.r * scale;
    const fy = cy + Math.sin(fp.angle) * fp.r * scale;
    const fa = fp.alpha * energy * 1.5 * timeMod + surgeBoost * 0.3;
    _ctx.beginPath();
    _ctx.arc(fx, fy, fp.size * scale, 0, Math.PI * 2);
    _ctx.fillStyle = _rgba(Math.min(0.9, fa));
    _ctx.fill();
  }

  // ── Layer 5: Secondary inner glow ring ────────────────────
  const innerR = w * 0.18 + pulseAlt * w * 0.02;
  _ctx.beginPath();
  _ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  _ctx.strokeStyle = _rgba((0.08 + energy * 0.06 + surgeBoost * 0.1) * timeMod);
  _ctx.lineWidth   = 0.8;
  _ctx.stroke();

  // ── Layer 6: Core pulse point ─────────────────────────────
  const coreR  = w * 0.095 + pulseSin * w * 0.018 + _surge * w * 0.035;
  const coreA  = Math.min(1, (0.70 + pulseSin * 0.22 + surgeBoost) * timeMod);
  const coreDim = w * 0.02;  // tiny hard center

  // Outer glow
  const coreGrad = _ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  coreGrad.addColorStop(0,    _rgba(coreA));
  coreGrad.addColorStop(0.20, _rgba(coreA * 0.80));
  coreGrad.addColorStop(0.55, _rgba(coreA * 0.28));
  coreGrad.addColorStop(1,    _rgba(0));
  _ctx.fillStyle = coreGrad;
  _ctx.beginPath();
  _ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  _ctx.fill();

  // Hard center point
  _ctx.beginPath();
  _ctx.arc(cx, cy, coreDim, 0, Math.PI * 2);
  _ctx.fillStyle = _rgba(Math.min(1, coreA * 1.4));
  _ctx.fill();

  _rafId = requestAnimationFrame(_loop);
}

// ── Draw helpers ──────────────────────────────────────────────

function _drawEnergyRing(cx, cy, r, startAngle, alpha, arcFraction) {
  const span  = Math.PI * 2 * arcFraction;
  _ctx.beginPath();
  _ctx.arc(cx, cy, r, startAngle, startAngle + span);
  _ctx.strokeStyle = _rgba(alpha);
  _ctx.lineWidth   = 0.8;
  _ctx.stroke();

  // Bright leading dot
  const ex = cx + Math.cos(startAngle + span) * r;
  const ey = cy + Math.sin(startAngle + span) * r;
  _ctx.beginPath();
  _ctx.arc(ex, ey, 1.5, 0, Math.PI * 2);
  _ctx.fillStyle = _rgba(alpha * 2.2);
  _ctx.fill();
}

function _drawFlowLines(cx, cy, w, energy, pulseSin, timeMod) {
  const count  = 8;
  const rInner = w * 0.07;
  const rOuter = w * 0.36 + pulseSin * w * 0.02;

  for (let i = 0; i < count; i++) {
    const a     = (i / count) * Math.PI * 2 + _ring1Angle * 0.28;
    const alpha = (0.028 + energy * 0.045) * timeMod * (0.5 + 0.5 * Math.sin(_pulseT + i * 0.9));

    const x1 = cx + Math.cos(a) * rInner;
    const y1 = cy + Math.sin(a) * rInner;
    const x2 = cx + Math.cos(a) * rOuter;
    const y2 = cy + Math.sin(a) * rOuter;

    const grad = _ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0,   _rgba(alpha * 2.5));
    grad.addColorStop(0.4, _rgba(alpha));
    grad.addColorStop(1,   _rgba(0));

    _ctx.beginPath();
    _ctx.moveTo(x1, y1);
    _ctx.lineTo(x2, y2);
    _ctx.strokeStyle = grad;
    _ctx.lineWidth   = 0.55;
    _ctx.stroke();
  }
}

// ── Static fallback (reduced motion) ──────────────────────────

function _drawStatic() {
  if (!_ctx || !_canvas) return;
  const w  = _canvas.width  / _dpr;
  const h  = _canvas.height / _dpr;
  const cx = w / 2, cy = h / 2;
  const g  = _ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.12);
  g.addColorStop(0,   _rgba(0.55));
  g.addColorStop(0.5, _rgba(0.18));
  g.addColorStop(1,   _rgba(0));
  _ctx.fillStyle = g;
  _ctx.beginPath();
  _ctx.arc(cx, cy, w * 0.12, 0, Math.PI * 2);
  _ctx.fill();
}

// ── Helpers ───────────────────────────────────────────────────

function _randMs(min, max) {
  return min + Math.random() * (max - min);
}
