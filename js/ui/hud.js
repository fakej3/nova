/**
 * NOVA HUD System — Phase K: AI Core Restore
 *
 * Design principle: subtraction over addition.
 * The orb has strong bones — CSS scan lines, reactor rings, geo structure.
 * This file's job is to add just enough to create depth and intelligence,
 * then stop.
 *
 * What this draws:
 *   - Mouse directional glow         (ambient, cursor-reactive)
 *   - Focus glow                     (mouse proximity enhancement)
 *   - Outer ambient halo             (depth separation)
 *   - Internal geometric paths       (2 max — form, hold, dissolve)
 *   - Background depth tick ring     (R=128, very faint, desktop only)
 *   - Tick marks                     (R=136, state-responsive)
 *   - Rotating arc segments          (R=154, 172 — structural)
 *   - Outer ring system              (R=177–238, 5 independent rings)
 *   - Scanner beam                   (primary scan line, state-driven)
 *   - Energy arcs                    (brief bezier flashes, state-gated)
 *   - Pulse rings                    (event + idle reactions)
 *   - Cardinal labels                (4 functional text labels)
 *
 * What was removed vs Phase J/K:
 *   - Memory constellation (16 orbiting nodes)
 *   - Data network (5 node graph with connections)
 *   - Signal propagation (traveling dots)
 *   - Fragment text (SYS:OK, CTX:READY — Iron Man HUD noise)
 */

import { DB }           from '../core/db.js';
import { Bus, EVENTS }  from '../core/bus.js';
import { pulseOrb }     from './orb.js';
import { State }        from '../core/state.js';
import { getAwareness } from './awareness.js';

// ── Constants ─────────────────────────────────────────────────

const TWO_PI  = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const CANVAS_SIZE   = 520;
const CX            = 260;
const CY            = 260;
const R_TICKS       = 136;
const R_ARC_INNER   = 154;
const R_ARC_OUTER   = 172;
const R_SCANNER     = 170;
const R_LABELS      = 202;
const R_PULSE_START = 118;
const R_PULSE_END   = 270;

// ── State parameter targets ───────────────────────────────────
// All values are interpolated toward each frame — never hard-set.

const STATE_TARGETS = {
  idle:       { scanSpeed: 0.0030, scanAlpha: 0.18, arcScale: 0.90, tickAlpha: 0.24 },
  listening:  { scanSpeed: 0.0065, scanAlpha: 0.32, arcScale: 1.25, tickAlpha: 0.34 },
  thinking:   { scanSpeed: 0.0150, scanAlpha: 0.48, arcScale: 1.70, tickAlpha: 0.46 },
  responding: { scanSpeed: 0.0110, scanAlpha: 0.40, arcScale: 1.40, tickAlpha: 0.38 },
  success:    { scanSpeed: 0.0018, scanAlpha: 0.10, arcScale: 0.48, tickAlpha: 0.14 },
  error:      { scanSpeed: 0.0080, scanAlpha: 0.28, arcScale: 0.85, tickAlpha: 0.20 },
  offline:    { scanSpeed: 0.0006, scanAlpha: 0.04, arcScale: 0.08, tickAlpha: 0.05 },
};

// ── Energy arc config ─────────────────────────────────────────

const ARC_RATES = {
  idle: 0.0018, listening: 0.009, thinking: 0.032,
  responding: 0.024, success: 0, error: 0.016, offline: 0,
};

const ARC_CONFIGS = {
  idle:       { minSpan:0.20, maxSpan:0.90, bow:0.84, minLife:800,  maxLife:1800, w:0.6,  peakAlpha:0.22 },
  listening:  { minSpan:0.35, maxSpan:1.40, bow:0.88, minLife:550,  maxLife:1300, w:0.8,  peakAlpha:0.34 },
  thinking:   { minSpan:0.28, maxSpan:2.00, bow:0.78, minLife:280,  maxLife:950,  w:0.95, peakAlpha:0.44 },
  responding: { minSpan:0.55, maxSpan:2.20, bow:0.72, minLife:200,  maxLife:700,  w:1.1,  peakAlpha:0.48 },
  error:      { minSpan:0.10, maxSpan:0.60, bow:1.18, minLife:130,  maxLife:480,  w:0.75, peakAlpha:0.30 },
};

// ── Module state ──────────────────────────────────────────────

let _canvas   = null;
let _ctx      = null;
let _dpr      = 1;
let _rafId    = null;
let _isMobile = false;

let _color    = '#00d4ff';
let _colorRgb = '0, 212, 255';

let _scanAngle = -HALF_PI;
let _arcAngle1 = 0;
let _arcAngle2 = Math.PI;

let _noteCount    = 0;
let _taskPending  = 0;
let _sessionStart = Date.now();

// Live interpolated params (lerp toward STATE_TARGETS each frame)
let _live = { ...STATE_TARGETS.idle };

// Awareness modifiers
let _awIdleMul = 1.0;
let _awTimeMod = 1.0;
let _awEnergy  = 1.0;

// Pulse rings
const _pulses = [];
let _nextIdlePulse = Date.now() + _randMs(20000, 38000);

// Energy arcs
const _energyArcs = [];

// Micro-events
let _microScanBoost = null;
let _nextMicroEvent = Date.now() + _randMs(18000, 50000);

// Mouse + focus
let _mouseNX = 0;
let _mouseNY = 0;
let _focusLevel = 0;

// ── Geometric data paths ──────────────────────────────────────
// The primary "living intelligence" element.
// Max 2 paths at any time. Each path is a single clean line segment
// drawn inside the orb (R=50–90 on the 520px HUD canvas).
// Lifecycle: fade-in over 2.2s → hold 6–18s → fade-out over 2.8s.
// State affects peak alpha and hold duration.
// This replaces constellation, network, signals, and fragment text.

const _paths       = [];
const MAX_PATHS    = 2;
let   _pathBoost   = 0;          // 0–1 temporary alpha boost from events
let   _nextPathAt  = Date.now() + _randMs(1500, 4000);

// ── Outer ring system ─────────────────────────────────────────

const _outerRings = [
  { r: 177, segs: 8, speed:  0.00058, baseLw: 0.55, baseAlpha: 0.18 },
  { r: 185, segs: 4, speed: -0.00038, baseLw: 0.85, baseAlpha: 0.15 },
  { r: 200, segs: 6, speed:  0.00025, baseLw: 0.65, baseAlpha: 0.12 },
  { r: 220, segs: 3, speed: -0.00015, baseLw: 1.00, baseAlpha: 0.09 },
  { r: 238, segs: 2, speed:  0.00007, baseLw: 0.45, baseAlpha: 0.06 },
].map(cfg => ({
  ...cfg,
  angle:      Math.random() * TWO_PI,
  lw:         cfg.baseLw,
  targetLw:   cfg.baseLw,
  gaps:       _makeRingGaps(cfg.segs, 0.08, 0.20),
  targetGaps: _makeRingGaps(cfg.segs, 0.08, 0.20),
  nextRecal:  Date.now() + _randMs(22000, 45000),
}));

// Formation: coordinated ring event every 25–65s
let _nextFormation     = Date.now() + _randMs(25000, 65000);
let _formationActive   = false;
let _formationBorn     = 0;
let _formationDuration = 5000;

// ── Public API ─────────────────────────────────────────────────

export function setHudMouseInfluence(nx, ny) {
  _mouseNX = nx;
  _mouseNY = ny;
}

// ── Init ──────────────────────────────────────────────────────

export async function initHud() {
  _canvas   = document.getElementById('orb-hud-canvas');
  if (!_canvas) return;
  _ctx      = _canvas.getContext('2d');
  _isMobile = window.innerWidth <= 640;

  _dpr = Math.min(window.devicePixelRatio || 1, 2);
  _sizeCanvas();
  window.addEventListener('resize', () => {
    _isMobile = window.innerWidth <= 640;
    _sizeCanvas();
  }, { passive: true });

  _readColor();
  Bus.on(EVENTS.THEME_CHANGED, () => requestAnimationFrame(_readColor));

  await _refreshCounts();

  // Count maintenance
  Bus.on(EVENTS.NOTE_CREATED,   () => { _noteCount++;    _updateSystemBar(); });
  Bus.on(EVENTS.NOTE_DELETED,   () => { _noteCount   = Math.max(0, _noteCount - 1);   _updateSystemBar(); });
  Bus.on(EVENTS.TASK_CREATED,   () => { _taskPending++;  _updateSystemBar(); });
  Bus.on(EVENTS.TASK_COMPLETED, () => { _taskPending = Math.max(0, _taskPending - 1); _updateSystemBar(); _spawnPulse(); });
  Bus.on(EVENTS.TASK_DELETED,   () => { _taskPending = Math.max(0, _taskPending - 1); _updateSystemBar(); });

  Bus.on(EVENTS.NOTE_CREATED,   _spawnPulse);
  Bus.on(EVENTS.TASK_CREATED,   _spawnPulse);

  Bus.on(EVENTS.ORB_STATE_CHANGED, ({ state }) => {
    if (state === 'success') {
      _spawnPulse(); setTimeout(_spawnPulse, 260); setTimeout(_spawnPulse, 520);
      pulseOrb();
      _triggerEnergyWave(1.2);
    }
    if (state === 'error') {
      _spawnPulse();
      // Brief ring instability — outer rings scramble then self-correct
      for (const ring of _outerRings) {
        ring.gaps       = _makeRingGaps(ring.segs, 0.02, 0.46);
        ring.targetGaps = _makeRingGaps(ring.segs, 0.08, 0.20);
      }
      // Interrupt current paths — intelligence disrupted
      for (const p of _paths) p.phase = 'out';
    }
  });

  Bus.on(EVENTS.NOTE_CREATED,   () => _triggerEnergyWave(0.60));
  Bus.on(EVENTS.TASK_COMPLETED, () => _triggerEnergyWave(1.00));
  Bus.on(EVENTS.MEMORY_CREATED, () => _triggerEnergyWave(0.75));

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
  const s   = getComputedStyle(document.documentElement);
  _color    = s.getPropertyValue('--orb-color').trim()     || '#00d4ff';
  _colorRgb = s.getPropertyValue('--orb-color-rgb').trim() || '0, 212, 255';
}

function _rgba(a) {
  return `rgba(${_colorRgb},${Math.max(0, a).toFixed(3)})`;
}

// ── Data ──────────────────────────────────────────────────────

async function _refreshCounts() {
  try {
    const [notes, pending] = await Promise.all([
      DB.notes.getAll(),
      DB.tasks.getByStatus('pending'),
    ]);
    _noteCount   = notes.length;
    _taskPending = pending.length;
  } catch { /* non-fatal */ }
}

// ── State param interpolation ─────────────────────────────────

function _updateLiveParams() {
  const state  = State.get('orbState') || 'idle';
  const target = STATE_TARGETS[state] ?? STATE_TARGETS.idle;
  const L = 0.030;   // gentle lerp — no abrupt jumps
  for (const k of Object.keys(_live)) {
    if (k in target) _live[k] += (target[k] - _live[k]) * L;
  }
  const ora  = getAwareness();
  _awIdleMul = ora.idleLevel === 2 ? 0.40 : ora.idleLevel === 1 ? 0.68 : 1.0;
  _awTimeMod = ora.timeModifier;
  _awEnergy  = 1 + ora.energy * 0.25;
}

// ── Focus mode ────────────────────────────────────────────────

function _updateFocusMode() {
  const dist = Math.sqrt(_mouseNX * _mouseNX + _mouseNY * _mouseNY);
  const tgt  = dist < 0.22 ? 1.0 : dist < 0.58 ? (0.58 - dist) / 0.36 : 0;
  _focusLevel += (tgt - _focusLevel) * 0.025;
}

// ── Outer ring update ─────────────────────────────────────────

function _updateOuterRings() {
  const now        = Date.now();
  const focusBoost = 1 + _focusLevel * 0.50;
  const speedMod   = _awIdleMul * _awTimeMod * focusBoost;

  for (const ring of _outerRings) {
    ring.angle += ring.speed * speedMod;
    // Smooth gap and lw transitions
    for (let i = 0; i < ring.gaps.length; i++) {
      ring.gaps[i] += (ring.targetGaps[i] - ring.gaps[i]) * 0.005;
    }
    ring.lw += (ring.targetLw - ring.lw) * 0.004;
    // Individual recalibration
    if (now >= ring.nextRecal) {
      ring.targetGaps = _makeRingGaps(ring.segs, 0.07, 0.30);
      ring.targetLw   = ring.baseLw * (0.60 + Math.random() * 0.80);
      ring.nextRecal  = now + _randMs(22000, 45000);
    }
  }
}

function _checkFormation() {
  const now = Date.now();
  if (!_formationActive && now >= _nextFormation) {
    _formationActive   = true;
    _formationBorn     = now;
    _formationDuration = 4000 + Math.random() * 6000;
    // All rings recalibrate simultaneously — reads as a system event
    for (const ring of _outerRings) {
      ring.targetGaps = _makeRingGaps(ring.segs, 0.05, 0.36);
      ring.targetLw   = ring.baseLw * (0.75 + Math.random() * 0.75);
    }
    _nextFormation = now + _randMs(25000, 65000);
  }
  if (_formationActive && (now - _formationBorn) > _formationDuration) {
    // Settle back to resting configuration
    for (const ring of _outerRings) {
      ring.targetGaps = _makeRingGaps(ring.segs, 0.08, 0.20);
      ring.targetLw   = ring.baseLw;
    }
    _formationActive = false;
  }
}

// ── Geometric data paths ──────────────────────────────────────

function _maybeSpawnPath() {
  if (_paths.length >= MAX_PATHS) return;
  if (Date.now() < _nextPathAt) return;

  const state = State.get('orbState') || 'idle';
  if (state === 'offline') return;

  // State-dependent path character
  const peakAlpha = state === 'thinking'   ? 0.28 + Math.random() * 0.14
                  : state === 'listening'  ? 0.20 + Math.random() * 0.10
                  : state === 'responding' ? 0.22 + Math.random() * 0.12
                  :                          0.14 + Math.random() * 0.10;

  const holdTime  = state === 'thinking'   ? 5000  + Math.random() * 8000
                  : state === 'idle'       ? 10000 + Math.random() * 10000
                  :                          6000  + Math.random() * 8000;

  // Path endpoints in polar coords (inside orb, R=50–90)
  // Constraint: ang2 is not too close to ang1 (avoid very short lines)
  const ang1  = Math.random() * TWO_PI;
  const delta = Math.PI * 0.45 + Math.random() * Math.PI * 0.90;
  const ang2  = ang1 + delta * (Math.random() > 0.5 ? 1 : -1);
  const r1    = 54 + Math.random() * 34;
  const r2    = 50 + Math.random() * 38;

  _paths.push({
    ang1, r1, ang2, r2,
    alpha:     0,
    peakAlpha: peakAlpha * (1 + _pathBoost * 0.50),
    phase:    'in',
    phaseAt:   Date.now(),
    holdTime,
    fadeIn:    2200,
    fadeOut:   2800,
  });

  _nextPathAt = Date.now() + _randMs(4000, 10000);
}

function _updatePaths() {
  if (_pathBoost > 0) _pathBoost = Math.max(0, _pathBoost - 0.008);

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

// ── Main loop ─────────────────────────────────────────────────

function _loop() {
  if (!_canvas || !_ctx) return;

  _updateLiveParams();
  _updateFocusMode();
  _updateOuterRings();
  _checkFormation();
  _maybeSpawnPath();
  _updatePaths();

  // Scan angle
  let scanDelta = _live.scanSpeed;
  if (_microScanBoost) {
    const age = Date.now() - _microScanBoost.born;
    if (age < _microScanBoost.duration) {
      scanDelta *= 1 + Math.sin((age / _microScanBoost.duration) * Math.PI) * (_microScanBoost.multiplier - 1);
    } else {
      _microScanBoost = null;
    }
  }

  const speedMod = _awIdleMul * _awTimeMod;
  _scanAngle += scanDelta * speedMod;
  _arcAngle1 += 0.0016 * speedMod;
  _arcAngle2 -= 0.0007 * speedMod;

  _checkIdlePulse();
  _checkArcSpawn();
  _checkMicroEvent();

  _ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  _drawMouseGlow();
  _drawFocusGlow();
  _drawDepthHalo();
  _drawPaths();         // geometric data paths (innermost layer)
  _drawTicks();         // tick ring
  _drawArcs();          // rotating structural arcs
  _drawOuterRings();    // outer ring system
  _drawEnergyArcs();    // brief arc flashes
  _drawScanner();       // primary scan line
  _drawPulses();        // event + idle pulse rings
  _drawCardinalLabels();

  _rafId = requestAnimationFrame(_loop);
}

// ── Draw: mouse directional glow ──────────────────────────────

function _drawMouseGlow() {
  if (Math.abs(_mouseNX) < 0.02 && Math.abs(_mouseNY) < 0.02) return;
  const gx   = CX + _mouseNX * 50;
  const gy   = CY + _mouseNY * 50;
  const grad = _ctx.createRadialGradient(gx, gy, 8, CX, CY, 210);
  grad.addColorStop(0,   _rgba(0.07 * _awTimeMod));
  grad.addColorStop(0.5, _rgba(0.022 * _awTimeMod));
  grad.addColorStop(1,   _rgba(0));
  _ctx.save();
  _ctx.beginPath();
  _ctx.arc(CX, CY, 210, 0, TWO_PI);
  _ctx.fillStyle = grad;
  _ctx.fill();
  _ctx.restore();
}

// ── Draw: focus glow ──────────────────────────────────────────

function _drawFocusGlow() {
  if (_focusLevel < 0.02) return;
  const a = _focusLevel * 0.048 * _awTimeMod;
  const g = _ctx.createRadialGradient(CX, CY, 50, CX, CY, 258);
  g.addColorStop(0,    _rgba(0));
  g.addColorStop(0.40, _rgba(a * 0.38));
  g.addColorStop(1,    _rgba(a));
  _ctx.save();
  _ctx.beginPath();
  _ctx.arc(CX, CY, 258, 0, TWO_PI);
  _ctx.fillStyle = g;
  _ctx.fill();
  _ctx.restore();
}

// ── Draw: outer ambient depth halo ────────────────────────────

function _drawDepthHalo() {
  const a = 0.034 * _awTimeMod * _awIdleMul * (1 + _focusLevel * 0.45);
  if (a < 0.003) return;
  const g = _ctx.createRadialGradient(CX, CY, 192, CX, CY, 260);
  g.addColorStop(0,    _rgba(0));
  g.addColorStop(0.55, _rgba(a));
  g.addColorStop(1,    _rgba(0));
  _ctx.save();
  _ctx.beginPath();
  _ctx.arc(CX, CY, 260, 0, TWO_PI);
  _ctx.fillStyle = g;
  _ctx.fill();
  _ctx.restore();
}

// ── Draw: geometric data paths ────────────────────────────────
// The primary "living intelligence" element.
// Clean line segments inside the orb — appear, hold, dissolve.

function _drawPaths() {
  if (_paths.length === 0) return;
  const timeFade = _awTimeMod * _awIdleMul;
  _ctx.save();
  _ctx.lineCap = 'round';

  for (const p of _paths) {
    const a = p.alpha * timeFade;
    if (a < 0.004) continue;

    const x1 = CX + Math.cos(p.ang1) * p.r1;
    const y1 = CY + Math.sin(p.ang1) * p.r1;
    const x2 = CX + Math.cos(p.ang2) * p.r2;
    const y2 = CY + Math.sin(p.ang2) * p.r2;

    // The line
    _ctx.beginPath();
    _ctx.moveTo(x1, y1);
    _ctx.lineTo(x2, y2);
    _ctx.strokeStyle = _rgba(a);
    _ctx.lineWidth   = 0.7;
    _ctx.stroke();

    // Endpoint dots — small, structural
    const dotA = Math.min(1, a * 2.8);
    _ctx.fillStyle = _rgba(dotA);
    _ctx.beginPath();
    _ctx.arc(x1, y1, 1.4, 0, TWO_PI);
    _ctx.fill();
    _ctx.beginPath();
    _ctx.arc(x2, y2, 1.4, 0, TWO_PI);
    _ctx.fill();
  }
  _ctx.restore();
}

// ── Draw: tick marks ──────────────────────────────────────────

function _drawTicks() {
  const count      = 60;
  const majorEvery = 5;
  _ctx.save();

  // Background depth ring at R=127–130 (very subtle, desktop only)
  if (!_isMobile) {
    for (let i = 0; i < 48; i++) {
      const angle = (TWO_PI / 48) * i - HALF_PI;
      const alpha = _live.tickAlpha * 0.14 * _awTimeMod * _awIdleMul;
      _ctx.beginPath();
      _ctx.moveTo(CX + Math.cos(angle) * 127, CY + Math.sin(angle) * 127);
      _ctx.lineTo(CX + Math.cos(angle) * 130, CY + Math.sin(angle) * 130);
      _ctx.strokeStyle = _rgba(alpha);
      _ctx.lineWidth   = 0.5;
      _ctx.stroke();
    }
  }

  for (let i = 0; i < count; i++) {
    const angle   = (TWO_PI / count) * i - HALF_PI;
    const isMajor = i % majorEvery === 0;
    const len     = isMajor ? 7 : 3.5;
    const alpha   = (isMajor ? _live.tickAlpha : _live.tickAlpha * 0.40) * _awTimeMod * _awIdleMul;
    const x1 = CX + Math.cos(angle) * R_TICKS;
    const y1 = CY + Math.sin(angle) * R_TICKS;
    const x2 = CX + Math.cos(angle) * (R_TICKS + len);
    const y2 = CY + Math.sin(angle) * (R_TICKS + len);
    _ctx.beginPath();
    _ctx.moveTo(x1, y1);
    _ctx.lineTo(x2, y2);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = isMajor ? 1.1 : 0.6;
    _ctx.stroke();
  }
  _ctx.restore();
}

// ── Draw: rotating arc segments ───────────────────────────────

function _drawArcs() {
  const s = _live.arcScale * _awTimeMod * _awIdleMul;
  _ctx.save();

  const arc1Start = _arcAngle1;
  const arc1Span  = (95 / 180)  * Math.PI;
  const gap       = (14 / 180)  * Math.PI;

  _ctx.strokeStyle = _rgba(0.34 * s);
  _ctx.lineWidth   = 1.1;
  for (let i = 0; i < 2; i++) {
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ARC_INNER, arc1Start + i * Math.PI + gap, arc1Start + i * Math.PI + arc1Span - gap);
    _ctx.stroke();
  }

  _ctx.strokeStyle = _rgba(0.16 * s);
  _ctx.lineWidth   = 0.7;
  _ctx.beginPath();
  _ctx.arc(CX, CY, R_ARC_OUTER, _arcAngle2, _arcAngle2 + (165 / 180) * Math.PI);
  _ctx.stroke();

  // Leading dots on inner arc
  _ctx.fillStyle = _rgba(0.48 * s);
  const dotAngle = arc1Start + gap;
  for (let i = 0; i < 2; i++) {
    const a = dotAngle + i * Math.PI;
    _ctx.beginPath();
    _ctx.arc(CX + Math.cos(a) * R_ARC_INNER, CY + Math.sin(a) * R_ARC_INNER, 1.6, 0, TWO_PI);
    _ctx.fill();
  }
  _ctx.restore();
}

// ── Draw: outer ring system ───────────────────────────────────

function _drawOuterRings() {
  const focusBoost = 1 + _focusLevel * 0.45;
  const timeFade   = _awTimeMod * _awIdleMul;
  const state      = State.get('orbState') || 'idle';
  const stateMul   = state === 'thinking'  ? 1.40
                   : state === 'listening' ? 1.20
                   : state === 'error'     ? 0.65
                   : 1.0;
  const formMul    = _formationActive ? 1.25 : 1.0;

  _ctx.save();
  _ctx.lineCap = 'butt';

  for (const ring of _outerRings) {
    const alpha = ring.baseAlpha * timeFade * focusBoost * stateMul * formMul;
    if (alpha < 0.005) continue;

    const totalGap = ring.gaps.reduce((s, g) => s + g, 0);
    const arcFrac  = Math.max(0.09, 1 - totalGap);
    const segSpan  = (arcFrac / ring.segs) * TWO_PI;

    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = ring.lw;

    let cursor = ring.angle;
    for (let i = 0; i < ring.segs; i++) {
      const gapSpan = (ring.gaps[i] ?? 0.11) * TWO_PI;
      _ctx.beginPath();
      _ctx.arc(CX, CY, ring.r, cursor, cursor + segSpan);
      _ctx.stroke();

      // Leading-edge dot — subtle
      const ex = CX + Math.cos(cursor + segSpan) * ring.r;
      const ey = CY + Math.sin(cursor + segSpan) * ring.r;
      _ctx.beginPath();
      _ctx.arc(ex, ey, ring.lw * 1.3, 0, TWO_PI);
      _ctx.fillStyle = _rgba(Math.min(1, alpha * 2.0));
      _ctx.fill();

      cursor += segSpan + gapSpan;
    }
  }
  _ctx.restore();
}

// ── Draw: scanner beam ────────────────────────────────────────

function _drawScanner() {
  _ctx.save();
  const endX = CX + Math.cos(_scanAngle) * R_SCANNER;
  const endY = CY + Math.sin(_scanAngle) * R_SCANNER;
  const sa   = _live.scanAlpha * _awTimeMod * _awIdleMul;

  const grad = _ctx.createLinearGradient(CX, CY, endX, endY);
  grad.addColorStop(0,    _rgba(0));
  grad.addColorStop(0.38, _rgba(sa * 0.22));
  grad.addColorStop(0.82, _rgba(sa * 0.65));
  grad.addColorStop(1,    _rgba(sa));

  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.lineTo(endX, endY);
  _ctx.strokeStyle = grad;
  _ctx.lineWidth   = 1.4;
  _ctx.stroke();

  _ctx.beginPath();
  _ctx.arc(endX, endY, 1.8, 0, TWO_PI);
  _ctx.fillStyle = _rgba(sa * 1.55);
  _ctx.fill();

  // Faint trailing sweep wedge
  const sweepGrad = _ctx.createRadialGradient(CX, CY, 38, CX, CY, R_SCANNER);
  sweepGrad.addColorStop(0, _rgba(0));
  sweepGrad.addColorStop(1, _rgba(sa * 0.11));
  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.arc(CX, CY, R_SCANNER, _scanAngle - 0.16, _scanAngle, false);
  _ctx.closePath();
  _ctx.fillStyle = sweepGrad;
  _ctx.fill();

  _ctx.restore();
}

// ── Draw: energy arcs ─────────────────────────────────────────

function _checkArcSpawn() {
  const state = State.get('orbState') || 'idle';
  const rate  = (ARC_RATES[state] ?? 0) * _awEnergy;
  if (rate > 0 && Math.random() < rate) _spawnEnergyArc(state);
}

function _spawnEnergyArc(state) {
  const cfg = ARC_CONFIGS[state];
  if (!cfg) return;
  const startAngle = Math.random() * TWO_PI;
  const span       = cfg.minSpan + Math.random() * (cfg.maxSpan - cfg.minSpan);
  const dir        = Math.random() > 0.5 ? 1 : -1;
  _energyArcs.push({
    startAngle,
    endAngle:  startAngle + span * dir,
    bow:       cfg.bow + (Math.random() - 0.5) * 0.14,
    r:         R_ARC_INNER + (Math.random() - 0.5) * 16,
    life:      cfg.minLife + Math.random() * (cfg.maxLife - cfg.minLife),
    w:         cfg.w,
    peakAlpha: cfg.peakAlpha,
    born:      Date.now(),
    broken:    state === 'error',
  });
  if (_energyArcs.length > 8) _energyArcs.splice(0, 1);
}

function _drawEnergyArcs() {
  if (!_energyArcs.length) return;
  const now = Date.now();
  _ctx.save();
  _ctx.lineCap = 'round';
  for (let i = _energyArcs.length - 1; i >= 0; i--) {
    const arc = _energyArcs[i];
    const age = now - arc.born;
    if (age > arc.life) { _energyArcs.splice(i, 1); continue; }
    const t     = age / arc.life;
    const env   = t < 0.12 ? t / 0.12 : t > 0.72 ? (1 - t) / 0.28 : 1;
    const alpha = arc.peakAlpha * env * _awTimeMod * _awIdleMul;
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = arc.w;
    if (arc.broken) {
      const mid = (arc.startAngle + arc.endAngle) / 2;
      _drawArcBezier(arc.startAngle, mid - 0.10, arc.r, arc.bow);
      _drawArcBezier(mid + 0.10, arc.endAngle,   arc.r, arc.bow);
    } else {
      _drawArcBezier(arc.startAngle, arc.endAngle, arc.r, arc.bow);
    }
  }
  _ctx.restore();
}

function _drawArcBezier(a1, a2, r, bow) {
  const x1  = CX + Math.cos(a1) * r;
  const y1  = CY + Math.sin(a1) * r;
  const x2  = CX + Math.cos(a2) * r;
  const y2  = CY + Math.sin(a2) * r;
  const mid = (a1 + a2) / 2;
  _ctx.beginPath();
  _ctx.moveTo(x1, y1);
  _ctx.quadraticCurveTo(
    CX + Math.cos(mid) * r * bow, CY + Math.sin(mid) * r * bow,
    x2, y2,
  );
  _ctx.stroke();
}

// ── Pulse rings ───────────────────────────────────────────────

function _spawnPulse(opts) {
  _pulses.push({ r: opts?.r ?? R_PULSE_START, born: Date.now(), fast: opts?.fast ?? false });
}

function _drawPulses() {
  const now = Date.now();
  for (let i = _pulses.length - 1; i >= 0; i--) {
    const p   = _pulses[i];
    const dur = p.fast ? 1300 : 2400;
    const age = now - p.born;
    if (age > dur) { _pulses.splice(i, 1); continue; }
    const t     = age / dur;
    const r     = p.r + (R_PULSE_END - p.r) * _easeOut(t);
    const alpha = (1 - t) * (p.fast ? 0.34 : 0.40) * _awTimeMod;
    _ctx.save();
    _ctx.beginPath();
    _ctx.arc(CX, CY, r, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = p.fast ? 0.7 : 0.9;
    _ctx.stroke();
    _ctx.restore();
  }
}

// ── Reactive energy wave ──────────────────────────────────────
// Cascade: core → mid → tick zone. Also boosts path alpha briefly.

function _triggerEnergyWave(intensity) {
  const t = intensity ?? 1.0;
  setTimeout(() => _pulses.push({ r: 44,           born: Date.now(), fast: true  }),   0);
  setTimeout(() => _pulses.push({ r: R_PULSE_START, born: Date.now(), fast: false }), 200);
  setTimeout(() => _pulses.push({ r: R_TICKS + 4,  born: Date.now(), fast: true  }), 380);
  _pathBoost = Math.min(1, _pathBoost + t * 0.85);
}

// ── Cardinal labels ───────────────────────────────────────────

function _drawCardinalLabels() {
  _ctx.save();
  _ctx.font         = '9px -apple-system,"Segoe UI",system-ui,sans-serif';
  _ctx.textBaseline = 'middle';
  const positions = [
    { angle: -HALF_PI, align: 'center', label: `${_noteCount} NOTES` },
    { angle:  0,       align: 'left',   label: `${_taskPending} PENDING` },
    { angle:  HALF_PI, align: 'center', label: _getDateLabel() },
    { angle:  Math.PI, align: 'right',  label: _getUptimeLabel() },
  ];
  for (const { angle, align, label } of positions) {
    _ctx.textAlign     = align;
    _ctx.fillStyle     = _rgba(0.32 * _awTimeMod);
    _ctx.letterSpacing = '0.1em';
    _ctx.fillText(label, CX + Math.cos(angle) * R_LABELS, CY + Math.sin(angle) * R_LABELS);
  }
  _ctx.restore();
}

// ── Micro-events ──────────────────────────────────────────────

function _checkMicroEvent() {
  if (Date.now() < _nextMicroEvent) return;
  _nextMicroEvent = Date.now() + _randMs(18000, 55000);

  const state = State.get('orbState') || 'idle';
  if (state === 'offline' || state === 'thinking' || state === 'responding') return;

  const roll = Math.random();

  if (roll < 0.20) {
    // Scanner sweep burst
    _microScanBoost = { born: Date.now(), duration: 2400, multiplier: 3.2 };
  } else if (roll < 0.38) {
    // Triple pulse — outward wave
    _spawnPulse(); setTimeout(_spawnPulse, 240); setTimeout(_spawnPulse, 480);
  } else if (roll < 0.52) {
    // Core burst — tight fast pulses
    for (let i = 0; i < 3; i++) {
      setTimeout(() => _pulses.push({ r: 50, born: Date.now(), fast: true }), i * 120);
    }
  } else if (roll < 0.65) {
    // Arc burst — brief energy arcs
    const s = State.get('orbState') || 'idle';
    for (let i = 0; i < 4; i++) _spawnEnergyArc(s === 'offline' ? 'idle' : s);
  } else if (roll < 0.76) {
    // Arc ring recalibration
    _arcAngle1 += (Math.random() - 0.5) * 0.85;
    _arcAngle2 += (Math.random() - 0.5) * 0.85;
  } else if (roll < 0.85) {
    // Deep scan — slow pulse from center
    _pulses.push({ r: 28, born: Date.now(), fast: false });
  } else if (roll < 0.93) {
    // Outer ring formation trigger
    if (!_formationActive) {
      _formationActive   = true;
      _formationBorn     = Date.now();
      _formationDuration = 3500 + Math.random() * 3000;
      for (const ring of _outerRings) {
        ring.targetGaps = _makeRingGaps(ring.segs, 0.04, 0.38);
        ring.targetLw   = ring.baseLw * (0.80 + Math.random() * 0.70);
      }
    }
  } else {
    // Path reconfiguration — expedite next path
    _nextPathAt = Date.now() + 200;
    for (const p of _paths) p.phase = 'out';
  }
}

// ── Ambient idle pulse ────────────────────────────────────────

function _checkIdlePulse() {
  if (Date.now() < _nextIdlePulse) return;
  _nextIdlePulse = Date.now() + _randMs(22000, 45000);
  _spawnPulse();
  pulseOrb();
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

function _makeRingGaps(segs, minFrac, maxFrac) {
  return Array.from({ length: segs }, () => minFrac + Math.random() * (maxFrac - minFrac));
}
