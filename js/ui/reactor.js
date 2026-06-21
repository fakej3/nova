/**
 * NOVA Reactor Core — Intelligence Engine
 *
 * Draw order (back → front):
 *   0  Polar grid               — precision reference structure
 *   1  Radial spokes            — 8 lines nucleus → containment
 *   2  Inner geo ring           — 4 segs, fast CW
 *   3  Mid geo ring             — 4 segs, slow CCW
 *   4  Containment ring         — 5 segs, primary structure, 2-3 passes
 *   5  Outer geo ring           — 3 segs, very slow CCW
 *   6  Arc fragments            — 3 drifting arcs
 *   7  Chamber glow             — cursor-aware offset fill, additive
 *   8  Inner glow               — nucleus halo, additive
 *   9  Nucleus hard point       — THE focal element, always bright
 *  10  Surge overlay            — rare events 30–120 s
 */

import { Bus, EVENTS }  from '../core/bus.js';
import { State }        from '../core/state.js';
import { getAwareness } from './awareness.js';

const TWO_PI = Math.PI * 2;

const STATE_ENERGY = {
  idle:       0.26,
  listening:  0.58,
  thinking:   0.96,
  responding: 0.80,
  success:    0.65,
  error:      0.42,
  offline:    0.06,
};

const R_NUC_PT   = 0.058;
const R_NUC_IG   = 0.120;
const R_INNER    = 0.165;
const R_MID      = 0.235;
const R_CONT     = 0.305;
const R_OUTER    = 0.390;
const R_ATM      = 0.460;

let _canvas   = null;
let _ctx      = null;
let _dpr      = 1;
let _rafId    = null;
let _reduced  = false;
let _isMobile = false;
let _colorRgb = '0, 212, 255';

let _t      = 0;
let _energy = 0.32;
let _thinkP = 0;

let _curNX = 0;
let _curNY = 0;

export function setReactorCursor(nx, ny) {
  _curNX = nx;
  _curNY = ny;
}

let _gA0 = Math.random() * TWO_PI;
let _gA1 = Math.random() * TWO_PI;
let _gA2 = Math.random() * TWO_PI;
let _contAng  = Math.random() * TWO_PI;
let _innerAng = Math.random() * TWO_PI;
let _sweepAng = Math.random() * TWO_PI;

const _orbParticles = [
  { rFr: R_INNER, vel:  0.0028, ph: 0.00 },
  { rFr: R_MID,   vel: -0.0016, ph: 1.57 },
  { rFr: R_CONT,  vel:  0.0010, ph: 3.14 },
  { rFr: R_OUTER, vel: -0.0006, ph: 4.71 },
];

const _arcFrags = Array.from({ length: 3 }, (_, i) => ({
  ang:  Math.random() * TWO_PI,
  span: 0.28 + Math.random() * 0.30,
  r:    [0.192, 0.248, 0.278][i] + (Math.random() - 0.5) * 0.018,
  vel:  (i % 2 === 0 ? 1 : -1) * (0.00020 + Math.random() * 0.00014),
  base: 0.018 + Math.random() * 0.006,
  ph:   Math.random() * TWO_PI,
}));

let _awIdleLevel = 0;

let _surgePhase = 0;
let _surgeLevel = 0;
let _surgeType  = 0;
let _surgeBorn  = 0;
let _surgeNext  = Date.now() + _rnd(30000, 120000);

const _GEO = [
  { rFr: R_INNER, segs: 4, gapF: 0.155, speed:  0.0035, lw: 0.9, base: 0.32 },
  { rFr: R_MID,   segs: 4, gapF: 0.145, speed: -0.0018, lw: 0.7, base: 0.20 },
  { rFr: R_OUTER, segs: 3, gapF: 0.185, speed: -0.0007, lw: 0.55, base: 0.10 },
];

const _geoGaps = _GEO.map(g =>
  Array.from({ length: g.segs }, () => g.gapF * (0.70 + Math.random() * 0.60))
);

const CONT_SEGS = 5;
const _contGaps = Array.from({ length: CONT_SEGS }, () =>
  0.055 + Math.random() * 0.085
);

export function initReactor() {
  _reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  _isMobile = window.innerWidth <= 768;

  const orb = document.getElementById('orb');
  if (!orb) return;

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

function _readColor() {
  _colorRgb = getComputedStyle(document.documentElement)
    .getPropertyValue('--orb-color-rgb').trim() || '0, 212, 255';
}

function _c(a) {
  return `rgba(${_colorRgb},${_clamp(a).toFixed(3)})`;
}

function _hot(a) {
  const [r, g, b] = _colorRgb.split(',').map(Number);
  const rh = Math.round(r + (255 - r) * 0.82);
  const gh = Math.round(g + (255 - g) * 0.80);
  const bh = Math.round(b + (255 - b) * 0.60);
  return `rgba(${rh},${gh},${bh},${_clamp(a).toFixed(3)})`;
}

function _cool(a) {
  const [r, g, b] = _colorRgb.split(',').map(Number);
  const rc = Math.round(r * 0.86);
  const gc = Math.round(g * 0.95);
  const bc = Math.min(255, Math.round(b + (255 - b) * 0.14));
  return `rgba(${rc},${gc},${bc},${_clamp(a).toFixed(3)})`;
}

function _clamp(a) { return Math.max(0, Math.min(1, a)); }

function _tickSurge(state) {
  const now = Date.now();
  if (_surgePhase === 0 && now >= _surgeNext && state !== 'offline') {
    _surgePhase = 1; _surgeType = Math.floor(Math.random() * 5); _surgeBorn = now;
  }
  if (_surgePhase === 1) {
    _surgeLevel = Math.min(1, (now - _surgeBorn) / 800);
    if (_surgeLevel >= 1) { _surgePhase = 2; _surgeBorn = now; }
  }
  if (_surgePhase === 2 && (now - _surgeBorn) > 600) { _surgePhase = 3; _surgeBorn = now; }
  if (_surgePhase === 3) {
    _surgeLevel = Math.max(0, 1 - (now - _surgeBorn) / 2500);
    if (_surgeLevel <= 0) { _surgePhase = 0; _surgeLevel = 0; _surgeNext = now + _rnd(30000, 120000); }
  }
}

function _loop() {
  if (!_ctx || !_canvas) { _rafId = requestAnimationFrame(_loop); return; }
  _t++;

  const w  = _canvas.width  / _dpr;
  const h  = _canvas.height / _dpr;
  const cx = w * 0.5;
  const cy = h * 0.5;

  const ora     = getAwareness();
  const idleMul = _awIdleLevel === 2 ? 0.42 : _awIdleLevel === 1 ? 0.70 : 1.0;
  const timeMod = ora.timeModifier;
  const spd     = idleMul * timeMod;

  const state   = State.get('orbState') || 'idle';
  const eTarget = Math.min(1, (STATE_ENERGY[state] ?? 0.32) + ora.energy * 0.16);
  _energy      += (eTarget - _energy) * 0.020;

  _thinkP += ((state === 'thinking' ? 1 : 0) - _thinkP) * 0.028;
  const tp = _thinkP;

  _tickSurge(state);
  const sl = _surgeLevel;

  const tBoost = 1 + tp * 1.85;
  _gA0      +=  0.0052  * spd * tBoost;
  _gA1      += -0.0020  * spd * tBoost;
  _gA2      += -0.00042 * spd;
  _contAng  += -0.00072 * spd;
  _innerAng +=  0.0018  * spd * tBoost;
  _sweepAng +=  0.00055 * spd;
  for (const f of _arcFrags) f.ang += f.vel * spd;
  for (const p of _orbParticles) p.ph += p.vel * spd;

  const s1 = Math.sin(_t * 0.026);
  const s2 = Math.sin(_t * 0.018 + 1.3);
  const s3 = Math.sin(_t * 0.038 + 2.6);
  const s5 = Math.sin(_t * 0.055 + 1.9);

  _ctx.clearRect(0, 0, w, h);

  // ── LAYER 0: Polar grid ──────────────────────────────────────
  {
    const a = (0.040 + _energy * 0.022) * timeMod;
    if (a > 0.004) {
      _ctx.save();
      _ctx.strokeStyle = _c(a);

      // Concentric guide circles
      _ctx.lineWidth = 0.35;
      for (const rFr of [0.16, 0.24, 0.32, 0.41]) {
        _ctx.beginPath();
        _ctx.arc(cx, cy, rFr * w, 0, TWO_PI);
        _ctx.stroke();
      }

      // 8 radial guide lines
      _ctx.lineWidth = 0.30;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * TWO_PI;
        _ctx.beginPath();
        _ctx.moveTo(cx + Math.cos(ang) * 0.09 * w, cy + Math.sin(ang) * 0.09 * w);
        _ctx.lineTo(cx + Math.cos(ang) * 0.39 * w, cy + Math.sin(ang) * 0.39 * w);
        _ctx.stroke();
      }

      // 4 tick marks at cardinal points on containment ring
      _ctx.lineWidth = 0.6;
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * TWO_PI;
        const r0  = R_CONT * w - 4;
        const r1  = R_CONT * w + 4;
        _ctx.beginPath();
        _ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        _ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        _ctx.strokeStyle = _c(a * 2.2);
        _ctx.stroke();
      }

      _ctx.restore();
    }
  }

  // ── LAYER 1: Radial spokes ───────────────────────────────────
  {
    const count = _isMobile ? 6 : 8;
    const rIn   = w * 0.09;
    const rOut  = w * (R_CONT - 0.022);

    _ctx.save();
    _ctx.lineCap = 'round';

    for (let i = 0; i < count; i++) {
      const ang   = (i / count) * TWO_PI + _innerAng * 0.08 + s2 * 0.022;
      const pulse = (Math.sin(_t * 0.030 + i * 1.05) + 1) * 0.5;
      const a     = (0.030 + _energy * 0.052 + pulse * 0.030) * timeMod;

      const x1 = cx + Math.cos(ang) * rIn;
      const y1 = cy + Math.sin(ang) * rIn;
      const x2 = cx + Math.cos(ang) * rOut;
      const y2 = cy + Math.sin(ang) * rOut;
      const g  = _ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0,    _c(a * 2.4));
      g.addColorStop(0.38, _c(a * 0.9));
      g.addColorStop(0.78, _c(a * 0.28));
      g.addColorStop(1,    _c(0));

      _ctx.beginPath();
      _ctx.moveTo(x1, y1);
      _ctx.lineTo(x2, y2);
      _ctx.strokeStyle = g;
      _ctx.lineWidth   = 0.50;
      _ctx.stroke();
    }
    _ctx.restore();
  }

  // ── LAYER 1b: Radar sweep ────────────────────────────────────
  {
    const sweepSpan = Math.PI * 0.55;
    const sweepA    = (0.022 + _energy * 0.028) * timeMod;
    if (sweepA > 0.003) {
      _ctx.save();
      const sweepR = w * R_CONT * 0.98;
      const g = _ctx.createConicalGradient
        ? null  // not available — use manual sector
        : null;

      // Pie-slice fill (manual wedge)
      const steps = 28;
      _ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < steps; i++) {
        const t0 = _sweepAng + (i / steps) * sweepSpan;
        const t1 = _sweepAng + ((i + 1) / steps) * sweepSpan;
        const fade = 1 - i / steps;
        _ctx.beginPath();
        _ctx.moveTo(cx, cy);
        _ctx.arc(cx, cy, sweepR, t0, t1);
        _ctx.closePath();
        _ctx.fillStyle = _c(sweepA * fade * fade);
        _ctx.fill();
      }

      // Bright leading arm
      _ctx.beginPath();
      _ctx.moveTo(cx, cy);
      _ctx.lineTo(
        cx + Math.cos(_sweepAng) * sweepR,
        cy + Math.sin(_sweepAng) * sweepR
      );
      _ctx.strokeStyle = _c(sweepA * 3.2);
      _ctx.lineWidth   = 0.7;
      _ctx.lineCap     = 'round';
      _ctx.stroke();
      _ctx.restore();
    }
  }

  // ── LAYER 2: Inner geo ring ──────────────────────────────────
  {
    const a = (_GEO[0].base + _energy * 0.22) * timeMod;
    _drawGeoRing(cx, cy, w, _GEO[0], _geoGaps[0], _innerAng, a);
  }

  // ── LAYER 3: Mid geo ring ────────────────────────────────────
  {
    const a = (_GEO[1].base + _energy * 0.16) * timeMod;
    _drawGeoRing(cx, cy, w, _GEO[1], _geoGaps[1], _gA1, a);
  }

  // ── LAYER 4: Containment ring ────────────────────────────────
  {
    const surgeBoost = _surgeType === 3 ? sl * 0.28 : 0;
    const contR = w * R_CONT * (_surgeType === 3 ? (1 - sl * 0.08) : 1);
    const contA = (0.48 + _energy * 0.30 + tp * 0.14 + surgeBoost) * timeMod;

    const passes = _isMobile ? 1 : 2;
    for (let p = passes - 1; p >= 0; p--) {
      _drawContRing(cx, cy, contR, contA * (0.22 + p * 0.38), 0.9 + p * 2.2);
    }
    _drawContRing(cx, cy, contR, contA, 0.9);
  }

  // ── LAYER 4b: Orbital particles ─────────────────────────────
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    for (const p of _orbParticles) {
      const pr = p.rFr * w;
      const px = cx + Math.cos(p.ph) * pr;
      const py = cy + Math.sin(p.ph) * pr;
      const pa = (0.55 + _energy * 0.45) * timeMod;

      // Glow halo
      const halo = _ctx.createRadialGradient(px, py, 0, px, py, 4.5);
      halo.addColorStop(0,   _hot(pa * 0.80));
      halo.addColorStop(0.4, _c(pa * 0.28));
      halo.addColorStop(1,   _c(0));
      _ctx.fillStyle = halo;
      _ctx.beginPath();
      _ctx.arc(px, py, 4.5, 0, TWO_PI);
      _ctx.fill();

      // Hard dot
      _ctx.beginPath();
      _ctx.arc(px, py, 1.4, 0, TWO_PI);
      _ctx.fillStyle = _hot(Math.min(1, pa * 1.4));
      _ctx.fill();
    }
    _ctx.restore();
  }

  // ── LAYER 5: Outer geo ring ──────────────────────────────────
  {
    const a = (_GEO[2].base + _energy * 0.10) * timeMod;
    _drawGeoRing(cx, cy, w, _GEO[2], _geoGaps[2], _gA2, a);
  }

  // ── LAYER 6: Arc fragments ───────────────────────────────────
  {
    _ctx.save();
    _ctx.lineCap = 'round';
    for (const f of _arcFrags) {
      const breathe = Math.sin(_t * 0.019 + f.ph) * 0.16 + 0.84;
      const a = f.base * (0.80 + _energy * 2.2) * breathe * timeMod;
      if (a < 0.004) continue;
      _ctx.beginPath();
      _ctx.arc(cx, cy, f.r * w, f.ang, f.ang + f.span);
      _ctx.strokeStyle = _c(a);
      _ctx.lineWidth = 0.50;
      _ctx.stroke();
    }
    _ctx.restore();
  }

  // ── LAYER 7: Chamber glow ────────────────────────────────────
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    const offX  = cx + (s1 * 0.015 + s3 * 0.008 + _curNX * 0.050) * w;
    const offY  = cy + (s2 * 0.012 + _curNY * 0.050) * w;
    const chamR = w * (0.168 + tp * 0.055 + (_surgeType === 0 ? sl * 0.058 : 0));
    const chamA = (0.042 + _energy * 0.052 + tp * 0.058) * timeMod
      + (_surgeType === 0 ? sl * 0.09 : 0);

    const g = _ctx.createRadialGradient(offX, offY, 0, offX, offY, chamR);
    g.addColorStop(0,    _c(chamA * 1.4));
    g.addColorStop(0.40, _c(chamA * 0.65));
    g.addColorStop(1,    _c(0));
    _ctx.fillStyle = g;
    _ctx.beginPath();
    _ctx.arc(offX, offY, chamR, 0, TWO_PI);
    _ctx.fill();
    _ctx.restore();
  }

  // ── LAYER 8: Inner glow ──────────────────────────────────────
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    const nucScale = 1 - tp * 0.25;
    const surgeNuc = (_surgeType === 0) ? sl : 0;
    const igR = w * R_NUC_IG * nucScale * (1 + s1 * 0.07);
    const igA = (0.24 + _energy * 0.16 + surgeNuc * 0.14) * timeMod;

    const g = _ctx.createRadialGradient(cx, cy, 0, cx, cy, igR);
    g.addColorStop(0,    _hot(igA * 0.45));
    g.addColorStop(0.22, _hot(igA));
    g.addColorStop(0.55, _c(igA * 0.55));
    g.addColorStop(0.88, _c(igA * 0.12));
    g.addColorStop(1,    _c(0));
    _ctx.fillStyle = g;
    _ctx.beginPath();
    _ctx.arc(cx, cy, igR, 0, TWO_PI);
    _ctx.fill();
    _ctx.restore();
  }

  // ── LAYER 9: Nucleus ─────────────────────────────────────────
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    const nucScale = 1 - tp * 0.22;
    const surgeNuc = (_surgeType === 0) ? sl * 0.9 : 0;
    const pulse    = s5 * 0.5 + 0.5;

    const ringR = w * R_NUC_PT * nucScale * (1.8 + pulse * 0.22);
    const ringA = (0.92 + _energy * 0.22 + surgeNuc * 0.18) * timeMod;
    {
      const g = _ctx.createRadialGradient(cx, cy, 0, cx, cy, ringR);
      g.addColorStop(0,    _hot(ringA));
      g.addColorStop(0.42, _c(ringA * 0.50));
      g.addColorStop(1,    _c(0));
      _ctx.fillStyle = g;
      _ctx.beginPath();
      _ctx.arc(cx, cy, ringR, 0, TWO_PI);
      _ctx.fill();
    }

    const ptR = w * R_NUC_PT * nucScale * (0.65 + pulse * 0.10);
    _ctx.beginPath();
    _ctx.arc(cx, cy, ptR, 0, TWO_PI);
    _ctx.fillStyle = _hot(_clamp(0.97 + surgeNuc * 0.03));
    _ctx.fill();

    const coreR = w * R_NUC_PT * nucScale * 0.42;
    _ctx.beginPath();
    _ctx.arc(cx, cy, coreR, 0, TWO_PI);
    _ctx.fillStyle = `rgba(255,255,255,${_clamp(0.96 + surgeNuc * 0.04).toFixed(3)})`;
    _ctx.fill();
    _ctx.restore();
  }

  // ── LAYER 10: Surge overlay ──────────────────────────────────
  if (sl > 0.02) _drawSurge(cx, cy, w, sl);

  _rafId = requestAnimationFrame(_loop);
}

// ── Draw helpers ──────────────────────────────────────────────

function _drawGeoRing(cx, cy, w, cfg, gaps, angle, alpha) {
  if (alpha < 0.006) return;
  const r        = cfg.rFr * w;
  const totalGap = gaps.reduce((s, g) => s + g, 0);
  const arcAvail = 1 - totalGap;
  const segFrac  = arcAvail / cfg.segs;

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
    const ex = cx + Math.cos(cursor + segSpan) * r;
    const ey = cy + Math.sin(cursor + segSpan) * r;
    _ctx.beginPath();
    _ctx.arc(ex, ey, cfg.lw * 1.3, 0, TWO_PI);
    _ctx.fillStyle = _c(_clamp(alpha * 2.4));
    _ctx.fill();
    cursor += segSpan + gapSpan;
  }
  _ctx.restore();
}

function _drawContRing(cx, cy, r, alpha, lw) {
  if (alpha < 0.006) return;
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
    _ctx.fillStyle = _c(_clamp(alpha * 2.6));
    _ctx.fill();
    cursor += segSpan + gapSpan;
  }
  _ctx.restore();
}

function _drawSurge(cx, cy, w, sl) {
  _ctx.save();

  switch (_surgeType) {
    case 0: {
      _ctx.globalCompositeOperation = 'lighter';
      const fr = w * 0.20 * sl;
      const g  = _ctx.createRadialGradient(cx, cy, 0, cx, cy, fr);
      g.addColorStop(0,    _hot(0.55 * sl));
      g.addColorStop(0.30, _c(0.22 * sl));
      g.addColorStop(1,    _c(0));
      _ctx.fillStyle = g;
      _ctx.beginPath(); _ctx.arc(cx, cy, fr, 0, TWO_PI); _ctx.fill();
      break;
    }
    case 1: {
      const baseR = w * R_CONT;
      for (let k = 0; k < 3; k++) {
        const rip = sl - k * 0.30;
        if (rip <= 0) continue;
        _ctx.beginPath();
        _ctx.arc(cx, cy, baseR + w * 0.14 * (1 - rip), 0, TWO_PI);
        _ctx.strokeStyle = _c(rip * 0.45);
        _ctx.lineWidth   = 1.0 * rip;
        _ctx.stroke();
      }
      break;
    }
    case 2: {
      _ctx.globalCompositeOperation = 'lighter';
      const ir = w * 0.26 * sl;
      const g  = _ctx.createRadialGradient(cx, cy, 0, cx, cy, ir);
      g.addColorStop(0, _c(0.22 * sl)); g.addColorStop(0.55, _c(0.08 * sl)); g.addColorStop(1, _c(0));
      _ctx.fillStyle = g;
      _ctx.beginPath(); _ctx.arc(cx, cy, w * 0.48, 0, TWO_PI); _ctx.fill();
      break;
    }
    case 3: {
      const cr = w * R_CONT;
      _ctx.beginPath(); _ctx.arc(cx, cy, cr, 0, TWO_PI);
      _ctx.strokeStyle = _c(sl * 0.65); _ctx.lineWidth = 2.8 * sl; _ctx.stroke();
      _ctx.globalCompositeOperation = 'lighter';
      const g = _ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 0.80);
      g.addColorStop(0, _c(sl * 0.12)); g.addColorStop(0.7, _c(sl * 0.04)); g.addColorStop(1, _c(0));
      _ctx.fillStyle = g;
      _ctx.beginPath(); _ctx.arc(cx, cy, cr * 0.80, 0, TWO_PI); _ctx.fill();
      break;
    }
    case 4: {
      const t = 1 - sl;
      const wR = w * 0.42 * t;
      _ctx.beginPath(); _ctx.arc(cx, cy, wR, 0, TWO_PI);
      _ctx.strokeStyle = _c(sl * 0.38); _ctx.lineWidth = 2.0 * sl; _ctx.stroke();
      if (t > 0.20) {
        _ctx.beginPath(); _ctx.arc(cx, cy, wR * 0.60, 0, TWO_PI);
        _ctx.strokeStyle = _c(sl * 0.16); _ctx.lineWidth = 0.9; _ctx.stroke();
      }
      break;
    }
  }

  _ctx.restore();
}

function _drawStatic() {
  if (!_ctx || !_canvas) return;
  const w  = _canvas.width / _dpr;
  const cx = w * 0.5;
  const cy = w * 0.5;

  const g1 = _ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.22);
  g1.addColorStop(0, _c(0.28)); g1.addColorStop(0.5, _c(0.10)); g1.addColorStop(1, _c(0));
  _ctx.fillStyle = g1;
  _ctx.beginPath(); _ctx.arc(cx, cy, w * 0.22, 0, TWO_PI); _ctx.fill();

  const g2 = _ctx.createRadialGradient(cx, cy, 0, cx, cy, w * R_NUC_IG);
  g2.addColorStop(0, _hot(0.65)); g2.addColorStop(0.5, _c(0.28)); g2.addColorStop(1, _c(0));
  _ctx.fillStyle = g2;
  _ctx.beginPath(); _ctx.arc(cx, cy, w * R_NUC_IG, 0, TWO_PI); _ctx.fill();

  _ctx.beginPath(); _ctx.arc(cx, cy, w * R_NUC_PT, 0, TWO_PI);
  _ctx.fillStyle = _hot(0.88); _ctx.fill();

  _ctx.beginPath(); _ctx.arc(cx, cy, w * R_CONT, 0.5, 0.5 + TWO_PI * 0.80);
  _ctx.strokeStyle = _c(0.50); _ctx.lineWidth = 1.0; _ctx.stroke();
}

function _rnd(min, max) { return min + Math.random() * (max - min); }
