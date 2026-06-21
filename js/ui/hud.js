/**
 * NOVA HUD — Behavioral Intelligence Layer
 *
 * Design law: every animation communicates state, attention, learning, or response.
 * Nothing exists solely because it looks interesting.
 *
 * Draw order:
 *   1. Mouse directional glow         — cursor awareness
 *   2. Absorption animations          — information traveling inward (learning)
 *   3. Geometric data paths           — internal thinking structures
 *   4. Memory ring  (R=78)            — inside glass; note count as arc fill
 *   5. Task ring    (R=88)            — inside glass; task dots + completion arc
 *   6. Activity ring (R=100)          — inside glass; behavior changes per state
 *   7. Scanner beam  (R=140)          — sweeps outside glass, biased toward cursor
 *   8. Flow pulses                    — responding: outward energy transfer
 *   9. Pulse rings                    — event feedback
 *  10. Cardinal labels
 *
 * Ring radii are INSIDE the orb glass sphere (~110px CSS radius).
 * They appear as data indicators visible through the glass — not external halos.
 *
 * Behavioral systems:
 *   Learning absorption — on note/memory/task created: particle travels from
 *     R=210 inward to nucleus over 2.2s. Brightens at glass edge (R≈110).
 *     Visual story: "information arrives → enters system → gets absorbed."
 *
 *   Scanner cursor awareness — scanner beam gently drifts toward cursor angle.
 *     The orb "looks" where the user is. Subtle, not mechanical.
 *
 *   Idle curiosity — every 45–90s at idle NOVA performs one intentional act:
 *     - Reconfiguration: internal paths clear and reform at new angles
 *     - Deep scan: internal pulse from center outward
 *     - Pattern shift: scanner briefly energizes then settles
 *     Feels like NOVA has internal activity, not just reactions.
 */

import { DB }           from '../core/db.js';
import { Bus, EVENTS }  from '../core/bus.js';
import { pulseOrb }     from './orb.js';
import { State }        from '../core/state.js';
import { getAwareness } from './awareness.js';

// ── Constants ─────────────────────────────────────────────────

const TWO_PI  = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const CANVAS_SIZE = 520;
const CX          = 260;
const CY          = 260;

// Ring radii — INSIDE the orb glass sphere (~R<110 in screen pixels)
const R_MEM    = 78;    // memory ring (note count)
const R_TASK   = 88;    // task ring (completion + pending dots)
const R_ACT    = 100;   // activity ring (state behavior)

// Exterior elements
const R_SCANNER   = 140;   // scanner sweeps just outside glass
const R_LABELS    = 185;
const R_PULSE_END = 260;

// ── Scanner speed & alpha per state ──────────────────────────

const SCAN_PARAMS = {
  offline:    { speed: 0.0004, alpha: 0.06 },
  idle:       { speed: 0.0025, alpha: 0.18 },
  listening:  { speed: 0.0055, alpha: 0.30 },
  thinking:   { speed: 0.0140, alpha: 0.46 },
  responding: { speed: 0.0100, alpha: 0.38 },
  success:    { speed: 0.0015, alpha: 0.12 },
  error:      { speed: 0.0080, alpha: 0.26 },
};

// ── Module state ──────────────────────────────────────────────

let _canvas = null;
let _ctx    = null;
let _dpr    = 1;
let _t      = 0;

let _colorRgb = '0, 212, 255';
let _isMobile = false;

// Scan params (lerped)
let _scanSpeed = SCAN_PARAMS.idle.speed;
let _scanAlpha = SCAN_PARAMS.idle.alpha;
let _scanAngle = -HALF_PI;

// Awareness
let _awIdleMul = 1.0;
let _awTimeMod = 1.0;
let _awTyping  = 0.0;

// Focus mode (typing concentrates the orb inward)
let _focusFade = 0;

// Data
let _noteCount   = 0;
let _taskTotal   = 0;
let _taskPending = 0;
let _sessionStart = Date.now();

// Functional ring state
const _rings = {
  mem:  { fill: 0, targetFill: 0, pulse: 0 },
  task: { fill: 0, targetFill: 0, pulse: 0 },
  act:  { pulse: 0 },
};

// Wave bars (listening state — 24 radial bars at R_ACT)
const _waveBars = Array.from({ length: 24 }, () => ({ h: 0 }));

// Geometric data paths (internal thinking structures)
const _paths      = [];
const MAX_PATHS   = 2;
let   _pathBoost  = 0;
let   _nextPathAt = Date.now() + _randMs(2000, 5000);

// Pulse rings
const _pulses   = [];
let   _nextIdle = Date.now() + _randMs(28000, 48000);

// Flow pulses (responding state — outward energy transfer)
const _flowPulses = [];

// Learning absorption — information traveling inward
const _absorptions = [];

// Mouse influence (normalized -1..1 from mouse.js)
let _mouseNX  = 0;
let _mouseNY  = 0;
let _hoverDist = 0;
let _hoverZone = 0;  // 0=none, 1=inner, 2=mid, 3=outer

// Idle curiosity
let _curiosityAt     = Date.now() + _randMs(45000, 90000);
let _curiosityActive = false;
let _curiosityType   = 0;
let _curiosityBorn   = 0;
let _curiosityDur    = 0;

// ── Public API ─────────────────────────────────────────────────

export function setHudMouseInfluence(nx, ny) {
  _mouseNX = nx;
  _mouseNY = ny;
}

// ── Init ──────────────────────────────────────────────────────

export async function initHud() {
  _canvas = document.getElementById('orb-hud-canvas');
  if (!_canvas) return;
  _ctx    = _canvas.getContext('2d');

  _isMobile = window.innerWidth <= 640;
  _dpr      = Math.min(window.devicePixelRatio || 1, 2);
  _sizeCanvas();
  window.addEventListener('resize', () => {
    _isMobile = window.innerWidth <= 640;
    _sizeCanvas();
  }, { passive: true });

  _readColor();
  Bus.on(EVENTS.THEME_CHANGED, () => requestAnimationFrame(_readColor));

  await _refreshCounts();

  // Ring reactions on data changes
  Bus.on(EVENTS.NOTE_CREATED,   () => { _noteCount++;   _rings.mem.pulse = 1;  _updateRingTargets(); _updateSystemBar(); _spawnAbsorption('note'); });
  Bus.on(EVENTS.NOTE_DELETED,   () => { _noteCount   = Math.max(0, _noteCount - 1); _updateRingTargets(); _updateSystemBar(); });
  Bus.on(EVENTS.TASK_CREATED,   () => { _taskTotal++; _taskPending++; _rings.task.pulse = 1; _updateRingTargets(); _updateSystemBar(); _spawnAbsorption('task'); });
  Bus.on(EVENTS.TASK_COMPLETED, () => { _taskPending = Math.max(0, _taskPending - 1); _rings.task.pulse = 1; _updateRingTargets(); _spawnPulse(); _updateSystemBar(); });
  Bus.on(EVENTS.TASK_DELETED,   () => { _taskPending = Math.max(0, _taskPending - 1); _taskTotal = Math.max(0, _taskTotal - 1); _updateRingTargets(); _updateSystemBar(); });
  Bus.on(EVENTS.MEMORY_CREATED, () => { _rings.mem.pulse = 0.8; _spawnAbsorption('memory'); });

  Bus.on(EVENTS.ORB_STATE_CHANGED, ({ state }) => {
    if (state === 'success') {
      _spawnPulse(60); setTimeout(() => _spawnPulse(80), 220); setTimeout(() => _spawnPulse(100), 440);
      _rings.act.pulse = 1;
      pulseOrb();
    }
    if (state === 'error') {
      _spawnPulse();
      _rings.act.pulse = 0.5;
      for (const p of _paths) p.phase = 'out';
    }
    if (state === 'responding') {
      for (let i = 0; i < 4; i++) setTimeout(() => _spawnFlowPulse(), i * 140);
    }
  });

  _updateRingTargets();
  _updateSystemBar();
  _updateGreeting();
  setInterval(_updateSystemBar, 1000);
  setInterval(_updateGreeting,  60000);

  requestAnimationFrame(_loop);
}

// ── Canvas sizing ─────────────────────────────────────────────

function _sizeCanvas() {
  if (!_canvas) return;
  _canvas.width  = CANVAS_SIZE * _dpr;
  _canvas.height = CANVAS_SIZE * _dpr;
  _ctx.scale(_dpr, _dpr);
}

// ── Color ─────────────────────────────────────────────────────

function _readColor() {
  _colorRgb = getComputedStyle(document.documentElement)
    .getPropertyValue('--orb-color-rgb').trim() || '0, 212, 255';
}

function _rgba(a) {
  return `rgba(${_colorRgb},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

// ── Data ──────────────────────────────────────────────────────

async function _refreshCounts() {
  try {
    const [notes, pending, all] = await Promise.all([
      DB.notes.getAll(),
      DB.tasks.getByStatus('pending'),
      DB.tasks.getAll ? DB.tasks.getAll() : Promise.resolve([]),
    ]);
    _noteCount   = notes.length;
    _taskPending = pending.length;
    _taskTotal   = all.length || pending.length;
  } catch { /* non-fatal */ }
  _updateRingTargets();
}

function _updateRingTargets() {
  _rings.mem.targetFill  = Math.min(1, _noteCount / 20);
  const done = Math.max(0, _taskTotal - _taskPending);
  _rings.task.targetFill = _taskTotal > 0 ? done / _taskTotal : 0;
}

// ── Main loop ─────────────────────────────────────────────────

function _loop() {
  if (!_canvas || !_ctx) return;
  _t++;

  const ora  = getAwareness();
  _awIdleMul = ora.idleLevel === 2 ? 0.35 : ora.idleLevel === 1 ? 0.62 : 1.0;
  _awTimeMod = ora.timeModifier;
  _awTyping  = Math.min(1, (ora.typingEnergy ?? 0) * 2.5);

  // Focus mode: orb concentrates inward when typing
  _focusFade += ((_awTyping > 0.15 ? 1.0 : 0.0) - _focusFade) * 0.04;

  // Hover zones
  _hoverDist = Math.sqrt(_mouseNX * _mouseNX + _mouseNY * _mouseNY);
  _hoverZone = _hoverDist < 0.10 ? 1
             : _hoverDist < 0.28 ? 2
             : _hoverDist < 0.55 ? 3 : 0;

  // Scan param lerp
  const state = State.get('orbState') || 'idle';
  const sp    = SCAN_PARAMS[state] ?? SCAN_PARAMS.idle;
  _scanSpeed += (sp.speed - _scanSpeed) * 0.035;
  _scanAlpha += (sp.alpha - _scanAlpha) * 0.035;

  // Scanner cursor awareness — gently drifts toward where user is
  const cursorAngle = Math.atan2(_mouseNY, _mouseNX);
  let angDiff = cursorAngle - _scanAngle;
  // Wrap to -PI..PI
  angDiff = ((angDiff % TWO_PI) + Math.PI * 3) % TWO_PI - Math.PI;
  // Idle curiosity type 1: scanner override (briefly reverses)
  const scanDir = (_curiosityActive && _curiosityType === 1) ? -1 : 1;
  const cursorPull = _hoverZone >= 2 ? angDiff * 0.0008 : angDiff * 0.00015;
  _scanAngle += (scanDir * _scanSpeed + cursorPull) * _awIdleMul * _awTimeMod;

  // Ring decay
  _rings.mem.fill  += (_rings.mem.targetFill  - _rings.mem.fill)  * 0.018;
  _rings.task.fill += (_rings.task.targetFill - _rings.task.fill) * 0.018;
  _rings.mem.pulse  = Math.max(0, _rings.mem.pulse  - 0.016);
  _rings.task.pulse = Math.max(0, _rings.task.pulse - 0.016);
  _rings.act.pulse  = Math.max(0, _rings.act.pulse  - 0.012);
  _pathBoost = Math.max(0, _pathBoost - 0.006);

  _maybeSpawnPath(state);
  _updatePaths();
  _updateWaveBars(state);
  _checkIdlePulse();
  _maybeSpawnFlowPulse(state);
  _checkCuriosity(state);

  _ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Focus: outer dims, inner brightens
  const outerDim   = 1 - _focusFade * 0.70;
  const innerBoost = 1 + _focusFade * 0.60;

  _drawMouseGlow();
  _drawAbsorptions();
  _drawPaths(innerBoost);
  _drawMemoryRing(outerDim);
  _drawTaskRing(outerDim);
  _drawActivityRing(outerDim, state);
  _drawScanner(outerDim);
  _drawFlowPulses();
  _drawPulses();
  _drawCardinalLabels(outerDim);

  requestAnimationFrame(_loop);
}

// ── Draw: mouse glow ──────────────────────────────────────────

function _drawMouseGlow() {
  if (_hoverDist < 0.02) return;
  const gx   = CX + _mouseNX * 50;
  const gy   = CY + _mouseNY * 50;
  const grad = _ctx.createRadialGradient(gx, gy, 6, CX, CY, 180);
  grad.addColorStop(0,   _rgba(0.055 * _awTimeMod));
  grad.addColorStop(0.5, _rgba(0.015 * _awTimeMod));
  grad.addColorStop(1,   _rgba(0));
  _ctx.save();
  _ctx.beginPath();
  _ctx.arc(CX, CY, 180, 0, TWO_PI);
  _ctx.fillStyle = grad;
  _ctx.fill();
  _ctx.restore();
}

// ── Learning absorption ───────────────────────────────────────
// When information is created (note/memory/task), a particle appears
// outside the orb and travels inward to the nucleus.
// It brightens as it crosses the glass edge (~R=110) and dims as it's absorbed.
// Visual story: information arrives → enters system → stored.

function _spawnAbsorption(type) {
  // Different entry angles per type give each data type its own quadrant
  const baseAngle = type === 'note'   ? -HALF_PI + (Math.random() - 0.5) * 1.2
                  : type === 'task'   ?  HALF_PI  + (Math.random() - 0.5) * 1.2
                  :                      0        + (Math.random() - 0.5) * 1.2;
  _absorptions.push({
    angle:    baseAngle,
    born:     Date.now(),
    dur:      2000 + Math.random() * 400,
    startR:   208,
    endR:     type === 'memory' ? 8 : 18,
  });
}

function _drawAbsorptions() {
  const now = Date.now();
  for (let i = _absorptions.length - 1; i >= 0; i--) {
    const a   = _absorptions[i];
    const age = now - a.born;
    if (age > a.dur) { _absorptions.splice(i, 1); continue; }
    const t = age / a.dur;
    const r = a.startR + (a.endR - a.startR) * _easeInOut(t);

    // Brightens as it crosses glass boundary (R≈108), dims after
    const glassProx = Math.max(0, 1 - Math.abs(r - 108) / 28);
    const alpha = Math.max(0.04, 0.18 + glassProx * 0.42 - t * 0.12) * _awTimeMod;

    // Trail (recedes from starting position, not from previous frame)
    const trailLen = 22 * (1 - t * 0.6);
    const tx = CX + Math.cos(a.angle) * Math.min(a.startR, r + trailLen);
    const ty = CY + Math.sin(a.angle) * Math.min(a.startR, r + trailLen);
    const hx = CX + Math.cos(a.angle) * r;
    const hy = CY + Math.sin(a.angle) * r;

    _ctx.save();
    _ctx.lineCap = 'round';
    const grad = _ctx.createLinearGradient(tx, ty, hx, hy);
    grad.addColorStop(0, _rgba(0));
    grad.addColorStop(1, _rgba(alpha));
    _ctx.beginPath();
    _ctx.moveTo(tx, ty);
    _ctx.lineTo(hx, hy);
    _ctx.strokeStyle = grad;
    _ctx.lineWidth   = 1.2;
    _ctx.stroke();
    // Head dot
    _ctx.beginPath();
    _ctx.arc(hx, hy, 2.2, 0, TWO_PI);
    _ctx.fillStyle = _rgba(Math.min(1, alpha * 2.4));
    _ctx.fill();
    _ctx.restore();
  }
}

// ── Geometric data paths ──────────────────────────────────────
// Internal lines that form, hold, and dissolve — the thinking feel.
// State-sensitive: more active when thinking or typing.

function _maybeSpawnPath(state) {
  if (_paths.length >= MAX_PATHS) return;
  if (Date.now() < _nextPathAt) return;
  if (state === 'offline' || state === 'responding' || state === 'success') return;

  const isThinking = state === 'thinking';
  const peakAlpha  = isThinking ? 0.32 + Math.random() * 0.14
                   : (0.10 + Math.random() * 0.08) * (1 + _focusFade * 0.7);
  const holdTime   = isThinking ? 3500 + Math.random() * 6000
                   : _focusFade > 0.4 ? 5000 + Math.random() * 5000
                   : 8000 + Math.random() * 12000;

  const ang1 = Math.random() * TWO_PI;
  const delta = Math.PI * 0.45 + Math.random() * Math.PI * 0.85;
  const ang2  = ang1 + delta * (Math.random() > 0.5 ? 1 : -1);

  _paths.push({
    ang1, r1: 44 + Math.random() * 34,
    ang2, r2: 40 + Math.random() * 36,
    alpha: 0,
    peakAlpha: peakAlpha * (1 + _pathBoost * 0.5),
    phase: 'in', phaseAt: Date.now(),
    holdTime, fadeIn: 1800, fadeOut: 2400,
  });

  _nextPathAt = Date.now() + (isThinking ? 1800 + Math.random() * 2500
    : _focusFade > 0.4 ? 2800 + Math.random() * 3500
    : 6000 + Math.random() * 10000);
}

function _updatePaths() {
  const now = Date.now();
  for (let i = _paths.length - 1; i >= 0; i--) {
    const p  = _paths[i];
    const dt = now - p.phaseAt;
    if (p.phase === 'in') {
      p.alpha = Math.min(p.peakAlpha, (dt / p.fadeIn) * p.peakAlpha);
      if (dt >= p.fadeIn) { p.phase = 'hold'; p.phaseAt = now; }
    } else if (p.phase === 'hold') {
      if (dt >= p.holdTime) { p.phase = 'out'; p.phaseAt = now; }
    } else {
      p.alpha = Math.max(0, p.peakAlpha * (1 - dt / p.fadeOut));
      if (p.alpha <= 0) _paths.splice(i, 1);
    }
  }
}

function _drawPaths(innerBoost) {
  if (!_paths.length) return;
  const mul = _awTimeMod * _awIdleMul * innerBoost
    * (_hoverZone === 1 ? 1.8 : _hoverZone === 2 ? 1.3 : 1);
  _ctx.save();
  _ctx.lineCap = 'round';
  for (const p of _paths) {
    const a = p.alpha * mul;
    if (a < 0.004) continue;
    const x1 = CX + Math.cos(p.ang1) * p.r1;
    const y1 = CY + Math.sin(p.ang1) * p.r1;
    const x2 = CX + Math.cos(p.ang2) * p.r2;
    const y2 = CY + Math.sin(p.ang2) * p.r2;
    _ctx.beginPath();
    _ctx.moveTo(x1, y1);
    _ctx.lineTo(x2, y2);
    _ctx.strokeStyle = _rgba(a);
    _ctx.lineWidth   = 0.8;
    _ctx.stroke();
    _ctx.fillStyle = _rgba(Math.min(1, a * 2.8));
    _ctx.beginPath(); _ctx.arc(x1, y1, 1.5, 0, TWO_PI); _ctx.fill();
    _ctx.beginPath(); _ctx.arc(x2, y2, 1.5, 0, TWO_PI); _ctx.fill();
  }
  _ctx.restore();
}

// ── Memory ring (R=78) ────────────────────────────────────────
// Inside the glass sphere. Arc fill = note count / 20. Pulses on NOTE_CREATED.
// Very faint at idle — only reveals itself during events or hover.

function _drawMemoryRing(outerDim) {
  const hBoost = _hoverZone >= 2 ? 1.8 : 1;
  const alpha  = (0.08 + _rings.mem.pulse * 0.52) * _awTimeMod * outerDim * hBoost;
  if (alpha < 0.004) return;
  _ctx.save();
  _ctx.lineCap = 'round';
  // Ghost ring
  _ctx.beginPath();
  _ctx.arc(CX, CY, R_MEM, 0, TWO_PI);
  _ctx.strokeStyle = _rgba(alpha * 0.18);
  _ctx.lineWidth   = 0.7;
  _ctx.stroke();
  // Data arc
  if (_rings.mem.fill > 0.01) {
    const span = _rings.mem.fill * TWO_PI;
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_MEM, -HALF_PI, -HALF_PI + span);
    _ctx.strokeStyle = _rgba(alpha * 0.95);
    _ctx.lineWidth   = 1.1;
    _ctx.stroke();
    const ex = CX + Math.cos(-HALF_PI + span) * R_MEM;
    const ey = CY + Math.sin(-HALF_PI + span) * R_MEM;
    _ctx.beginPath(); _ctx.arc(ex, ey, 1.5, 0, TWO_PI);
    _ctx.fillStyle = _rgba(Math.min(1, alpha * 1.8));
    _ctx.fill();
  }
  _ctx.restore();
}

// ── Task ring (R=88) ──────────────────────────────────────────
// Inside the glass sphere. Completion arc + pending dots.

function _drawTaskRing(outerDim) {
  const hBoost = _hoverZone >= 2 ? 1.8 : 1;
  const alpha  = (0.07 + _rings.task.pulse * 0.48) * _awTimeMod * outerDim * hBoost;
  if (alpha < 0.004) return;
  _ctx.save();
  _ctx.lineCap = 'round';
  _ctx.beginPath();
  _ctx.arc(CX, CY, R_TASK, 0, TWO_PI);
  _ctx.strokeStyle = _rgba(alpha * 0.14);
  _ctx.lineWidth   = 0.6;
  _ctx.stroke();
  if (_rings.task.fill > 0.01) {
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_TASK, -HALF_PI, -HALF_PI + _rings.task.fill * TWO_PI);
    _ctx.strokeStyle = _rgba(alpha * 0.85);
    _ctx.lineWidth   = 0.9;
    _ctx.stroke();
  }
  const dotCount = Math.min(10, _taskPending);
  if (dotCount > 0) {
    _ctx.fillStyle = _rgba(alpha * 0.75);
    for (let i = 0; i < dotCount; i++) {
      const ang = (TWO_PI / Math.max(dotCount, 3)) * i - HALF_PI + 0.20;
      _ctx.beginPath();
      _ctx.arc(CX + Math.cos(ang) * R_TASK, CY + Math.sin(ang) * R_TASK, 1.6, 0, TWO_PI);
      _ctx.fill();
    }
  }
  _ctx.restore();
}

// ── Activity ring (R=100) ─────────────────────────────────────
// Inside the glass sphere. Each state produces distinct visual behavior.
//
//   idle      → barely visible, slow ghost
//   listening → audio-wave bars with cursor-direction asymmetry
//   thinking  → segmented ring with drifting gaps
//   responding → bright ring (source of outward flow pulses)
//   success   → full synchronized ring pulse
//   error     → broken arcs with jitter

function _updateWaveBars(state) {
  if (state !== 'listening') {
    for (const bar of _waveBars) bar.h += (0 - bar.h) * 0.06;
    return;
  }
  for (let i = 0; i < _waveBars.length; i++) {
    const w1 = Math.sin(_t * 0.09 + i * 0.55);
    const w2 = Math.sin(_t * 0.14 + i * 1.20);
    // Cursor direction adds asymmetry: listening "hears" toward user
    const dir = Math.cos((i / _waveBars.length) * TWO_PI - Math.atan2(_mouseNY, _mouseNX)) * 0.35;
    const target = Math.max(0, (w1 * 0.55 + w2 * 0.35 + dir) * 7);
    _waveBars[i].h += (target - _waveBars[i].h) * 0.12;
  }
}

function _drawActivityRing(outerDim, state) {
  const pulse  = _rings.act.pulse;
  const hBoost = _hoverZone >= 2 ? 1.5 : 1;
  const stateA = state === 'idle'       ? 0.06
               : state === 'listening'  ? 0.26
               : state === 'thinking'   ? 0.18
               : state === 'responding' ? 0.36
               : state === 'success'    ? 0.55
               : state === 'error'      ? 0.16 : 0.04;
  const alpha = (stateA + pulse * 0.42) * _awTimeMod * outerDim * hBoost;
  _ctx.save();
  _ctx.lineCap = 'round';

  if (state === 'listening') {
    for (let i = 0; i < _waveBars.length; i++) {
      const h = _waveBars[i].h;
      if (h < 0.1) continue;
      const ang = (i / _waveBars.length) * TWO_PI - HALF_PI;
      _ctx.beginPath();
      _ctx.moveTo(CX + Math.cos(ang) * (R_ACT - 2), CY + Math.sin(ang) * (R_ACT - 2));
      _ctx.lineTo(CX + Math.cos(ang) * (R_ACT + h), CY + Math.sin(ang) * (R_ACT + h));
      _ctx.strokeStyle = _rgba((h / 9) * alpha * 2.4);
      _ctx.lineWidth   = 1.6;
      _ctx.stroke();
    }
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha * 0.28);
    _ctx.lineWidth   = 0.5;
    _ctx.stroke();

  } else if (state === 'thinking') {
    const segs    = 4;
    const gapFrac = 0.18;
    const segSpan = ((1 - gapFrac * segs) / segs) * TWO_PI;
    const gapSpan = gapFrac * TWO_PI;
    const offset  = _scanAngle * 0.20;
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 1.0;
    for (let i = 0; i < segs; i++) {
      const start = offset + i * (segSpan + gapSpan);
      _ctx.beginPath();
      _ctx.arc(CX, CY, R_ACT, start, start + segSpan);
      _ctx.stroke();
    }

  } else if (state === 'responding') {
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha * 0.88);
    _ctx.lineWidth   = 1.3;
    _ctx.stroke();

  } else if (state === 'success') {
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 1.6;
    _ctx.stroke();

  } else if (state === 'error') {
    const jitter = Math.sin(_t * 0.24) * 0.09;
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 0.9;
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, 0.1 + jitter, Math.PI - 0.1);
    _ctx.stroke();
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, Math.PI + 0.2 - jitter, TWO_PI - 0.2);
    _ctx.stroke();

  } else {
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha * 0.50);
    _ctx.lineWidth   = 0.4;
    _ctx.stroke();
  }
  _ctx.restore();
}

// ── Scanner beam ──────────────────────────────────────────────
// Sweeps just outside the glass sphere. Cursor bias: gently drifts
// toward where the cursor is. The orb "looks" at the user.

function _drawScanner(outerDim) {
  const hBoost = _hoverZone >= 2 ? 1.35 : 1;
  const sa     = _scanAlpha * _awTimeMod * _awIdleMul * outerDim * hBoost;
  if (sa < 0.005) return;
  const ex = CX + Math.cos(_scanAngle) * R_SCANNER;
  const ey = CY + Math.sin(_scanAngle) * R_SCANNER;
  _ctx.save();
  const grad = _ctx.createLinearGradient(CX, CY, ex, ey);
  grad.addColorStop(0,    _rgba(0));
  grad.addColorStop(0.40, _rgba(sa * 0.18));
  grad.addColorStop(0.82, _rgba(sa * 0.65));
  grad.addColorStop(1,    _rgba(sa));
  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.lineTo(ex, ey);
  _ctx.strokeStyle = grad;
  _ctx.lineWidth   = 1.2;
  _ctx.stroke();
  _ctx.beginPath();
  _ctx.arc(ex, ey, 1.6, 0, TWO_PI);
  _ctx.fillStyle = _rgba(sa * 1.5);
  _ctx.fill();
  // Sweep wedge
  const sg = _ctx.createRadialGradient(CX, CY, 30, CX, CY, R_SCANNER);
  sg.addColorStop(0, _rgba(0));
  sg.addColorStop(1, _rgba(sa * 0.08));
  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.arc(CX, CY, R_SCANNER, _scanAngle - 0.16, _scanAngle, false);
  _ctx.closePath();
  _ctx.fillStyle = sg;
  _ctx.fill();
  _ctx.restore();
}

// ── Flow pulses (responding state) ───────────────────────────
// Thin, fast rings expanding outward from orb center.
// "Information moving from the system to the world."

function _spawnFlowPulse() {
  _flowPulses.push({ r: 50, born: Date.now(), dur: 850 + Math.random() * 280 });
}

function _maybeSpawnFlowPulse(state) {
  if (state === 'responding' && Math.random() < 0.05) _spawnFlowPulse();
}

function _drawFlowPulses() {
  const now = Date.now();
  for (let i = _flowPulses.length - 1; i >= 0; i--) {
    const p   = _flowPulses[i];
    const age = now - p.born;
    if (age > p.dur) { _flowPulses.splice(i, 1); continue; }
    const t     = age / p.dur;
    const r     = p.r + (R_PULSE_END - p.r) * _easeOut(t);
    const alpha = (1 - t) * 0.36 * _awTimeMod;
    _ctx.save();
    _ctx.beginPath();
    _ctx.arc(CX, CY, r, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 0.55;
    _ctx.stroke();
    _ctx.restore();
  }
}

// ── Pulse rings (events + idle) ───────────────────────────────

function _spawnPulse(r) {
  _pulses.push({ r: r ?? 108, born: Date.now() });
}

function _checkIdlePulse() {
  if (Date.now() < _nextIdle) return;
  _nextIdle = Date.now() + _randMs(28000, 50000);
  _spawnPulse();
  pulseOrb();
}

function _drawPulses() {
  const now = Date.now();
  for (let i = _pulses.length - 1; i >= 0; i--) {
    const p   = _pulses[i];
    const age = now - p.born;
    if (age > 2600) { _pulses.splice(i, 1); continue; }
    const t     = age / 2600;
    const r     = p.r + (R_PULSE_END - p.r) * _easeOut(t);
    const alpha = (1 - t) * 0.36 * _awTimeMod;
    _ctx.save();
    _ctx.beginPath();
    _ctx.arc(CX, CY, r, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 0.85;
    _ctx.stroke();
    _ctx.restore();
  }
}

// ── Idle curiosity ────────────────────────────────────────────
// Every 45–90s at idle, NOVA performs one intentional act.
// Feels like internal activity, not a reaction to the user.
//
//   Type 0 — Reconfiguration: paths clear and reform at new angles
//   Type 1 — Scanner override: scan briefly reverses direction
//   Type 2 — Deep scan: internal pulses from core outward (awareness)

function _checkCuriosity(state) {
  if (_curiosityActive) {
    if (Date.now() - _curiosityBorn > _curiosityDur) {
      _curiosityActive = false;
    }
    return;
  }
  if (Date.now() < _curiosityAt) return;
  if (state !== 'idle') {
    _curiosityAt = Date.now() + _randMs(15000, 30000);
    return;
  }

  _curiosityType   = Math.floor(Math.random() * 3);
  _curiosityActive = true;
  _curiosityBorn   = Date.now();
  _curiosityAt     = Date.now() + _randMs(45000, 90000);

  if (_curiosityType === 0) {
    // Reconfiguration: clear existing paths, let new ones form
    for (const p of _paths) p.phase = 'out';
    _nextPathAt = Date.now() + 1400;
    _curiosityDur = 6000;
  } else if (_curiosityType === 1) {
    // Scanner override: reverse direction for ~3.5 seconds
    _curiosityDur = 3500;
  } else {
    // Deep scan: concentric pulses from inside out
    _spawnPulse(30);
    setTimeout(() => _spawnPulse(55), 280);
    setTimeout(() => _spawnPulse(85), 560);
    _curiosityDur = 2200;
  }
}

// ── Cardinal labels ───────────────────────────────────────────

function _drawCardinalLabels(outerDim) {
  const a = 0.28 * _awTimeMod * outerDim;
  if (a < 0.01) return;
  _ctx.save();
  _ctx.font          = '9px -apple-system,"Segoe UI",system-ui,sans-serif';
  _ctx.textBaseline  = 'middle';
  _ctx.letterSpacing = '0.08em';
  const positions = [
    { angle: -HALF_PI, align: 'center', label: `${_noteCount} NOTES` },
    { angle:  0,       align: 'left',   label: `${_taskPending} PENDING` },
    { angle:  HALF_PI, align: 'center', label: _getDateLabel() },
    { angle:  Math.PI, align: 'right',  label: _getUptimeLabel() },
  ];
  for (const { angle, align, label } of positions) {
    _ctx.textAlign = align;
    _ctx.fillStyle = _rgba(a);
    _ctx.fillText(label, CX + Math.cos(angle) * R_LABELS, CY + Math.sin(angle) * R_LABELS);
  }
  _ctx.restore();
}

// ── System bar ────────────────────────────────────────────────

function _updateSystemBar() {
  const n = document.getElementById('sys-notes');
  const t = document.getElementById('sys-tasks');
  const u = document.getElementById('sys-uptime');
  if (n) n.textContent = `${_noteCount} NOTES`;
  if (t) t.textContent = `${_taskPending} PENDING`;
  if (u) u.textContent = `UPTIME ${_getUptimeLabel()}`;
}

// ── Greeting ──────────────────────────────────────────────────

function _updateGreeting() {
  const el = document.getElementById('nova-greeting');
  if (!el) return;
  const h    = new Date().getHours();
  const name = State.get('userName');
  const sal  = h < 5  ? 'WORKING LATE'
             : h < 12 ? 'GOOD MORNING'
             : h < 17 ? 'GOOD AFTERNOON'
             : h < 21 ? 'GOOD EVENING'
             :           'GOOD NIGHT';
  el.textContent = name ? `${sal}, ${name.toUpperCase()}` : sal;
}

// ── Helpers ───────────────────────────────────────────────────

function _getUptimeLabel() {
  const s   = Math.floor((Date.now() - _sessionStart) / 1000);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}h ${String(m).padStart(2, '0')}m`
    : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function _getDateLabel() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

function _easeOut(t)   { return 1 - Math.pow(1 - t, 2.5); }
function _easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function _randMs(min, max) { return min + Math.random() * (max - min); }
