/**
 * NOVA HUD — Functional Interface Layer
 *
 * Design law: every visual element communicates something.
 * If it doesn't, it doesn't exist here.
 *
 * What this draws (in order):
 *   1. Mouse directional glow         — cursor position feedback
 *   2. 12 major tick marks            — structural reference only
 *   3. Memory ring (R=150)            — note count as arc fill, pulses on change
 *   4. Task ring   (R=164)            — task dots, pulses on completion
 *   5. Activity ring (R=180)          — state-driven: wave/think/flow/idle
 *   6. Geometric data paths           — internal thinking structures
 *   7. Scanner beam                   — primary scan line, speed = AI state
 *   8. Flow pulses                    — responding: outward energy transfer
 *   9. Event pulse rings              — note/task/memory events
 *  10. Cardinal labels                — 4 live data labels
 *
 * Removed vs. previous versions:
 *   - 5 decorative outer rings (R=177-238) rotating for no reason
 *   - Rotating arc segments (R=154, 172)
 *   - Depth halo (ambient glow, no communication)
 *   - Background depth tick ring
 *   - 48 minor tick marks
 *   - Energy arc bezier flashes
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
const R_TICKS     = 136;
const R_MEM       = 150;    // Memory ring
const R_TASK      = 164;    // Task ring
const R_ACT       = 180;    // Activity ring (state-driven)
const R_SCANNER   = 170;
const R_LABELS    = 202;
const R_PULSE_END = 270;

// ── Scanner speed & alpha per state ──────────────────────────

const SCAN_PARAMS = {
  offline:    { speed: 0.0005, alpha: 0.04 },
  idle:       { speed: 0.0030, alpha: 0.16 },
  listening:  { speed: 0.0060, alpha: 0.28 },
  thinking:   { speed: 0.0160, alpha: 0.44 },
  responding: { speed: 0.0110, alpha: 0.36 },
  success:    { speed: 0.0018, alpha: 0.10 },
  error:      { speed: 0.0085, alpha: 0.24 },
};

// ── Module state ──────────────────────────────────────────────

let _canvas = null;
let _ctx    = null;
let _dpr    = 1;
let _rafId  = null;
let _t      = 0;

let _colorRgb = '0, 212, 255';
let _isMobile = false;

// Live interpolated scan params
let _scanSpeed = SCAN_PARAMS.idle.speed;
let _scanAlpha = SCAN_PARAMS.idle.alpha;
let _scanAngle = -HALF_PI;

// Awareness modifiers
let _awIdleMul = 1.0;
let _awTimeMod = 1.0;
let _awTyping  = 0.0;

// Focus mode: when typing, outer elements dim, internal activity rises
let _focusFade = 0;   // 0 = normal, 1 = fully concentrated

// Data counts
let _noteCount    = 0;
let _taskTotal    = 0;
let _taskPending  = 0;
let _sessionStart = Date.now();

// Functional ring state
const _rings = {
  mem:  { fill: 0, targetFill: 0, pulse: 0 },
  task: { fill: 0, targetFill: 0, pulse: 0 },
  act:  { pulse: 0 },
};

// Wave bars for listening state
const _waveBars = Array.from({ length: 24 }, () => ({ h: 0 }));

// Geometric data paths
const _paths      = [];
const MAX_PATHS   = 2;
let   _pathBoost  = 0;
let   _nextPathAt = Date.now() + _randMs(1500, 4000);

// Pulse rings
const _pulses   = [];
let   _nextIdle = Date.now() + _randMs(24000, 42000);

// Flow pulses (responding state)
const _flowPulses = [];

// Mouse influence
let _mouseNX  = 0;
let _mouseNY  = 0;
let _hoverDist = 0;
let _hoverZone = 0;  // 0=none, 1=inner, 2=mid, 3=outer

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

  Bus.on(EVENTS.NOTE_CREATED,   () => { _noteCount++;    _rings.mem.pulse = 1;  _updateRingTargets(); _updateSystemBar(); });
  Bus.on(EVENTS.NOTE_DELETED,   () => { _noteCount   = Math.max(0, _noteCount - 1); _updateRingTargets(); _updateSystemBar(); });
  Bus.on(EVENTS.TASK_CREATED,   () => { _taskTotal++; _taskPending++; _rings.task.pulse = 1; _updateRingTargets(); _updateSystemBar(); });
  Bus.on(EVENTS.TASK_COMPLETED, () => { _taskPending = Math.max(0, _taskPending - 1); _rings.task.pulse = 1; _updateRingTargets(); _spawnPulse(); _updateSystemBar(); });
  Bus.on(EVENTS.TASK_DELETED,   () => { _taskPending = Math.max(0, _taskPending - 1); _taskTotal = Math.max(0, _taskTotal - 1); _updateRingTargets(); _updateSystemBar(); });

  Bus.on(EVENTS.NOTE_CREATED,   () => _triggerWave(0.55));
  Bus.on(EVENTS.TASK_COMPLETED, () => _triggerWave(1.00));
  Bus.on(EVENTS.MEMORY_CREATED, () => { _rings.mem.pulse = 0.7; _triggerWave(0.70); });

  Bus.on(EVENTS.ORB_STATE_CHANGED, ({ state }) => {
    if (state === 'success') {
      _spawnPulse(); setTimeout(_spawnPulse, 250); setTimeout(_spawnPulse, 500);
      _rings.act.pulse = 1;
      pulseOrb();
      _triggerWave(1.3);
    }
    if (state === 'error') {
      _spawnPulse();
      _rings.act.pulse = 0.5;
      for (const p of _paths) p.phase = 'out';
    }
    if (state === 'responding') {
      for (let i = 0; i < 3; i++) setTimeout(() => _spawnFlowPulse(), i * 160);
    }
  });

  _updateRingTargets();
  _updateSystemBar();
  _updateGreeting();
  setInterval(_updateSystemBar, 1000);
  setInterval(_updateGreeting,  60000);

  _rafId = requestAnimationFrame(_loop);
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
  const completed = Math.max(0, _taskTotal - _taskPending);
  _rings.task.targetFill = _taskTotal > 0 ? completed / Math.max(_taskTotal, 1) : 0;
}

// ── Main loop ─────────────────────────────────────────────────

function _loop() {
  if (!_canvas || !_ctx) return;
  _t++;

  const ora  = getAwareness();
  _awIdleMul = ora.idleLevel === 2 ? 0.38 : ora.idleLevel === 1 ? 0.65 : 1.0;
  _awTimeMod = ora.timeModifier;
  _awTyping  = Math.min(1, (ora.typingEnergy ?? 0) * 2.5);

  // Focus mode: concentrates inward when typing
  const focusTarget = _awTyping > 0.15 ? 1.0 : 0.0;
  _focusFade += (focusTarget - _focusFade) * 0.04;

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
  _scanAngle += _scanSpeed * _awIdleMul * _awTimeMod;

  // Ring fill lerp
  _rings.mem.fill  += (_rings.mem.targetFill  - _rings.mem.fill)  * 0.018;
  _rings.task.fill += (_rings.task.targetFill - _rings.task.fill) * 0.018;

  // Ring pulse decay
  _rings.mem.pulse  = Math.max(0, _rings.mem.pulse  - 0.018);
  _rings.task.pulse = Math.max(0, _rings.task.pulse - 0.018);
  _rings.act.pulse  = Math.max(0, _rings.act.pulse  - 0.014);

  _pathBoost = Math.max(0, _pathBoost - 0.006);

  _maybeSpawnPath();
  _updatePaths();
  _updateWaveBars(state);
  _checkIdlePulse();
  _maybeSpawnFlowPulse(state);

  _ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Focus mode: outer dims, inner brightens
  const outerDim   = 1 - _focusFade * 0.72;
  const innerBoost = 1 + _focusFade * 0.55;

  _drawMouseGlow();
  _drawTicks(outerDim);
  _drawMemoryRing(outerDim);
  _drawTaskRing(outerDim);
  _drawActivityRing(outerDim, state);
  _drawPaths(innerBoost);
  _drawScanner(innerBoost);
  _drawFlowPulses();
  _drawPulses();
  _drawCardinalLabels(outerDim);

  _rafId = requestAnimationFrame(_loop);
}

// ── Draw: mouse glow ──────────────────────────────────────────

function _drawMouseGlow() {
  if (_hoverDist < 0.02) return;
  const gx   = CX + _mouseNX * 55;
  const gy   = CY + _mouseNY * 55;
  const grad = _ctx.createRadialGradient(gx, gy, 8, CX, CY, 195);
  grad.addColorStop(0,   _rgba(0.06 * _awTimeMod));
  grad.addColorStop(0.5, _rgba(0.018 * _awTimeMod));
  grad.addColorStop(1,   _rgba(0));
  _ctx.save();
  _ctx.beginPath();
  _ctx.arc(CX, CY, 195, 0, TWO_PI);
  _ctx.fillStyle = grad;
  _ctx.fill();
  _ctx.restore();
}

// ── Draw: 12 major tick marks ─────────────────────────────────

function _drawTicks(outerDim) {
  const hBoost = _hoverZone >= 2 ? 1.55 : 1;
  const a = 0.22 * _awTimeMod * _awIdleMul * outerDim * hBoost;
  if (a < 0.005) return;
  _ctx.save();
  _ctx.strokeStyle = _rgba(a);
  _ctx.lineWidth   = 1.0;
  for (let i = 0; i < 12; i++) {
    const ang = (TWO_PI / 12) * i - HALF_PI;
    _ctx.beginPath();
    _ctx.moveTo(CX + Math.cos(ang) * R_TICKS,       CY + Math.sin(ang) * R_TICKS);
    _ctx.lineTo(CX + Math.cos(ang) * (R_TICKS + 7), CY + Math.sin(ang) * (R_TICKS + 7));
    _ctx.stroke();
  }
  // Minor ticks — very faint
  _ctx.lineWidth   = 0.5;
  _ctx.strokeStyle = _rgba(a * 0.25);
  for (let i = 0; i < 60; i++) {
    if (i % 5 === 0) continue;
    const ang = (TWO_PI / 60) * i - HALF_PI;
    _ctx.beginPath();
    _ctx.moveTo(CX + Math.cos(ang) * R_TICKS,       CY + Math.sin(ang) * R_TICKS);
    _ctx.lineTo(CX + Math.cos(ang) * (R_TICKS + 3), CY + Math.sin(ang) * (R_TICKS + 3));
    _ctx.stroke();
  }
  _ctx.restore();
}

// ── Draw: memory ring (R=150) ─────────────────────────────────
// Proportional arc fill = note count / 20.
// Pulses when notes created. Hover reveals it.

function _drawMemoryRing(outerDim) {
  const hBoost = _hoverZone >= 2 ? 1.55 : 1;
  const alpha  = (0.15 + _rings.mem.pulse * 0.55) * _awTimeMod * outerDim * hBoost;
  if (alpha < 0.005) return;
  _ctx.save();
  _ctx.lineCap = 'round';
  // Ghost ring (full circle, very faint)
  _ctx.beginPath();
  _ctx.arc(CX, CY, R_MEM, 0, TWO_PI);
  _ctx.strokeStyle = _rgba(alpha * 0.18);
  _ctx.lineWidth   = 0.8;
  _ctx.stroke();
  // Data arc
  if (_rings.mem.fill > 0.01) {
    const span = _rings.mem.fill * TWO_PI;
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_MEM, -HALF_PI, -HALF_PI + span);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 1.2;
    _ctx.stroke();
    // Leading dot
    const ex = CX + Math.cos(-HALF_PI + span) * R_MEM;
    const ey = CY + Math.sin(-HALF_PI + span) * R_MEM;
    _ctx.beginPath();
    _ctx.arc(ex, ey, 1.5, 0, TWO_PI);
    _ctx.fillStyle = _rgba(Math.min(1, alpha * 2));
    _ctx.fill();
  }
  _ctx.restore();
}

// ── Draw: task ring (R=164) ───────────────────────────────────
// Completion arc fill + pending task dots around ring.

function _drawTaskRing(outerDim) {
  const hBoost = _hoverZone >= 2 ? 1.55 : 1;
  const alpha  = (0.12 + _rings.task.pulse * 0.50) * _awTimeMod * outerDim * hBoost;
  if (alpha < 0.005) return;
  _ctx.save();
  _ctx.lineCap = 'round';
  // Ghost ring
  _ctx.beginPath();
  _ctx.arc(CX, CY, R_TASK, 0, TWO_PI);
  _ctx.strokeStyle = _rgba(alpha * 0.15);
  _ctx.lineWidth   = 0.7;
  _ctx.stroke();
  // Completion fill arc
  if (_rings.task.fill > 0.01) {
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_TASK, -HALF_PI, -HALF_PI + _rings.task.fill * TWO_PI);
    _ctx.strokeStyle = _rgba(alpha * 0.88);
    _ctx.lineWidth   = 1.0;
    _ctx.stroke();
  }
  // Pending task dots
  const dotCount = Math.min(12, _taskPending);
  if (dotCount > 0) {
    _ctx.fillStyle = _rgba(alpha * 0.80);
    for (let i = 0; i < dotCount; i++) {
      const ang = (TWO_PI / Math.max(dotCount, 3)) * i - HALF_PI + 0.22;
      _ctx.beginPath();
      _ctx.arc(CX + Math.cos(ang) * R_TASK, CY + Math.sin(ang) * R_TASK, 1.8, 0, TWO_PI);
      _ctx.fill();
    }
  }
  _ctx.restore();
}

// ── Draw: activity ring (R=180) ───────────────────────────────
// State-driven. Each state has distinct visual behavior.
//
//   idle      → barely visible ghost ring
//   listening → radial wave bars (audio visualizer effect)
//   thinking  → segmented ring with drifting gaps
//   responding → bright full ring (source of flow pulses)
//   success   → synchronized full ring glow
//   error     → broken arcs with jitter

function _updateWaveBars(state) {
  if (state !== 'listening') {
    for (const bar of _waveBars) bar.h += (0 - bar.h) * 0.06;
    return;
  }
  for (let i = 0; i < _waveBars.length; i++) {
    const w1 = Math.sin(_t * 0.09 + i * 0.55);
    const w2 = Math.sin(_t * 0.14 + i * 1.20);
    // Mouse direction adds asymmetry: listening "hears" toward cursor
    const dirBias = Math.cos((i / _waveBars.length) * TWO_PI - Math.atan2(_mouseNY, _mouseNX)) * 0.35;
    const target  = Math.max(0, (w1 * 0.55 + w2 * 0.35 + dirBias) * 8);
    _waveBars[i].h += (target - _waveBars[i].h) * 0.12;
  }
}

function _drawActivityRing(outerDim, state) {
  const pulse = _rings.act.pulse;
  const hBoost = _hoverZone >= 2 ? 1.40 : 1;
  const stateA = state === 'idle'       ? 0.07
               : state === 'listening'  ? 0.28
               : state === 'thinking'   ? 0.20
               : state === 'responding' ? 0.38
               : state === 'success'    ? 0.55
               : state === 'error'      ? 0.18 : 0.04;
  const alpha = (stateA + pulse * 0.45) * _awTimeMod * outerDim * hBoost;
  _ctx.save();
  _ctx.lineCap = 'round';

  if (state === 'listening') {
    // Audio-wave bars radiating outward from ring
    for (let i = 0; i < _waveBars.length; i++) {
      const h = _waveBars[i].h;
      if (h < 0.1) continue;
      const ang = (i / _waveBars.length) * TWO_PI - HALF_PI;
      _ctx.beginPath();
      _ctx.moveTo(CX + Math.cos(ang) * (R_ACT - 2), CY + Math.sin(ang) * (R_ACT - 2));
      _ctx.lineTo(CX + Math.cos(ang) * (R_ACT + h), CY + Math.sin(ang) * (R_ACT + h));
      _ctx.strokeStyle = _rgba((h / 10) * alpha * 2.5);
      _ctx.lineWidth   = 1.8;
      _ctx.stroke();
    }
    // Ghost ring beneath bars
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha * 0.30);
    _ctx.lineWidth   = 0.6;
    _ctx.stroke();

  } else if (state === 'thinking') {
    // Segmented ring with drifting gaps — structural rearrangement feel
    const segs    = 4;
    const gapFrac = 0.18;
    const segSpan = ((1 - gapFrac * segs) / segs) * TWO_PI;
    const gapSpan = gapFrac * TWO_PI;
    const offset  = _scanAngle * 0.22;
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 1.1;
    for (let i = 0; i < segs; i++) {
      const start = offset + i * (segSpan + gapSpan);
      _ctx.beginPath();
      _ctx.arc(CX, CY, R_ACT, start, start + segSpan);
      _ctx.stroke();
    }

  } else if (state === 'responding') {
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha * 0.90);
    _ctx.lineWidth   = 1.4;
    _ctx.stroke();

  } else if (state === 'success') {
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 1.8;
    _ctx.stroke();

  } else if (state === 'error') {
    const jitter = Math.sin(_t * 0.22) * 0.08;
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 0.9;
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, 0.1 + jitter, Math.PI - 0.1);
    _ctx.stroke();
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, Math.PI + 0.2 - jitter, TWO_PI - 0.2);
    _ctx.stroke();

  } else {
    // Idle / offline: ghost
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ACT, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha * 0.55);
    _ctx.lineWidth   = 0.5;
    _ctx.stroke();
  }
  _ctx.restore();
}

// ── Geometric data paths ──────────────────────────────────────
// Internal thinking structures. Max 2 active.
// Responding/success states clear them (attention moved outward).

function _maybeSpawnPath() {
  if (_paths.length >= MAX_PATHS) return;
  if (Date.now() < _nextPathAt) return;
  const state = State.get('orbState') || 'idle';
  if (state === 'offline' || state === 'responding' || state === 'success') return;

  const isThinking = state === 'thinking';
  const peakAlpha  = isThinking ? 0.30 + Math.random() * 0.15
                   : (0.12 + Math.random() * 0.10) * (1 + _focusFade * 0.6);
  const holdTime   = isThinking ? 4000 + Math.random() * 7000
                   : _focusFade > 0.5 ? 5000 + Math.random() * 6000
                   : 9000 + Math.random() * 10000;

  const ang1  = Math.random() * TWO_PI;
  const delta = Math.PI * 0.40 + Math.random() * Math.PI * 0.90;
  const ang2  = ang1 + delta * (Math.random() > 0.5 ? 1 : -1);

  _paths.push({
    ang1, r1: 48 + Math.random() * 38,
    ang2, r2: 44 + Math.random() * 40,
    alpha: 0,
    peakAlpha: peakAlpha * (1 + _pathBoost * 0.55),
    phase: 'in', phaseAt: Date.now(),
    holdTime, fadeIn: 2000, fadeOut: 2600,
  });

  _nextPathAt = Date.now() + (isThinking ? 2000 + Math.random() * 3000
    : _focusFade > 0.5 ? 3000 + Math.random() * 4000
    : 5000 + Math.random() * 9000);
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
  const timeFade = _awTimeMod * _awIdleMul * innerBoost;
  const hoverMul = _hoverZone === 1 ? 1.8 : _hoverZone === 2 ? 1.3 : 1;
  _ctx.save();
  _ctx.lineCap = 'round';
  for (const p of _paths) {
    const a = p.alpha * timeFade * hoverMul;
    if (a < 0.005) continue;
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
    const dotA = Math.min(1, a * 2.6);
    _ctx.fillStyle = _rgba(dotA);
    _ctx.beginPath(); _ctx.arc(x1, y1, 1.5, 0, TWO_PI); _ctx.fill();
    _ctx.beginPath(); _ctx.arc(x2, y2, 1.5, 0, TWO_PI); _ctx.fill();
  }
  _ctx.restore();
}

// ── Scanner beam ──────────────────────────────────────────────

function _drawScanner(innerBoost) {
  const hBoost = _hoverZone >= 2 ? 1.35 : 1;
  const sa     = _scanAlpha * _awTimeMod * _awIdleMul * innerBoost * hBoost;
  if (sa < 0.005) return;
  const ex = CX + Math.cos(_scanAngle) * R_SCANNER;
  const ey = CY + Math.sin(_scanAngle) * R_SCANNER;
  _ctx.save();
  const grad = _ctx.createLinearGradient(CX, CY, ex, ey);
  grad.addColorStop(0,    _rgba(0));
  grad.addColorStop(0.35, _rgba(sa * 0.20));
  grad.addColorStop(0.80, _rgba(sa * 0.68));
  grad.addColorStop(1,    _rgba(sa));
  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.lineTo(ex, ey);
  _ctx.strokeStyle = grad;
  _ctx.lineWidth   = 1.4;
  _ctx.stroke();
  _ctx.beginPath();
  _ctx.arc(ex, ey, 1.8, 0, TWO_PI);
  _ctx.fillStyle = _rgba(sa * 1.6);
  _ctx.fill();
  // Sweep wedge
  const sg = _ctx.createRadialGradient(CX, CY, 35, CX, CY, R_SCANNER);
  sg.addColorStop(0, _rgba(0));
  sg.addColorStop(1, _rgba(sa * 0.09));
  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.arc(CX, CY, R_SCANNER, _scanAngle - 0.18, _scanAngle, false);
  _ctx.closePath();
  _ctx.fillStyle = sg;
  _ctx.fill();
  _ctx.restore();
}

// ── Flow pulses (responding state) ───────────────────────────
// Thin fast rings: "information moving outward from the core."

function _spawnFlowPulse() {
  _flowPulses.push({ r: 52, born: Date.now(), dur: 900 + Math.random() * 300 });
}

function _maybeSpawnFlowPulse(state) {
  if (state === 'responding' && Math.random() < 0.055) _spawnFlowPulse();
}

function _drawFlowPulses() {
  const now = Date.now();
  for (let i = _flowPulses.length - 1; i >= 0; i--) {
    const p   = _flowPulses[i];
    const age = now - p.born;
    if (age > p.dur) { _flowPulses.splice(i, 1); continue; }
    const t     = age / p.dur;
    const r     = p.r + (R_PULSE_END - p.r) * _easeOut(t);
    const alpha = (1 - t) * 0.38 * _awTimeMod;
    _ctx.save();
    _ctx.beginPath();
    _ctx.arc(CX, CY, r, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 0.6;
    _ctx.stroke();
    _ctx.restore();
  }
}

// ── Pulse rings ───────────────────────────────────────────────

function _spawnPulse(r) {
  _pulses.push({ r: r ?? 115, born: Date.now() });
}

function _checkIdlePulse() {
  if (Date.now() < _nextIdle) return;
  _nextIdle = Date.now() + _randMs(26000, 48000);
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
    const alpha = (1 - t) * 0.38 * _awTimeMod;
    _ctx.save();
    _ctx.beginPath();
    _ctx.arc(CX, CY, r, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 0.9;
    _ctx.stroke();
    _ctx.restore();
  }
}

// ── Energy wave (event reaction) ─────────────────────────────

function _triggerWave(intensity) {
  const t = intensity ?? 1.0;
  setTimeout(() => _pulses.push({ r: 40,  born: Date.now() }), 0);
  setTimeout(() => _pulses.push({ r: 115, born: Date.now() }), 210);
  setTimeout(() => _pulses.push({ r: 142, born: Date.now() }), 400);
  _pathBoost = Math.min(1, _pathBoost + t * 0.75);
}

// ── Cardinal labels ───────────────────────────────────────────

function _drawCardinalLabels(outerDim) {
  const a = 0.30 * _awTimeMod * outerDim;
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

function _easeOut(t) { return 1 - Math.pow(1 - t, 2.5); }
function _randMs(min, max) { return min + Math.random() * (max - min); }
