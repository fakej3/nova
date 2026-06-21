/**
 * NOVA Reactor Core v28 — Stellar Navigation System / AI Star Map
 *
 * Draw order (back → front):
 *   0  Polar reference grid       — concentric guide circles + 16 radials
 *   1  Atmosphere boundary        — faint outer ring
 *   2  Containment ring           — 8 segments, dense tick marks, primary structure
 *   3  Outer geo ring             — 3 long segments, very slow CCW
 *   4  Radar sweep                — slow sector + bright arm
 *   5  Mid data ring              — 4 segments, cardinal ticks
 *   6  Inner tech ring            — 6 segments, faster CCW
 *   7  Orbital satellites         — 5 dots on ring paths, additive
 *   8  Core ring                  — 4 segments near nucleus, fast CW
 *   9  Inner glow                 — compact halo, NOT a sphere
 *  10  Reticle                    — crosshair ring + 4 short arm ticks
 *  11  Nucleus                    — bright compact star point
 *  12  Cursor shimmer             — subtle cursor-aware offset fill
 *  13  Surge overlay              — rare events 45–120 s
 *
 * Color system: derives from active CSS theme via --orb-color-rgb.
 * Re-reads on THEME_CHANGED. Pulses between base color and a brightened
 * variant of the same hue — no fixed blue/gold anchors.
 */

import { Bus, EVENTS }  from '../core/bus.js';
import { State }        from '../core/state.js';
import { getAwareness } from './awareness.js';

const TWO_PI = Math.PI * 2;

// ── Geometry (fractions of canvas width) ─────────────────────
const R = {
  NUCLEUS:  0.034,
  RETICLE:  0.068,
  CORE:     0.118,
  INNER:    0.188,
  MID:      0.272,
  OUTER:    0.358,
  CONTAIN:  0.432,
  ATM:      0.490,
};

// ── State energy levels ───────────────────────────────────────
const STATE_ENERGY = {
  idle:       0.28,
  listening:  0.62,
  thinking:   0.96,
  responding: 0.80,
  success:    0.60,
  error:      0.38,
  offline:    0.05,
};

let _canvas   = null;
let _ctx      = null;
let _dpr      = 1;
let _rafId    = null;
let _reduced  = false;
let _isMobile = false;

let _t      = 0;
let _energy = 0.30;
let _thinkP = 0;

let _curNX = 0;
let _curNY = 0;
let _awIdleLevel = 0;

// Ring rotation angles
let _coreAng  = 0;
let _innerAng = 0;
let _midAng   = 0;
let _outerAng = 0;
let _contAng  = 0;
let _sweepAng = 0;

// Orbital satellites — one per ring track
const _SATS = [
  { rFr: 0.118, speed:  0.00700, phase: 0.00, size: 1.65 },
  { rFr: 0.188, speed: -0.00350, phase: 2.09, size: 1.80 },
  { rFr: 0.272, speed:  0.00175, phase: 4.19, size: 1.55 },
  { rFr: 0.358, speed: -0.00088, phase: 1.05, size: 1.40 },
  { rFr: 0.432, speed:  0.00044, phase: 3.14, size: 1.30 },
];

// Surge event system
let _surgePhase = 0;
let _surgeLevel = 0;
let _surgeType  = 0;
let _surgeBorn  = 0;
let _surgeNext  = Date.now() + _rnd(50000, 120000);

// ── Color system — derives from active CSS theme ───────────────
let _cR = 0, _cG = 212, _cB = 255;

function _readColor() {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--orb-color-rgb').trim();
  if (!raw) return;
  const parts = raw.split(',').map(n => parseInt(n.trim(), 10));
  if (parts.length === 3 && parts.every(n => !isNaN(n))) {
    _cR = parts[0]; _cG = parts[1]; _cB = parts[2];
  }
}

function _rgb(alpha) {
  return `rgba(${_cR},${_cG},${_cB},${_clamp(alpha).toFixed(3)})`;
}

function _hot(alpha) {
  // Brightened / near-white variant of the theme color
  const rh = (_cR + (255 - _cR) * 0.88) | 0;
  const gh = (_cG + (255 - _cG) * 0.84) | 0;
  const bh = (_cB + (255 - _cB) * 0.72) | 0;
  return `rgba(${rh},${gh},${bh},${_clamp(alpha).toFixed(3)})`;
}

function _clamp(a) { return a < 0 ? 0 : a > 1 ? 1 : a; }
function _rnd(lo, hi) { return lo + Math.random() * (hi - lo); }

// ── Public API ────────────────────────────────────────────────

export function setReactorCursor(nx, ny) {
  _curNX = nx;
  _curNY = ny;
}

export function initReactor() {
  _reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  _isMobile = window.innerWidth <= 768;

  const orb = document.getElementById('orb');
  if (!orb) return;

  // Hide CSS-rendered core element — canvas replaces it entirely
  const coreEl = document.getElementById('orb-core');
  if (coreEl) coreEl.style.display = 'none';

  _canvas = document.createElement('canvas');
  _canvas.id = 'orb-reactor-canvas';
  _canvas.setAttribute('aria-hidden', 'true');
  _canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
  orb.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');

  _dpr = Math.min(window.devicePixelRatio || 1, 2);
  _sizeCanvas();
  window.addEventListener('resize', _sizeCanvas, { passive: true });

  _readColor();
  Bus.on(EVENTS.THEME_CHANGED, () => requestAnimationFrame(_readColor));
  Bus.on(EVENTS.AWARENESS_CHANGED, ({ idleLevel }) => { _awIdleLevel = idleLevel; });

  if (_reduced) {
    _drawStatic();
  } else {
    _rafId = requestAnimationFrame(_loop);
  }
}

// ── Canvas sizing ─────────────────────────────────────────────

function _sizeCanvas() {
  if (!_canvas || !_ctx) return;
  const p  = _canvas.parentElement;
  if (!p) return;
  const rect = p.getBoundingClientRect();
  const sz   = Math.max(rect.width, rect.height, 10);
  _canvas.width  = sz * _dpr;
  _canvas.height = sz * _dpr;
  _ctx = _canvas.getContext('2d');
  _ctx.scale(_dpr, _dpr);
}

// ── Surge system ──────────────────────────────────────────────

function _tickSurge(state) {
  const now = Date.now();
  if (_surgePhase === 0 && now >= _surgeNext && state !== 'offline') {
    _surgePhase = 1;
    _surgeType  = (Math.random() * 3) | 0;
    _surgeBorn  = now;
  }
  if (_surgePhase === 1) {
    _surgeLevel = Math.min(1, (now - _surgeBorn) / 1000);
    if (_surgeLevel >= 1) { _surgePhase = 2; _surgeBorn = now; }
  }
  if (_surgePhase === 2 && (now - _surgeBorn) > 800) {
    _surgePhase = 3; _surgeBorn = now;
  }
  if (_surgePhase === 3) {
    _surgeLevel = Math.max(0, 1 - (now - _surgeBorn) / 3000);
    if (_surgeLevel <= 0) {
      _surgePhase = 0; _surgeLevel = 0;
      _surgeNext  = now + _rnd(50000, 120000);
    }
  }
}

// ── Segmented ring helper ─────────────────────────────────────
// fill: fraction of circumference covered by arcs (0–1)
// lw:   line width in px

function _drawSegRing(cx, cy, r, startAng, segs, fill, alpha, lw) {
  if (alpha < 0.005 || r < 1) return;
  const segSpan = (TWO_PI * fill) / segs;
  const gapSpan = (TWO_PI * (1 - fill)) / segs;

  _ctx.save();
  _ctx.lineCap     = 'butt';
  _ctx.lineWidth   = lw;
  _ctx.strokeStyle = _rgb(alpha);

  let ang = startAng;
  for (let i = 0; i < segs; i++) {
    _ctx.beginPath();
    _ctx.arc(cx, cy, r, ang, ang + segSpan);
    _ctx.stroke();

    // Terminal dots at segment ends
    const dotA = _clamp(alpha * 2.0);
    _ctx.fillStyle = _rgb(dotA);
    const ex0 = cx + Math.cos(ang) * r;
    const ey0 = cy + Math.sin(ang) * r;
    const ex1 = cx + Math.cos(ang + segSpan) * r;
    const ey1 = cy + Math.sin(ang + segSpan) * r;
    _ctx.beginPath(); _ctx.arc(ex0, ey0, lw * 0.95, 0, TWO_PI); _ctx.fill();
    _ctx.beginPath(); _ctx.arc(ex1, ey1, lw * 0.95, 0, TWO_PI); _ctx.fill();

    ang += segSpan + gapSpan;
  }
  _ctx.restore();
}

// ── Main animation loop ───────────────────────────────────────

function _loop() {
  if (!_ctx || !_canvas) { _rafId = requestAnimationFrame(_loop); return; }
  _t++;

  const w  = _canvas.width  / _dpr;
  const h  = _canvas.height / _dpr;
  const cx = w * 0.5;
  const cy = h * 0.5;

  const ora     = getAwareness();
  const idleMul = _awIdleLevel === 2 ? 0.40 : _awIdleLevel === 1 ? 0.68 : 1.0;
  const timeMod = ora.timeModifier;
  const spd     = idleMul * timeMod;

  const state   = State.get('orbState') || 'idle';
  const eTarget = Math.min(1, (STATE_ENERGY[state] ?? 0.28) + ora.energy * 0.14);
  _energy += (eTarget - _energy) * 0.018;

  _thinkP += ((state === 'thinking' ? 1 : 0) - _thinkP) * 0.025;
  const tp = _thinkP;

  _tickSurge(state);
  const sl = _surgeLevel;

  const tBoost = 1 + tp * 1.60;

  // Advance all ring angles — premium mission-control pace
  _coreAng  +=  0.00175 * spd * tBoost;   // core ring:    ~60s / rev CW
  _innerAng += -0.00090 * spd * tBoost;   // inner tech:  ~116s / rev CCW
  _midAng   +=  0.00116 * spd;            // mid data:     ~90s / rev CW
  _outerAng += -0.00070 * spd;            // outer geo:   ~150s / rev CCW
  _contAng  +=  0.00035 * spd;            // containment: ~300s / rev CW
  _sweepAng +=  0.00175 * spd;            // radar:        ~60s / rev

  for (const s of _SATS) s.phase += s.speed * spd;

  _ctx.clearRect(0, 0, w, h);

  // ── 0: Polar reference grid ──────────────────────────────────
  {
    const ga = (0.034 + _energy * 0.020) * timeMod;
    if (ga > 0.003) {
      _ctx.save();

      // 4 faint concentric guide circles
      _ctx.lineWidth = 0.26;
      for (const rFr of [R.INNER, R.MID, R.OUTER, R.CONTAIN]) {
        _ctx.strokeStyle = _rgb(ga);
        _ctx.beginPath();
        _ctx.arc(cx, cy, rFr * w, 0, TWO_PI);
        _ctx.stroke();
      }

      // 16 radial lines (every 22.5°) — cardinal brighter
      for (let i = 0; i < 16; i++) {
        const ang     = (i / 16) * TWO_PI;
        const isCard  = i % 4 === 0;
        const isDiag  = i % 2 === 0 && !isCard;
        const lineAlp = isCard ? ga * 1.20 : isDiag ? ga * 0.65 : ga * 0.38;
        _ctx.lineWidth   = isCard ? 0.30 : 0.20;
        _ctx.strokeStyle = _rgb(lineAlp);
        _ctx.beginPath();
        _ctx.moveTo(cx + Math.cos(ang) * R.RETICLE * w, cy + Math.sin(ang) * R.RETICLE * w);
        _ctx.lineTo(cx + Math.cos(ang) * R.CONTAIN * w, cy + Math.sin(ang) * R.CONTAIN * w);
        _ctx.stroke();
      }

      _ctx.restore();
    }
  }

  // ── 1: Atmosphere boundary ────────────────────────────────────
  {
    const aa = (0.024 + _energy * 0.014) * timeMod;
    if (aa > 0.003) {
      _ctx.save();
      _ctx.beginPath();
      _ctx.arc(cx, cy, R.ATM * w, 0, TWO_PI);
      _ctx.strokeStyle = _rgb(aa);
      _ctx.lineWidth   = 0.28;
      _ctx.stroke();
      _ctx.restore();
    }
  }

  // ── 2: Containment ring (8 segs + dense tick marks) ──────────
  {
    const ca = (0.52 + _energy * 0.30 + tp * 0.18) * timeMod;
    _drawSegRing(cx, cy, w * R.CONTAIN, _contAng, 8, 0.74, ca, 1.0);

    // 72 tick marks every 5° — 3 sizes
    const tickA = (0.20 + _energy * 0.16) * timeMod;
    if (tickA > 0.005) {
      _ctx.save();
      for (let i = 0; i < 72; i++) {
        const ang     = _contAng + (i / 72) * TWO_PI;
        const isMain  = i % 9 === 0;  // every 45° (8 main ticks)
        const isMed   = i % 3 === 0;  // every 15°
        const inner   = R.CONTAIN * w - (isMain ? 7.5 : isMed ? 3.5 : 1.8);
        const outer   = R.CONTAIN * w + (isMain ? 4.0 : 1.5);
        _ctx.strokeStyle = _rgb(isMain ? tickA * 2.0 : isMed ? tickA * 1.2 : tickA * 0.60);
        _ctx.lineWidth   = isMain ? 0.90 : 0.38;
        _ctx.beginPath();
        _ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
        _ctx.lineTo(cx + Math.cos(ang) * outer, cy + Math.sin(ang) * outer);
        _ctx.stroke();
      }
      _ctx.restore();
    }
  }

  // ── 3: Outer geo ring (3 long segments, slow) ─────────────────
  {
    const oa = (0.20 + _energy * 0.22 + tp * 0.12) * timeMod;
    _drawSegRing(cx, cy, w * R.OUTER, _outerAng, 3, 0.80, oa, 0.78);
  }

  // ── 4: Radar sweep ────────────────────────────────────────────
  {
    const sweepA = (0.022 + _energy * 0.030) * timeMod;
    if (sweepA > 0.003) {
      const sweepR    = R.CONTAIN * w * 0.97;
      const sweepSpan = Math.PI * 0.50;
      const steps     = 24;

      _ctx.save();

      // Fading sector fill
      for (let i = 0; i < steps; i++) {
        const t0   = _sweepAng + (i / steps) * sweepSpan;
        const t1   = _sweepAng + ((i + 1) / steps) * sweepSpan;
        const fade = 1 - i / steps;
        _ctx.beginPath();
        _ctx.moveTo(cx, cy);
        _ctx.arc(cx, cy, sweepR, t0, t1);
        _ctx.closePath();
        _ctx.fillStyle = _rgb(sweepA * fade * fade * 1.8);
        _ctx.fill();
      }

      // Bright leading arm
      _ctx.beginPath();
      _ctx.moveTo(cx, cy);
      _ctx.lineTo(
        cx + Math.cos(_sweepAng) * sweepR,
        cy + Math.sin(_sweepAng) * sweepR
      );
      _ctx.strokeStyle = _rgb(_clamp(sweepA * 5.0));
      _ctx.lineWidth   = 0.80;
      _ctx.lineCap     = 'round';
      _ctx.stroke();

      // Tip dot
      _ctx.beginPath();
      _ctx.arc(
        cx + Math.cos(_sweepAng) * sweepR,
        cy + Math.sin(_sweepAng) * sweepR,
        1.7, 0, TWO_PI
      );
      _ctx.fillStyle = _hot(_clamp(sweepA * 8));
      _ctx.fill();

      _ctx.restore();
    }
  }

  // ── 5: Mid data ring (4 segs + 16 cardinal/sub ticks) ─────────
  {
    const ma = (0.36 + _energy * 0.28 + tp * 0.14) * timeMod;
    _drawSegRing(cx, cy, w * R.MID, _midAng, 4, 0.72, ma, 0.90);

    const tickA = (0.26 + _energy * 0.18) * timeMod;
    if (tickA > 0.005) {
      _ctx.save();
      for (let i = 0; i < 16; i++) {
        const ang    = _midAng + (i / 16) * TWO_PI;
        const isCard = i % 4 === 0;
        const tLen   = isCard ? 5.5 : 2.2;
        _ctx.beginPath();
        _ctx.moveTo(cx + Math.cos(ang) * (R.MID * w - tLen), cy + Math.sin(ang) * (R.MID * w - tLen));
        _ctx.lineTo(cx + Math.cos(ang) * (R.MID * w + 1.5),  cy + Math.sin(ang) * (R.MID * w + 1.5));
        _ctx.strokeStyle = _rgb(isCard ? tickA * 1.8 : tickA * 0.65);
        _ctx.lineWidth   = isCard ? 0.90 : 0.40;
        _ctx.stroke();
      }
      _ctx.restore();
    }
  }

  // ── 6: Inner tech ring (6 segs, faster CCW) ───────────────────
  {
    const ia = (0.45 + _energy * 0.30 + tp * 0.16) * timeMod;
    _drawSegRing(cx, cy, w * R.INNER, _innerAng, 6, 0.80, ia, 0.72);
  }

  // ── 7: Orbital satellites ─────────────────────────────────────
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    for (const sat of _SATS) {
      const px = cx + Math.cos(sat.phase) * sat.rFr * w;
      const py = cy + Math.sin(sat.phase) * sat.rFr * w;
      const sa = (0.60 + _energy * 0.40) * timeMod;

      // Glow halo
      const hr  = sat.size * 2.8;
      const halo = _ctx.createRadialGradient(px, py, 0, px, py, hr);
      halo.addColorStop(0,    _hot(sa * 0.82));
      halo.addColorStop(0.40, _rgb(sa * 0.28));
      halo.addColorStop(1,    _rgb(0));
      _ctx.fillStyle = halo;
      _ctx.beginPath(); _ctx.arc(px, py, hr, 0, TWO_PI); _ctx.fill();

      // Hard dot
      _ctx.beginPath(); _ctx.arc(px, py, sat.size * 0.82, 0, TWO_PI);
      _ctx.fillStyle = _hot(_clamp(sa * 1.35));
      _ctx.fill();
    }
    _ctx.restore();
  }

  // ── 8: Core ring (4 segs, fast CW) ───────────────────────────
  {
    const cra = (0.58 + _energy * 0.32 + tp * 0.22) * timeMod;
    _drawSegRing(cx, cy, w * R.CORE, _coreAng, 4, 0.68, cra, 0.55);
  }

  // ── 9: Inner glow — compact, NOT a sphere ─────────────────────
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    const igR = w * 0.058 * (1 + Math.sin(_t * 0.028) * 0.08 + tp * 0.18);
    const igA = (0.13 + _energy * 0.10 + tp * 0.09 + sl * 0.07) * timeMod;

    const g = _ctx.createRadialGradient(cx, cy, 0, cx, cy, igR);
    g.addColorStop(0,    _hot(igA * 0.90));
    g.addColorStop(0.35, _rgb(igA * 0.45));
    g.addColorStop(0.75, _rgb(igA * 0.10));
    g.addColorStop(1,    _rgb(0));
    _ctx.fillStyle = g;
    _ctx.beginPath(); _ctx.arc(cx, cy, igR, 0, TWO_PI); _ctx.fill();
    _ctx.restore();
  }

  // ── 10: Reticle (crosshair ring + 4 arm ticks) ────────────────
  {
    const ra = (0.52 + _energy * 0.24) * timeMod;
    if (ra > 0.006) {
      _ctx.save();
      // Segmented reticle ring (counter-rotates slowly)
      _drawSegRing(cx, cy, w * R.RETICLE, -_coreAng * 0.35, 4, 0.55, ra * 0.68, 0.52);

      // 4 short arm ticks at cardinal angles (pointing outward from reticle)
      _ctx.strokeStyle = _rgb(ra * 0.75);
      _ctx.lineWidth   = 0.65;
      _ctx.lineCap     = 'butt';
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * TWO_PI;
        const r0  = R.RETICLE * w + 2.0;
        const r1  = R.RETICLE * w + 7.5;
        _ctx.beginPath();
        _ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        _ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        _ctx.stroke();
      }
      _ctx.restore();
    }
  }

  // ── 11: Nucleus — compact star point ──────────────────────────
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    const pulse = (Math.sin(_t * 0.048) + 1) * 0.5;
    const nucR  = w * R.NUCLEUS * (1 + pulse * 0.14 + tp * 0.22 + sl * 0.32);
    const nucA  = (0.96 + sl * 0.04) * timeMod;

    // Tight outer glow — stops well short of "sphere" size
    const ng = _ctx.createRadialGradient(cx, cy, 0, cx, cy, nucR * 2.8);
    ng.addColorStop(0,    _hot(nucA));
    ng.addColorStop(0.28, _rgb(nucA * 0.52));
    ng.addColorStop(0.60, _rgb(nucA * 0.16));
    ng.addColorStop(1,    _rgb(0));
    _ctx.fillStyle = ng;
    _ctx.beginPath(); _ctx.arc(cx, cy, nucR * 2.8, 0, TWO_PI); _ctx.fill();

    // Hard point
    _ctx.beginPath(); _ctx.arc(cx, cy, nucR, 0, TWO_PI);
    _ctx.fillStyle = _hot(1.0);
    _ctx.fill();

    // White-hot center
    _ctx.beginPath(); _ctx.arc(cx, cy, nucR * 0.40, 0, TWO_PI);
    _ctx.fillStyle = 'rgba(255,255,255,0.97)';
    _ctx.fill();

    _ctx.restore();
  }

  // ── 12: Cursor shimmer (subtle offset) ────────────────────────
  const cursorMag = _curNX * _curNX + _curNY * _curNY;
  if (cursorMag > 0.001) {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    const offX = cx + _curNX * w * 0.030;
    const offY = cy + _curNY * w * 0.030;
    const shR  = w * 0.070;
    const shA  = 0.030 * _energy * timeMod;
    const g    = _ctx.createRadialGradient(offX, offY, 0, offX, offY, shR);
    g.addColorStop(0, _rgb(shA));
    g.addColorStop(1, _rgb(0));
    _ctx.fillStyle = g;
    _ctx.beginPath(); _ctx.arc(offX, offY, shR, 0, TWO_PI); _ctx.fill();
    _ctx.restore();
  }

  // ── 13: Surge overlay ─────────────────────────────────────────
  if (sl > 0.02) _drawSurge(cx, cy, w, sl);

  _rafId = requestAnimationFrame(_loop);
}

// ── Surge events ──────────────────────────────────────────────

function _drawSurge(cx, cy, w, sl) {
  _ctx.save();
  switch (_surgeType) {
    case 0: {
      // Expanding ripple rings outward from containment
      for (let k = 0; k < 3; k++) {
        const rip = sl - k * 0.28;
        if (rip <= 0) continue;
        _ctx.beginPath();
        _ctx.arc(cx, cy, R.CONTAIN * w + w * 0.10 * (1 - rip), 0, TWO_PI);
        _ctx.strokeStyle = _rgb(rip * 0.38);
        _ctx.lineWidth   = 1.2 * rip;
        _ctx.stroke();
      }
      break;
    }
    case 1: {
      // Inner chamber brightens — additive radial
      _ctx.globalCompositeOperation = 'lighter';
      const g = _ctx.createRadialGradient(cx, cy, 0, cx, cy, w * R.INNER);
      g.addColorStop(0,    _hot(sl * 0.18));
      g.addColorStop(0.55, _rgb(sl * 0.07));
      g.addColorStop(1,    _rgb(0));
      _ctx.fillStyle = g;
      _ctx.beginPath(); _ctx.arc(cx, cy, w * R.INNER, 0, TWO_PI); _ctx.fill();
      break;
    }
    case 2: {
      // Containment ring flares
      _ctx.beginPath();
      _ctx.arc(cx, cy, R.CONTAIN * w, 0, TWO_PI);
      _ctx.strokeStyle = _rgb(sl * 0.52);
      _ctx.lineWidth   = 2.4 * sl;
      _ctx.stroke();
      break;
    }
  }
  _ctx.restore();
}

// ── Static fallback (reduced motion) ─────────────────────────

function _drawStatic() {
  if (!_ctx || !_canvas) return;
  const w  = _canvas.width / _dpr;
  const cx = w * 0.5;
  const cy = w * 0.5;

  _drawSegRing(cx, cy, w * R.CONTAIN, 0,    8, 0.74, 0.48, 0.95);
  _drawSegRing(cx, cy, w * R.OUTER,   0,    3, 0.80, 0.22, 0.78);
  _drawSegRing(cx, cy, w * R.MID,     0,    4, 0.72, 0.34, 0.90);
  _drawSegRing(cx, cy, w * R.INNER,   0,    6, 0.80, 0.28, 0.72);
  _drawSegRing(cx, cy, w * R.CORE,    0.78, 4, 0.68, 0.52, 0.55);

  // Nucleus glow
  const g = _ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.08);
  g.addColorStop(0,    _hot(0.80));
  g.addColorStop(0.45, _rgb(0.30));
  g.addColorStop(1,    _rgb(0));
  _ctx.fillStyle = g;
  _ctx.beginPath(); _ctx.arc(cx, cy, w * 0.08, 0, TWO_PI); _ctx.fill();

  _ctx.beginPath(); _ctx.arc(cx, cy, w * R.NUCLEUS, 0, TWO_PI);
  _ctx.fillStyle = _hot(0.92); _ctx.fill();
}
