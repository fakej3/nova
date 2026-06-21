/**
 * NOVA Reactor Core — Premium Sci-Fi Energy Reactor
 *
 * Draw order (back → front):
 *   0  Deep atmospheric field    — soft radial fill, always on
 *   1  Procedural plasma         — 6 blobs, dual-freq, additive blend
 *   2  Energy streams            — 8 radial spokes, nucleus→containment
 *   3  Neural network            — nodes/edges/signals, energy-scaled opacity
 *   4  Inner geo ring            — 4 segs, CW
 *   5  Mid geo ring              — 4 segs, slow CCW
 *   6  Containment ring          — 5 segs, 3 glow passes — primary structure
 *   7  Outer geo ring            — 3 segs, very slow CCW, faint outer boundary
 *   8  Chamber glow              — cursor-aware offset fill, additive
 *   9  Nuclear haze              — cursor-aware soft fill, additive
 *  10  Inner glow                — colored core fill, additive
 *  11  Nucleus hard point        — THE focal element, additive, always bright
 *  12  Surge overlay             — rare events 30–120 s
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
  idle:       0.18,
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
let _gA2 = Math.random() * TWO_PI;   // outer (very slow CCW)

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

// ─────────────────────────────────────────────────────────────
// Procedural plasma  (6 blobs, dual-freq oscillators)
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
// Geometry rings — three depths (inner, mid, outer)
// ─────────────────────────────────────────────────────────────

const _GEO = [
  { rFr: R_INNER, segs: 4, gapF: 0.155, speed:  0.0035, lw: 1.0, base: 0.38 },
  { rFr: R_MID,   segs: 4, gapF: 0.145, speed: -0.0018, lw: 0.8, base: 0.24 },
  { rFr: R_OUTER, segs: 3, gapF: 0.185, speed: -0.0007, lw: 0.6, base: 0.12 },
];

const _geoGaps = _GEO.map(g =>
  Array.from({ length: g.segs }, () => g.gapF * (0.70 + Math.random() * 0.60))
);


// ─────────────────────────────────────────────────────────────
// Internal Neural Network
// Nodes, edges, signals, and analysis traces inside the
// containment ring. Everything has a purpose:
//
//   Node   — a processing point in NOVA's thought-space
//   Edge   — an active route between nodes (temporary, lifecycle: in→hold→out)
//   Signal — data packet traveling an active route
//   Trace  — brief analysis scan line (thinking state only)
//
// State behavior:
//   idle      → 4 nodes, 1 edge max, rare signals, slow drift
//   listening → 5 nodes cluster toward cursor, inward signal bias
//   thinking  → 7 nodes, 4 edges, rapid signals, analysis traces appear
//   responding→ 5 nodes, 3 edges, outward signal bias
//   success   → all connections briefly illuminate simultaneously
//   error     → nodes scatter, edges break, then slowly reform
// ─────────────────────────────────────────────────────────────

const NET_CFG = {
  offline:    { nodes: 0, maxEdges: 0, maxSigs: 0, traceHz: 0.000, edgeRate: 0.000 },
  idle:       { nodes: 4, maxEdges: 1, maxSigs: 1, traceHz: 0.000, edgeRate: 0.002 },
  listening:  { nodes: 5, maxEdges: 2, maxSigs: 2, traceHz: 0.000, edgeRate: 0.004 },
  thinking:   { nodes: 7, maxEdges: 4, maxSigs: 4, traceHz: 0.020, edgeRate: 0.010 },
  responding: { nodes: 5, maxEdges: 3, maxSigs: 3, traceHz: 0.000, edgeRate: 0.006 },
  success:    { nodes: 5, maxEdges: 5, maxSigs: 0, traceHz: 0.000, edgeRate: 0.000 },
  error:      { nodes: 3, maxEdges: 0, maxSigs: 0, traceHz: 0.000, edgeRate: 0.000 },
};

let _netNodes    = [];
let _netEdges    = [];
let _netSigs     = [];
let _netTraces   = [];
let _netPrevState = '';
let _netReady    = false;
let _netCuriousAt = Date.now() + _rnd(55000, 110000);

function _makeNode() {
  return {
    ang:       Math.random() * Math.PI * 2,
    r:         0.07 + Math.random() * 0.17,     // fraction of canvas w; 0.07–0.24
    dAng:      (Math.random() - 0.5) * 0.00022, // ~1.3°/s max angular drift
    dr:        (Math.random() - 0.5) * 0.00008, // very slow radial drift
    targetAng: null,
    targetR:   null,
    bright:    0,   // 0→1, brief spike when signal arrives, decays each frame
  };
}

function _initNet() {
  _netNodes = Array.from({ length: 4 }, _makeNode);
  _netEdges = []; _netSigs = []; _netTraces = [];
}

// Update logic: node drift, edge lifecycle, signal travel, trace spawn
function _updateNet(cx, cy, w, state, spd) {
  const cfg = NET_CFG[state] ?? NET_CFG.idle;

  // ── Adjust node count to match state ─────────────────────
  while (_netNodes.length < cfg.nodes) _netNodes.push(_makeNode());
  // Only remove a node that isn't anchoring any active edge
  while (_netNodes.length > cfg.nodes) {
    const idx = _netNodes.findIndex((_, i) =>
      !_netEdges.some(e => e.a === i || e.b === i)
    );
    if (idx < 0) break; // can't safely remove — wait for edges to dissolve
    _netNodes.splice(idx, 1);
    // Remap edge indices above the removed node
    _netEdges = _netEdges
      .filter(e => e.a !== idx && e.b !== idx)
      .map(e => ({
        ...e,
        a: e.a > idx ? e.a - 1 : e.a,
        b: e.b > idx ? e.b - 1 : e.b,
      }));
    _netSigs = _netSigs.filter(s => s.a !== idx && s.b !== idx)
      .map(s => ({
        ...s,
        a: s.a > idx ? s.a - 1 : s.a,
        b: s.b > idx ? s.b - 1 : s.b,
      }));
  }

  // ── Move nodes ────────────────────────────────────────────
  for (const n of _netNodes) {
    if (n.targetAng !== null) {
      // Deliberate relocation (curiosity / state transition)
      const dA = ((n.targetAng - n.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      n.ang += dA * 0.006;
      n.r   += (n.targetR - n.r) * 0.006;
      if (Math.abs(dA) < 0.015 && Math.abs(n.targetR - n.r) < 0.002) {
        n.targetAng = null; n.targetR = null;
      }
    } else {
      n.ang += n.dAng * spd;
      n.r   += n.dr   * spd;
    }
    // Listening: pull nodes gently toward cursor angle, slightly inward
    if (state === 'listening' && (_curNX !== 0 || _curNY !== 0)) {
      const curA = Math.atan2(_curNY, _curNX);
      const diff = ((curA - n.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      n.ang += diff * 0.0028;
      n.r   += (0.09 - n.r) * 0.0016;
    }
    // Error: nodes scatter
    if (state === 'error' && _netPrevState !== 'error') {
      n.dAng = (Math.random() - 0.5) * 0.006;
      n.dr   = (Math.random() - 0.5) * 0.003;
    }
    n.r = Math.max(0.06, Math.min(0.25, n.r));
  }

  // Brightness decay every frame
  for (const n of _netNodes) n.bright = Math.max(0, n.bright - 0.022);

  // ── Idle curiosity: spontaneous node relocation ───────────
  if (Date.now() > _netCuriousAt && state === 'idle') {
    _netCuriousAt = Date.now() + _rnd(55000, 110000);
    const n = _netNodes[Math.floor(Math.random() * _netNodes.length)];
    if (n) { n.targetAng = Math.random() * Math.PI * 2; n.targetR = 0.07 + Math.random() * 0.17; }
  }

  // ── Success: briefly illuminate ALL connections ───────────
  if (state === 'success' && _netPrevState !== 'success') {
    _netEdges.forEach(e => { e.phase = 'out'; e.phaseAt = Date.now(); });
    // Form a quick full-mesh set of short edges
    for (let i = 0; i < _netNodes.length - 1; i++) {
      _netEdges.push({
        a: i, b: i + 1,
        alpha: 1, phase: 'hold', phaseAt: Date.now(),
        dur: 900, fadeIn: 200, fadeOut: 700, hasSentSignal: true,
      });
    }
    // Also pulse node brightness
    for (const n of _netNodes) n.bright = 0.9;
  }

  // ── Error: drop all edges ─────────────────────────────────
  if (state === 'error' && _netPrevState !== 'error') {
    for (const e of _netEdges) { e.phase = 'out'; e.phaseAt = Date.now(); }
  }

  _netPrevState = state;

  // ── Update edge lifecycle ─────────────────────────────────
  const now = Date.now();
  for (let i = _netEdges.length - 1; i >= 0; i--) {
    const e  = _netEdges[i];
    // Guard: if a node was removed mid-frame, drop the edge
    if (!_netNodes[e.a] || !_netNodes[e.b]) { _netEdges.splice(i, 1); continue; }
    const dt = now - e.phaseAt;
    if (e.phase === 'in') {
      e.alpha = Math.min(1, dt / e.fadeIn);
      if (dt >= e.fadeIn) { e.phase = 'hold'; e.phaseAt = now; }
      // Spawn the first signal once the edge is half-visible
      if (!e.hasSentSignal && e.alpha > 0.45) {
        e.hasSentSignal = true;
        if (_netSigs.length < cfg.maxSigs) {
          // Listening: prefer inward (high-r → low-r). Responding: outward.
          const ni = _netNodes[e.a], nj = _netNodes[e.b];
          const fromA = state === 'listening' ? (ni.r >= nj.r) :
                        state === 'responding' ? (ni.r <= nj.r) :
                        (Math.random() < 0.5);
          _netSigs.push({
            a: fromA ? e.a : e.b,
            b: fromA ? e.b : e.a,
            t: 0,
            speed: 0.007 + Math.random() * 0.009,
          });
        }
      }
    } else if (e.phase === 'hold') {
      if (dt >= e.dur) { e.phase = 'out'; e.phaseAt = now; }
    } else {
      e.alpha = Math.max(0, 1 - dt / e.fadeOut);
      if (e.alpha <= 0) { _netEdges.splice(i, 1); }
    }
  }

  // ── Update signals ────────────────────────────────────────
  const sigSpeedMod = state === 'responding' ? 1.55 : state === 'thinking' ? 1.05 : 0.75;
  for (let i = _netSigs.length - 1; i >= 0; i--) {
    const s = _netSigs[i];
    if (!_netNodes[s.a] || !_netNodes[s.b]) { _netSigs.splice(i, 1); continue; }
    s.t += s.speed * sigSpeedMod * spd;
    if (s.t >= 1) {
      const dest = _netNodes[s.b];
      if (dest) dest.bright = Math.min(1, dest.bright + 0.80);
      _netSigs.splice(i, 1);
      // Chain signal from destination along another edge (thinking: 40%, others: 18%)
      const chainChance = state === 'thinking' ? 0.40 : 0.18;
      if (Math.random() < chainChance && _netSigs.length < cfg.maxSigs) {
        const nextEdge = _netEdges.find(
          e => (e.a === s.b || e.b === s.b) && e.phase === 'hold'
        );
        if (nextEdge) {
          const fromA = nextEdge.a === s.b;
          _netSigs.push({
            a: fromA ? nextEdge.a : nextEdge.b,
            b: fromA ? nextEdge.b : nextEdge.a,
            t: 0, speed: 0.007 + Math.random() * 0.009,
          });
        }
      }
    }
  }

  // ── Spawn new edges ───────────────────────────────────────
  if (_netEdges.length < cfg.maxEdges && _netNodes.length >= 2 && Math.random() < cfg.edgeRate) {
    const connected = new Set(
      _netEdges.map(e => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`)
    );
    let bestPair = null, bestDist = Infinity;
    for (let i = 0; i < _netNodes.length; i++) {
      for (let j = i + 1; j < _netNodes.length; j++) {
        if (connected.has(`${i}-${j}`)) continue;
        const ni = _netNodes[i], nj = _netNodes[j];
        const xi = cx + Math.cos(ni.ang) * ni.r * w;
        const yi = cy + Math.sin(ni.ang) * ni.r * w;
        const xj = cx + Math.cos(nj.ang) * nj.r * w;
        const yj = cy + Math.sin(nj.ang) * nj.r * w;
        const d  = Math.hypot(xi - xj, yi - yj);
        if (d < 0.34 * w && d < bestDist) { bestDist = d; bestPair = [i, j]; }
      }
    }
    if (bestPair) {
      _netEdges.push({
        a: bestPair[0], b: bestPair[1],
        alpha: 0, phase: 'in', phaseAt: now,
        dur: 2000 + Math.random() * 4000,
        fadeIn: 500, fadeOut: 700, hasSentSignal: false,
      });
    }
  }

  // ── Analysis traces (thinking state only) ────────────────
  if (state === 'thinking' && _netTraces.length < 3 && Math.random() < cfg.traceHz) {
    const ang1 = Math.random() * Math.PI * 2;
    const ang2 = ang1 + (0.3 + Math.random() * 0.9) * (Math.random() > 0.5 ? 1 : -1);
    const r1   = (0.04 + Math.random() * 0.22) * w;
    const r2   = (0.05 + Math.random() * 0.22) * w;
    _netTraces.push({
      x1: cx + Math.cos(ang1) * r1, y1: cy + Math.sin(ang1) * r1,
      x2: cx + Math.cos(ang2) * r2, y2: cy + Math.sin(ang2) * r2,
      born: now,
      dur:     380 + Math.random() * 580,
      fadeIn:  90,
      fadeOut: 220,
      peakA:   0.10 + Math.random() * 0.08,
    });
  }
  for (let i = _netTraces.length - 1; i >= 0; i--) {
    const tr = _netTraces[i];
    const dt = now - tr.born;
    if (dt >= tr.dur) { _netTraces.splice(i, 1); continue; }
    tr.alpha = tr.peakA * (
      dt < tr.fadeIn    ? dt / tr.fadeIn :
      dt > tr.dur - tr.fadeOut ? (tr.dur - dt) / tr.fadeOut :
      1
    );
  }
}

// Draw: traces → edges → signals → nodes
function _drawNet(cx, cy, w, state, timeMod) {
  if (!_netNodes.length && !_netTraces.length) return;
  _ctx.save();
  _ctx.lineCap = 'round';

  // Analysis traces — brief scan lines during thinking
  for (const tr of _netTraces) {
    const a = (tr.alpha ?? 0) * timeMod;
    if (a < 0.004) continue;
    _ctx.beginPath();
    _ctx.moveTo(tr.x1, tr.y1);
    _ctx.lineTo(tr.x2, tr.y2);
    _ctx.strokeStyle = _c(a);
    _ctx.lineWidth   = 0.55;
    _ctx.stroke();
  }

  // Edges — thin routes between nodes
  for (const e of _netEdges) {
    const ni = _netNodes[e.a], nj = _netNodes[e.b];
    if (!ni || !nj) continue;
    const xi = cx + Math.cos(ni.ang) * ni.r * w;
    const yi = cy + Math.sin(ni.ang) * ni.r * w;
    const xj = cx + Math.cos(nj.ang) * nj.r * w;
    const yj = cy + Math.sin(nj.ang) * nj.r * w;
    const a  = e.alpha * (0.10 + _energy * 0.18) * timeMod;
    if (a < 0.003) continue;
    _ctx.beginPath();
    _ctx.moveTo(xi, yi);
    _ctx.lineTo(xj, yj);
    _ctx.strokeStyle = _c(a);
    _ctx.lineWidth   = 0.65;
    _ctx.stroke();
  }

  // Signals — data packets traveling edges with a short trail
  for (const s of _netSigs) {
    const ni = _netNodes[s.a], nj = _netNodes[s.b];
    if (!ni || !nj) continue;
    const xi  = cx + Math.cos(ni.ang) * ni.r * w;
    const yi  = cy + Math.sin(ni.ang) * ni.r * w;
    const xj  = cx + Math.cos(nj.ang) * nj.r * w;
    const yj  = cy + Math.sin(nj.ang) * nj.r * w;
    const px  = xi + (xj - xi) * s.t;
    const py  = yi + (yj - yi) * s.t;
    const t0  = Math.max(0, s.t - 0.22);
    const tpx = xi + (xj - xi) * t0;
    const tpy = yi + (yj - yi) * t0;
    // Fading trail
    if (Math.hypot(px - tpx, py - tpy) > 0.5) {
      const g = _ctx.createLinearGradient(tpx, tpy, px, py);
      g.addColorStop(0, _c(0));
      g.addColorStop(1, _c(0.52 * timeMod));
      _ctx.beginPath();
      _ctx.moveTo(tpx, tpy);
      _ctx.lineTo(px, py);
      _ctx.strokeStyle = g;
      _ctx.lineWidth   = 0.9;
      _ctx.stroke();
    }
    // Signal head
    _ctx.beginPath();
    _ctx.arc(px, py, 1.8, 0, Math.PI * 2);
    _ctx.fillStyle = _c(0.78 * timeMod);
    _ctx.fill();
  }

  // Nodes — small stationary dots with brightness glow on signal arrival
  for (const n of _netNodes) {
    const nx = cx + Math.cos(n.ang) * n.r * w;
    const ny = cy + Math.sin(n.ang) * n.r * w;
    // Base visibility scales with energy so nodes are ghostlike at idle,
    // prominent during thinking. bright spike overrides when signaled.
    const baseVis = 0.08 + _energy * 0.28;
    const a  = (baseVis + n.bright * 0.52) * timeMod;
    if (a < 0.02) continue;
    _ctx.beginPath();
    _ctx.arc(nx, ny, 1.6, 0, Math.PI * 2);
    _ctx.fillStyle = _c(a);
    _ctx.fill();
    // Soft halo when signaled
    if (n.bright > 0.12) {
      const g = _ctx.createRadialGradient(nx, ny, 0, nx, ny, 4.5);
      g.addColorStop(0, _c(n.bright * 0.38 * timeMod));
      g.addColorStop(1, _c(0));
      _ctx.beginPath();
      _ctx.arc(nx, ny, 4.5, 0, Math.PI * 2);
      _ctx.fillStyle = g;
      _ctx.fill();
    }
  }

  _ctx.restore();
}

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

  _initNet();

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
  _gA0       +=  0.0052  * spd * tBoost;   // inner ring CW
  _gA1       += -0.0020  * spd * tBoost;   // mid ring CCW
  _gA2       += -0.00042 * spd;            // outer ring CCW (extremely slow)
  _contAng   += -0.00072 * spd;            // containment ring CCW
  _innerAng  +=  0.0018  * spd * tBoost;   // energy streams rotation

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
      const ang   = (i / count) * TWO_PI + _innerAng * 0.10 + s2 * 0.035;
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
  // LAYER 3 — Internal neural network
  // Nodes drift slowly inside containment ring. Edges form between
  // nearby nodes, carry signals, then dissolve. Analysis traces
  // flash during thinking. Nothing rotates forever — everything
  // appears, performs a task, and disappears.
  // ═══════════════════════════════════════════════════════════════
  _updateNet(cx, cy, w, state, spd);
  _drawNet(cx, cy, w, state, timeMod);

  // ═══════════════════════════════════════════════════════════════
  // LAYER 4 — Inner geometry ring  (R_INNER, fast CW, 4 segments)
  // ═══════════════════════════════════════════════════════════════
  {
    const a = (_GEO[0].base + _energy * 0.26) * timeMod;
    _drawGeoRing(cx, cy, w, _GEO[0], _geoGaps[0], _innerAng, a);
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 5 — Mid geometry ring  (R_MID, slow CCW, 4 segs)
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
  // LAYER 7 — Outer geometry ring  (R_OUTER, 3 segs, very slow CCW)
  // The outermost structural ring. Gives the orb a dramatic outer
  // boundary — the sense of a containment field surrounding the
  // inner reactor. Very faint at idle, brightens under energy.
  // ═══════════════════════════════════════════════════════════════
  {
    const a = (_GEO[2].base + _energy * 0.14) * timeMod;
    _drawGeoRing(cx, cy, w, _GEO[2], _geoGaps[2], _gA2, a);
  }

  // ═══════════════════════════════════════════════════════════════
  // LAYER 8 — Energy chamber glow  (additive, cursor-aware offset)
  // Shifts toward cursor — the core "notices" where the user is.
  // ═══════════════════════════════════════════════════════════════
  {
    _ctx.save();
    _ctx.globalCompositeOperation = 'lighter';
    // Cursor awareness: shift glow center up to 6.5% of canvas toward cursor
    const offX  = cx + (s1 * 0.018 + s3 * 0.010 + _curNX * 0.065) * w;
    const offY  = cy + (s2 * 0.015 + s4 * 0.008 + _curNY * 0.065) * w;
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
    const hazeX = cx + _curNX * 0.032 * w;
    const hazeY = cy + _curNY * 0.032 * w;

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
    const ringA = (0.70 + _energy * 0.22 + surgeNuc * 0.20) * timeMod;
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
    _ctx.fillStyle = _hot(_clamp(0.78 + surgeNuc * 0.12));
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
