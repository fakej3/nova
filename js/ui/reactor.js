/**
 * NOVA Reactor Core — Premium Sci-Fi Energy Reactor
 *
 * Draw order (back → front):
 *   0  Deep atmospheric field          — soft fill, always visible
 *   1  Procedural plasma field         — 6 drifting blobs, additive
 *   2  Energy streams                  — radial spokes, nucleus→containment
 *   3  Inner geo ring                  — 4 segs, CW
 *   4  Mid geo ring                    — 4 segs, slow CCW
 *   5  Containment ring                — 5-seg bright ring, 3 glow passes
 *   6  Energy chamber glow             — cursor-aware offset fill, additive
 *   7  Nuclear haze                    — cursor-aware soft fill, additive
 *   8  Inner glow                      — colored core fill, additive
 *   9  Nucleus hard point              — deep glow center, additive
 *  10  Surge overlay                   — rare events 30–120 s
 *
 * Removed (were decorative):
 *   - Hex blade rings A & B  — spinning arcs, communicated nothing
 *   - Arc fragments           — random drift, communicated nothing
 *   - Outer geo ring          — too far out, decoration
 *
 * Cursor awareness:
 *   Chamber glow and nuclear haze shift slightly toward cursor position.
 *   The orb "notices" where the user is without obvious animation.
 *
 * Thinking mode:
 *   nucleus contracts, plasma accelerates, containment brightens,
 *   chamber pressure expands. All via a single _thinkP lerp (0→1 over ~40 frames).
 */

import { Bus, EVENTS }  from '../core/bus.js';
import { State }        from '../core/state.js';
import { getAwareness } from './awareness.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const TWO_PI = Math.PI * 2;

// Energy baseline per orb state.
// These are MINIMUM energy floors — even at idle the reactor glows.
const STATE_ENERGY = {
  idle:       0.32,
  listening:  0.58,
  thinking:   0.96,
  responding: 0.80,
  success:    0.65,
  error:      0.42,
  offline:    0.06,
};

// Radius expressed as fraction of canvas logical width (w).
// The orb circle radius = w * 0.50, so anything < 0.50 stays inside.
const R_NUC_PT   = 0.042;  // nucleus hard point
const R_NUC_IG   = 0.130;  // inner colored glow
const R_NUC_HZ   = 0.290;  // nuclear haze (fills inner half of orb)
const R_BLADE_A  = 0.082;  // hex blade ring A (inner, CW)
const R_BLADE_B  = 0.112;  // hex blade ring B (outer, CCW)
const R_INNER    = 0.165;  // inner reactor ring (segmented)
const R_MID      = 0.235;  // mid geometry ring
const R_CONT     = 0.305;  // containment ring — primary structure
const R_OUTER    = 0.390;  // outer geometry ring
const R_ATM      = 0.480;  // atmospheric fill edge (near orb boundary)

// ─────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────

let _canvas   = null;
let _ctx      = null;
let _dpr      = 1;
let _rafId    = null;
let _reduced  = false;
let _isMobile = false;
let _colorRgb = '0, 212, 255';

let _t      = 0;        // frame counter — never resets
let _energy = 0.32;     // smoothed energy (lerps each frame)
let _thinkP = 0;        // thinking pressure 0→1

// Cursor position (normalized -1..1), set from mouse.js
let _curNX = 0;
let _curNY = 0;

export function setReactorCursor(nx, ny) {
  _curNX = nx;
  _curNY = ny;
}

// Geometry ring angles
let _gA0 = Math.random() * TWO_PI;   // inner (fast CW)
let _gA1 = Math.random() * TWO_PI;   // mid (slow CCW)

// Containment ring angle
let _contAng = Math.random() * TWO_PI;

// Inner reactor ring angle (CW, slightly faster than containment)
let _innerAng = Math.random() * TWO_PI;

// Awareness
let _awIdleLevel = 0;

// ─────────────────────────────────────────────────────────────
// Surge system  (30–120 s intervals, 5 types)
// Phase: 0=dormant 1=build(0.8s) 2=hold(0.6s) 3=decay(2.5s)
// ─────────────────────────────────────────────────────────────

let _surgePhase = 0;
let _surgeLevel = 0;
let _surgeType  = 0;
let _surgeBorn  = 0;
let _surgeNext  = Date.now() + _rnd(30000, 120000);

// (Hex blade rings removed — were decorative spinning arcs)

// ─────────────────────────────────────────────────────────────
// Procedural plasma  (Phase 2 — 10 blobs, dual-freq oscillators)
// ─────────────────────────────────────────────────────────────

const _plasma = Array.from({ length: 6 }, (_, i) => ({
  baseAng: (i / 10) * TWO_PI + Math.random() * 0.9,
  baseR:   0.06 + Math.random() * 0.18,   // fraction of w
  f1:      0.0055 + Math.random() * 0.0050,
  f2:      0.0030 + Math.random() * 0.0040,
  a1:      0.16   + Math.random() * 0.20,
  a2:      0.07   + Math.random() * 0.11,
  ph:      Math.random() * TWO_PI,
  rF:      0.0042 + Math.random() * 0.0048,
  rA:      0.025  + Math.random() * 0.040,
  rPh:     Math.random() * TWO_PI,
  size:    0.065  + Math.random() * 0.080,   // blob radius fraction of w
  alpha:   0.18   + Math.random() * 0.20,
}));

// ─────────────────────────────────────────────────────────────
// Geometry rings — two depths (inner + mid only)
// ─────────────────────────────────────────────────────────────

const _GEO = [
  { rFr: R_INNER, segs: 4, gapF: 0.155, speed:  0.0035, lw: 1.0, base: 0.38 },
  { rFr: R_MID,   segs: 4, gapF: 0.145, speed: -0.0018, lw: 0.8, base: 0.24 },
];

const _geoGaps = _GEO.map(g =>
  Array.from({ length: g.segs }, () => g.gapF * (0.70 + Math.random() * 0.60))
);

// (Arc fragments removed — were decorative random-drift arcs)

// ─────────────────────────────────────────────────────────────
// Containment ring  (Phase 4 — primary structural bright ring)
// 5 segments, asymmetric gaps, 3 glow passes
// ─────────────────────────────────────────────────────────────

const CONT_SEGS = 5;
const _contGaps = Array.from({ length: CONT_SEGS }, () =>
  0.055 + Math.random() * 0.085
);

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────

export function initReactor() {
  _reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  _isMobile = window.innerWidth <= 640;

  const orb = document.getElementById('orb');
  if (!orb) return;

  // Replace CSS #orb-core entirely
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

// ─────────────────────────────────────────────────────────────
// Canvas sizing
// ─────────────────────────────────────────────────────────────

function _sizeCanvas() {
  if (!_canvas || !_ctx) return;
  const p  = _canvas.parentElement;
  if (!p) return;
  const r  = p.getBoundingClientRect();
  const sz = Math.max(r.width, r.height, 10);
  _canvas.width  = sz * _dpr;
  _canvas.height = sz * _dpr;
  _ctx = _canvas.getContext('2d');
  _ctx.scale(_dpr, _dpr);
}

// ─────────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────────

function _readColor() {
  _colorRgb = getComputedStyle(document.documentElement)
    .getPropertyValue('--orb-color-rgb').trim() || '0, 212, 255';
}

function _c(a) {
  return `rgba(${_colorRgb},${_clamp(a).toFixed(3)})`;
}

// White-hot version: shifts color toward white (for nucleus core)
function _hot(a) {
  const [r, g, b] = _colorRgb.split(',').map(Number);
  const rh = Math.round(r + (255 - r) * 0.60);
  const gh = Math.round(g + (255 - g) * 0.58);
  const bh = Math.round(b + (255 - b) * 0.38);
  return `rgba(${rh},${gh},${bh},${_clamp(a).toFixed(3)})`;
}

function _clamp(a) { return Math.max(0, Math.min(1, a)); }

// ─────────────────────────────────────────────────────────────
// Surge management
// ─────────────────────────────────────────────────────────────

function _tickSurge(state) {
  const now = Date.now();
  if (_surgePhase === 0 && now >= _surgeNext && state !== 'offline') {
    _surgePhase = 1;
    _surgeType  = Math.floor(Math.random() * 5);
    _surgeBorn  = now;
  }
  if (_surgePhase === 1) {
    _surgeLevel = Math.min(1, (now - _surgeBorn) / 800);
    if (_surgeLevel >= 1) { _surgePhase = 2; _surgeBorn = now; }
  }
  if (_surgePhase === 2 && (now - _surgeBorn) > 600) {
    _surgePhase = 3; _surgeBorn = now;
  }
  if (_surgePhase === 3) {
    _surgeLevel = Math.max(0, 1 - (now - _surgeBorn) / 2500);
    if (_surgeLevel <= 0) {
      _surgePhase = 0; _surgeLevel = 0;
      _surgeNext  = now + _rnd(30000, 120000);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────

function _loop() {
  if (!_ctx || !_canvas) { _rafId = requestAnimationFrame(_loop); return; }
  _t++;

  const w  = _canvas.width  / _dpr;
  const h  = _canvas.height / _dpr;
  const cx = w * 0.5;
  const cy = h * 0.5;

  // Awareness
  const ora     = getAwareness();
  const idleMul = _awIdleLevel === 2 ? 0.42 : _awIdleLevel === 1 ? 0.70 : 1.0;
  const timeMod = ora.timeModifier;
  const spd     = idleMul * timeMod;

  // Smooth energy
  const state   = State.get('orbState') || 'idle';
  const eTarget = Math.min(1, (STATE_ENERGY[state] ?? 0.32) + ora.energy * 0.16);
  _energy      += (eTarget - _energy) * 0.020;

  // Thinking pressure
  _thinkP += ((state === 'thinking' ? 1 : 0) - _thinkP) * 0.028;

  const tp = _thinkP;  // shorthand

  // Surge
  _tickSurge(state);
  const sl = _surgeLevel;

  // Angle advances
  const tBoost = 1 + tp * 1.85;
  _gA0      +=  0.0052  * spd * tBoost;   // inner ring CW
  _gA1      += -0.0020  * spd * tBoost;   // mid ring CCW
  _contAng  += -0.00072 * spd;             // containment ring CCW (always slow)
  _innerAng +=  0.0018  * spd * tBoost;   // inner ring angle (reused for inner)

  // Multi-freq sine waves for organic variation
  const s1 = Math.sin(_t * 0.026);
  const s2 = Math.sin(_t * 0.018 + 1.3);
  const s3 = Math.sin(_t * 0.038 + 2.6);
  const s4 = Math.sin(_t * 0.011 + 0.8);
  const s5 = Math.sin(_t * 0.055 + 1.9);

  _ctx.clearRect(0, 0, w, h);

  // ═══════════════════════════════════════════════════════════════
  // LAYER 0 — Deep atmospheric field
  // Soft background fill. Visible at idle.
  // ═══════════════════════════════════════════════════════════════
  {
    const a = (0.085 + _energy * 0.065 + s1 * 0.012) * timeMod;
    const g = _ctx.createRadialGradient(cx, cy, 0, cx, cy, w * R_ATM);
    g.addColorStop(0,    _c(a * 3.2));
    g.addColorStop(0.22, _c(a * 1.8));
    g.addColorStop(0.55, _c(a * 0.7));
    g.addColorStop(1,    _c(0));
    _ctx.fillStyle = g;
    _ctx.fillRect(0, 0, w, h);
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 1 — Procedural plasma field (additive blend)
  // 10 blobs driven by dual-frequency oscillators.
  // Additive compositing makes overlapping blobs genuinely brighten.
  // ═══════════════════════════════════════════════════════════════
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    const pSpd = 1 + tp * 2.5;   // plasma races during thinking
    for (const p of _plasma) {
      const tf  = _t * pSpd;
      const ang = p.baseAng
        + Math.sin(tf * p.f1)        * p.a1
        + Math.sin(tf * p.f2 + p.ph) * p.a2;
      const rFr = p.baseR + Math.sin(tf * p.rF + p.rPh) * p.rA;
      const bx  = cx + Math.cos(ang) * rFr * w;
      const by  = cy + Math.sin(ang) * rFr * w;
      const br  = p.size * w * (1 + tp * 0.30);
      // Base alpha: always visible floor + energy bonus
      const ba  = (0.055 + _energy * 0.12) * timeMod
        + (_surgeType === 2 ? sl * 0.18 : 0);   // surge type 2: plasma instability

      const g = _ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0,    _c(_clamp(ba * 1.6)));
      g.addColorStop(0.38, _c(ba));
      g.addColorStop(1,    _c(0));
      _ctx.fillStyle = g;
      _ctx.beginPath();
      _ctx.arc(bx, by, br, 0, TWO_PI);
      _ctx.fill();
    }
    _ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 2 — Energy streams  (radial spokes, nucleus → containment)
  // Span from nucleus edge to containment ring for visual coherence.
  // ═══════════════════════════════════════════════════════════════
  {
    const count  = _isMobile ? 5 : 8;
    const rIn    = w * (R_NUC_PT + 0.008);
    const rOut   = w * (R_CONT   - 0.020) * (1 - tp * 0.08);
    _ctx.save();
    _ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const ang   = (i / count) * TWO_PI + _bladeAngA * 0.18 + s2 * 0.035;
      const pulse = (Math.sin(_t * 0.034 + i * 1.22) + 1) * 0.5;
      const a     = (0.055 + _energy * 0.090 + pulse * 0.055) * timeMod;
      const x1 = cx + Math.cos(ang) * rIn;
      const y1 = cy + Math.sin(ang) * rIn;
      const x2 = cx + Math.cos(ang) * rOut;
      const y2 = cy + Math.sin(ang) * rOut;
      const g  = _ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0,    _c(a * 2.8));
      g.addColorStop(0.35, _c(a * 1.2));
      g.addColorStop(0.75, _c(a * 0.4));
      g.addColorStop(1,    _c(0));
      _ctx.beginPath();
      _ctx.moveTo(x1, y1);
      _ctx.lineTo(x2, y2);
      _ctx.strokeStyle = g;
      _ctx.lineWidth   = 0.7;
      _ctx.stroke();
    }
    _ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 3 — Inner geometry ring  (R_INNER, fast CW, 4 segments)
  // ═══════════════════════════════════════════════════════════════
  {
    const a = (_GEO[0].base + _energy * 0.26) * timeMod;
    _drawGeoRing(cx, cy, w, _GEO[0], _geoGaps[0], _innerAng, a);
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 4 — Mid geometry ring  (R_MID, slow CCW, 4 segs)
  // ═══════════════════════════════════════════════════════════════
  {
    const a = (_GEO[1].base + _energy * 0.18) * timeMod;
    _drawGeoRing(cx, cy, w, _GEO[1], _geoGaps[1], _gA1, a);
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 5 — Containment ring  (primary structure, 3 glow passes)
  // This is the outermost crisp element — defines the reactor boundary.
  // Multiple width passes simulate a neon tube with inner glow.
  // ═══════════════════════════════════════════════════════════════
  {
    // Type 3 surge: energy compression — ring pulses bright
    const surgeBoost = _surgeType === 3 ? sl * 0.30 : 0;
    const contR   = w * R_CONT * (_surgeType === 3 ? (1 - sl * 0.08) : 1);
    const contA   = (0.52 + _energy * 0.32 + tp * 0.15 + surgeBoost) * timeMod;

    const passes = _isMobile ? 1 : 3;
    for (let p = passes - 1; p >= 0; p--) {
      const pa = contA * (0.22 + p * 0.38);
      const pw = 0.8 + p * 2.2;
      _drawContRing(cx, cy, contR, pa, pw);
    }
    _drawContRing(cx, cy, contR, contA, 1.0);   // crisp top edge
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 6 — Energy chamber glow  (additive, cursor-aware offset)
  // Shifts toward cursor — the core "notices" where the user is.
  // ═══════════════════════════════════════════════════════════════
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    // Cursor awareness: shift glow center up to 4% of canvas toward cursor
    const offX  = cx + (s1 * 0.018 + s3 * 0.010 + _curNX * 0.040) * w;
    const offY  = cy + (s2 * 0.015 + s4 * 0.008 + _curNY * 0.040) * w;
    const chamR = w * (0.195 + tp * 0.065 + (_surgeType === 0 ? sl * 0.070 : 0));
    const chamA = (0.085 + _energy * 0.090 + tp * 0.080) * timeMod
      + (_surgeType === 0 ? sl * 0.14 : 0);   // internal flare

    const g = _ctx.createRadialGradient(offX, offY, 0, offX, offY, chamR);
    g.addColorStop(0,    _c(chamA * 2.6));
    g.addColorStop(0.30, _c(chamA * 1.4));
    g.addColorStop(0.65, _c(chamA * 0.4));
    g.addColorStop(1,    _c(0));
    _ctx.fillStyle = g;
    _ctx.beginPath();
    _ctx.arc(offX, offY, chamR, 0, TWO_PI);
    _ctx.fill();
    _ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 7 — Nuclear haze  (additive — cursor-aware soft fill)
  // ═══════════════════════════════════════════════════════════════
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    const nucScale = 1 - tp * 0.25;
    const surgeNuc = (_surgeType === 0) ? sl : 0;
    const hazeR = w * R_NUC_HZ * nucScale;
    const hazeA = (0.10 + _energy * 0.09 + surgeNuc * 0.06) * timeMod;
    // Subtle cursor lean on the haze center
    const hazeX = cx + _curNX * 0.020 * w;
    const hazeY = cy + _curNY * 0.020 * w;

    const g = _ctx.createRadialGradient(hazeX, hazeY, 0, hazeX, hazeY, hazeR);
    g.addColorStop(0,    _c(hazeA * 2.4));
    g.addColorStop(0.40, _c(hazeA * 1.1));
    g.addColorStop(0.75, _c(hazeA * 0.3));
    g.addColorStop(1,    _c(0));
    _ctx.fillStyle = g;
    _ctx.beginPath();
    _ctx.arc(hazeX, hazeY, hazeR, 0, TWO_PI);
    _ctx.fill();
    _ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 8 — Inner glow  (additive — colored, clearly visible)
  // Bright colored fill at R_NUC_IG. Breathes with s1.
  // ═══════════════════════════════════════════════════════════════
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    const nucScale = 1 - _thinkP * 0.25;
    const surgeNuc = (_surgeType === 0) ? sl : 0;
    const igR = w * R_NUC_IG * nucScale * (1 + s1 * 0.08);
    const igA = (0.26 + _energy * 0.20 + surgeNuc * 0.16) * timeMod;

    const g = _ctx.createRadialGradient(cx, cy, 0, cx, cy, igR);
    g.addColorStop(0,    _hot(igA));
    g.addColorStop(0.25, _c(igA * 0.95));
    g.addColorStop(0.60, _c(igA * 0.38));
    g.addColorStop(1,    _c(0));
    _ctx.fillStyle = g;
    _ctx.beginPath();
    _ctx.arc(cx, cy, igR, 0, TWO_PI);
    _ctx.fill();
    _ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 9 — Nucleus hard point  (additive — deep glow center)
  // Two concentric fills: hot white center + bright colored halo.
  // Always bright — does NOT scale with energy so idle still glows.
  // ═══════════════════════════════════════════════════════════════
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    const nucScale = 1 - _thinkP * 0.22;
    const surgeNuc = (_surgeType === 0) ? sl * 0.9 : 0;
    const pulse    = s5 * 0.5 + 0.5;   // 0–1, fast pulse for nucleus flicker

    // Outer ring of the nucleus
    const ringR = w * R_NUC_PT * nucScale * (1.8 + pulse * 0.25);
    const ringA = (0.55 + _energy * 0.22 + surgeNuc * 0.20) * timeMod;
    {
      const g = _ctx.createRadialGradient(cx, cy, 0, cx, cy, ringR);
      g.addColorStop(0,    _hot(ringA));
      g.addColorStop(0.45, _c(ringA * 0.50));
      g.addColorStop(1,    _c(0));
      _ctx.fillStyle = g;
      _ctx.beginPath();
      _ctx.arc(cx, cy, ringR, 0, TWO_PI);
      _ctx.fill();
    }

    // Hard white-hot center dot (always max brightness)
    const ptR = w * R_NUC_PT * nucScale * (0.6 + pulse * 0.12);
    _ctx.beginPath();
    _ctx.arc(cx, cy, ptR, 0, TWO_PI);
    _ctx.fillStyle = _hot(_clamp(0.62 + surgeNuc * 0.12));
    _ctx.fill();
    _ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 10 — Surge overlay  (type-specific effects)
  // ═══════════════════════════════════════════════════════════════
  if (sl > 0.02) {
    _drawSurge(cx, cy, w, sl);
  }

  _rafId = requestAnimationFrame(_loop);
}

// ─────────────────────────────────────────────────────────────
// Draw helpers
// ─────────────────────────────────────────────────────────────

// Segmented ring with per-segment randomized gaps (Phase 6 asymmetry)
function _drawGeoRing(cx, cy, w, cfg, gaps, angle, alpha) {
  if (alpha < 0.008) return;
  const r         = cfg.rFr * w;
  const totalGap  = gaps.reduce((s, g) => s + g, 0);
  const arcAvail  = 1 - totalGap;
  const segFrac   = arcAvail / cfg.segs;

  _ctx.save();
  _ctx.lineCap     = 'butt';
  _ctx.strokeStyle = _c(alpha);
  _ctx.lineWidth   = cfg.lw;

  let cursor = angle;
  for (let i = 0; i < cfg.segs; i++) {
    const segSpan = segFrac * TWO_PI;
    const gapSpan = gaps[i] * TWO_PI;
    _ctx.beginPath();
    _ctx.arc(cx, cy, r, cursor, cursor + segSpan);
    _ctx.stroke();
    // Leading-edge bright dot
    const ex = cx + Math.cos(cursor + segSpan) * r;
    const ey = cy + Math.sin(cursor + segSpan) * r;
    _ctx.beginPath();
    _ctx.arc(ex, ey, cfg.lw * 1.4, 0, TWO_PI);
    _ctx.fillStyle = _c(_clamp(alpha * 2.6));
    _ctx.fill();
    cursor += segSpan + gapSpan;
  }
  _ctx.restore();
}

// Containment ring — single draw pass (called multiple times for glow)
function _drawContRing(cx, cy, r, alpha, lw) {
  if (alpha < 0.008) return;
  const totalGap = _contGaps.reduce((s, g) => s + g, 0);
  const arcAvail  = 1 - totalGap;
  const segFrac   = arcAvail / CONT_SEGS;

  _ctx.save();
  _ctx.lineCap     = 'round';
  _ctx.lineWidth   = lw;
  _ctx.strokeStyle = _c(alpha);

  let cursor = _contAng;
  for (let i = 0; i < CONT_SEGS; i++) {
    const segSpan = segFrac * TWO_PI;
    const gapSpan = _contGaps[i] * TWO_PI;
    _ctx.beginPath();
    _ctx.arc(cx, cy, r, cursor, cursor + segSpan);
    _ctx.stroke();
    const ex = cx + Math.cos(cursor + segSpan) * r;
    const ey = cy + Math.sin(cursor + segSpan) * r;
    _ctx.beginPath();
    _ctx.arc(ex, ey, lw * 0.85, 0, TWO_PI);
    _ctx.fillStyle = _c(_clamp(alpha * 2.8));
    _ctx.fill();
    cursor += segSpan + gapSpan;
  }
  _ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// Surge draw  (5 types, distinct visual signatures)
// ─────────────────────────────────────────────────────────────

function _drawSurge(cx, cy, w, sl) {
  _ctx.save();

  switch (_surgeType) {

    case 0: {
      // INTERNAL FLARE — nucleus blazes, field whitens
      _ctx.globalCompositeOperation = 'lighter';
      const fr = w * 0.22 * sl;
      const g  = _ctx.createRadialGradient(cx, cy, 0, cx, cy, fr);
      g.addColorStop(0,    _hot(0.60 * sl));
      g.addColorStop(0.28, _c(0.28 * sl));
      g.addColorStop(1,    _c(0));
      _ctx.fillStyle = g;
      _ctx.beginPath();
      _ctx.arc(cx, cy, fr, 0, TWO_PI);
      _ctx.fill();
      break;
    }

    case 1: {
      // CONTAINMENT PULSE — three staggered outward ripples
      const baseR = w * R_CONT;
      for (let k = 0; k < 3; k++) {
        const rip = sl - k * 0.30;
        if (rip <= 0) continue;
        const rr = baseR + w * 0.16 * (1 - rip);
        _ctx.beginPath();
        _ctx.arc(cx, cy, rr, 0, TWO_PI);
        _ctx.strokeStyle = _c(rip * 0.50);
        _ctx.lineWidth   = 1.2 * rip;
        _ctx.stroke();
      }
      break;
    }

    case 2: {
      // PLASMA INSTABILITY — the whole field flares
      _ctx.globalCompositeOperation = 'lighter';
      const ir = w * 0.28 * sl;
      const g  = _ctx.createRadialGradient(cx, cy, 0, cx, cy, ir);
      g.addColorStop(0,    _c(0.26 * sl));
      g.addColorStop(0.55, _c(0.10 * sl));
      g.addColorStop(1,    _c(0));
      _ctx.fillStyle = g;
      _ctx.beginPath();
      _ctx.arc(cx, cy, w * 0.50, 0, TWO_PI);  // fill to orb edge
      _ctx.fill();
      break;
    }

    case 3: {
      // ENERGY COMPRESSION — containment ring blazes, inner field compresses
      const cr = w * R_CONT;
      // Bright outer ring
      _ctx.beginPath();
      _ctx.arc(cx, cy, cr, 0, TWO_PI);
      _ctx.strokeStyle = _c(sl * 0.70);
      _ctx.lineWidth   = 3.0 * sl;
      _ctx.stroke();
      // Compressed inner glow
      _ctx.globalCompositeOperation = 'lighter';
      const g = _ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 0.82);
      g.addColorStop(0,   _c(sl * 0.14));
      g.addColorStop(0.7, _c(sl * 0.05));
      g.addColorStop(1,   _c(0));
      _ctx.fillStyle = g;
      _ctx.beginPath();
      _ctx.arc(cx, cy, cr * 0.82, 0, TWO_PI);
      _ctx.fill();
      break;
    }

    case 4: {
      // RESONANCE WAVE — deep ring expands outward from nucleus, two echoes
      const t    = 1 - sl;   // 0 at start → 1 at end (wave expands outward)
      const wR   = w * 0.44 * t;
      const wA   = sl * 0.42;
      _ctx.beginPath();
      _ctx.arc(cx, cy, wR, 0, TWO_PI);
      _ctx.strokeStyle = _c(wA);
      _ctx.lineWidth   = 2.2 * sl;
      _ctx.stroke();
      if (t > 0.18) {
        const e1 = wR * 0.62;
        _ctx.beginPath();
        _ctx.arc(cx, cy, e1, 0, TWO_PI);
        _ctx.strokeStyle = _c(wA * 0.42);
        _ctx.lineWidth   = 1.0;
        _ctx.stroke();
      }
      if (t > 0.40) {
        const e2 = wR * 0.34;
        _ctx.beginPath();
        _ctx.arc(cx, cy, e2, 0, TWO_PI);
        _ctx.strokeStyle = _c(wA * 0.20);
        _ctx.lineWidth   = 0.7;
        _ctx.stroke();
      }
      break;
    }
  }

  _ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// Static fallback  (prefers-reduced-motion)
// ─────────────────────────────────────────────────────────────

function _drawStatic() {
  if (!_ctx || !_canvas) return;
  const w  = _canvas.width / _dpr;
  const cx = w * 0.5;
  const cy = w * 0.5;

  // Nuclear haze
  const g1 = _ctx.createRadialGradient(cx, cy, 0, cx, cy, w * R_NUC_HZ);
  g1.addColorStop(0,   _c(0.30));
  g1.addColorStop(0.5, _c(0.12));
  g1.addColorStop(1,   _c(0));
  _ctx.fillStyle = g1;
  _ctx.beginPath();
  _ctx.arc(cx, cy, w * R_NUC_HZ, 0, TWO_PI);
  _ctx.fill();

  // Inner glow
  const g2 = _ctx.createRadialGradient(cx, cy, 0, cx, cy, w * R_NUC_IG);
  g2.addColorStop(0,   _hot(0.70));
  g2.addColorStop(0.5, _c(0.30));
  g2.addColorStop(1,   _c(0));
  _ctx.fillStyle = g2;
  _ctx.beginPath();
  _ctx.arc(cx, cy, w * R_NUC_IG, 0, TWO_PI);
  _ctx.fill();

  // Hard point
  _ctx.beginPath();
  _ctx.arc(cx, cy, w * R_NUC_PT, 0, TWO_PI);
  _ctx.fillStyle = _hot(0.90);
  _ctx.fill();

  // Static containment ring (partial — avoids perfect circle)
  _ctx.beginPath();
  _ctx.arc(cx, cy, w * R_CONT, 0.5, 0.5 + TWO_PI * 0.80);
  _ctx.strokeStyle = _c(0.55);
  _ctx.lineWidth   = 1.2;
  _ctx.stroke();
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function _rnd(min, max) { return min + Math.random() * (max - min); }
