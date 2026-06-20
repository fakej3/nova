/**
 * NOVA HUD System
 * Canvas-drawn orbital HUD around the orb + screen-level ambient elements.
 * State-aware: scanner speed, arc brightness, and micro-events all react
 * to orb state changes. Energy arc system adds procedural lightning-style
 * arcs that vary in frequency and character per state.
 */

import { DB }              from '../core/db.js';
import { Bus, EVENTS }     from '../core/bus.js';
import { pulseOrb }        from './orb.js';
import { State }           from '../core/state.js';

// ── Constants ─────────────────────────────────────────────────

const TWO_PI   = Math.PI * 2;
const HALF_PI  = Math.PI / 2;

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

// ── State parameter tables ────────────────────────────────────
//
// Each value lerps toward the target for the current orb state.
// scanSpeed  — how fast the scanner beam rotates (rad/frame)
// scanAlpha  — peak brightness of the scanner beam and tip
// arcScale   — brightness multiplier on the rotating arc segments
// tickAlpha  — major tick mark brightness

const STATE_TARGETS = {
  idle:       { scanSpeed: 0.0040, scanAlpha: 0.22, arcScale: 1.00, tickAlpha: 0.28 },
  listening:  { scanSpeed: 0.0070, scanAlpha: 0.34, arcScale: 1.30, tickAlpha: 0.36 },
  thinking:   { scanSpeed: 0.0165, scanAlpha: 0.52, arcScale: 1.80, tickAlpha: 0.50 },
  responding: { scanSpeed: 0.0120, scanAlpha: 0.42, arcScale: 1.50, tickAlpha: 0.40 },
  success:    { scanSpeed: 0.0022, scanAlpha: 0.12, arcScale: 0.55, tickAlpha: 0.16 },
  error:      { scanSpeed: 0.0085, scanAlpha: 0.30, arcScale: 0.90, tickAlpha: 0.22 },
  offline:    { scanSpeed: 0.0008, scanAlpha: 0.05, arcScale: 0.10, tickAlpha: 0.06 },
};

// ── Energy arc spawn rates (probability per frame) ────────────

const ARC_RATES = {
  idle:       0.0022,
  listening:  0.010,
  thinking:   0.038,
  responding: 0.028,
  success:    0.0,
  error:      0.018,
  offline:    0.0,
};

// Arc shape config per state
const ARC_CONFIGS = {
  idle:       { minSpan: 0.25, maxSpan: 1.0,  bow: 0.84, minLife: 700,  maxLife: 1600, w: 0.7,  peakAlpha: 0.28 },
  listening:  { minSpan: 0.4,  maxSpan: 1.5,  bow: 0.88, minLife: 500,  maxLife: 1200, w: 0.9,  peakAlpha: 0.38 },
  thinking:   { minSpan: 0.3,  maxSpan: 2.2,  bow: 0.78, minLife: 250,  maxLife: 900,  w: 1.0,  peakAlpha: 0.48 },
  responding: { minSpan: 0.6,  maxSpan: 2.4,  bow: 0.72, minLife: 180,  maxLife: 650,  w: 1.15, peakAlpha: 0.52 },
  error:      { minSpan: 0.12, maxSpan: 0.65, bow: 1.18, minLife: 120,  maxLife: 450,  w: 0.8,  peakAlpha: 0.34 },
};

// ── Module state ───────────────────────────────────────────────

let _canvas  = null;
let _ctx     = null;
let _dpr     = 1;
let _rafId   = null;
let _frame   = 0;

let _color    = '#00d4ff';
let _colorRgb = '0, 212, 255';

let _scanAngle = -HALF_PI;
let _arcAngle1 =  0;
let _arcAngle2 =  Math.PI;

let _noteCount    = 0;
let _taskPending  = 0;
let _sessionStart = Date.now();

// Live interpolated state params
let _live = { ...STATE_TARGETS.idle };

// Pulse rings
const _pulses = [];
let _nextIdlePulse = Date.now() + _randMs(18000, 35000);

// Data fragment flashes
const _fragments = [];
let _nextFragment = Date.now() + _randMs(12000, 25000);

const FRAGMENT_POOL = [
  'SYS:OK', 'MEM:IDLE', 'CTX:READY', 'IDX:0', 'SYNC:—',
  '0x00FF', 'INT:0', 'PROC:—', 'NET:OK', 'BUF:CLR',
];

// Energy arcs
const _energyArcs = [];

// Ambient micro-events
let _microScanBoost  = null;   // { born, duration, multiplier }
let _nextMicroEvent  = Date.now() + _randMs(20000, 50000);

// Mouse influence (set by mouse.js via setHudMouseInfluence)
let _mouseNX = 0;
let _mouseNY = 0;

// ── Public API ─────────────────────────────────────────────────

/**
 * Called by mouse.js each tick to pass normalized mouse position (-1..1).
 * Used to shift the HUD background glow toward the cursor.
 */
export function setHudMouseInfluence(nx, ny) {
  _mouseNX = nx;
  _mouseNY = ny;
}

// ── Init ──────────────────────────────────────────────────────

export async function initHud() {
  _canvas = document.getElementById('orb-hud-canvas');
  if (!_canvas) return;
  _ctx = _canvas.getContext('2d');

  _dpr = Math.min(window.devicePixelRatio || 1, 2);
  _sizeCanvas();
  window.addEventListener('resize', _sizeCanvas, { passive: true });

  _readColor();
  Bus.on(EVENTS.THEME_CHANGED, () => requestAnimationFrame(_readColor));

  await _refreshCounts();

  Bus.on(EVENTS.NOTE_CREATED,    () => { _noteCount++;   _updateSystemBar(); });
  Bus.on(EVENTS.NOTE_DELETED,    () => { _noteCount = Math.max(0, _noteCount - 1); _updateSystemBar(); });
  Bus.on(EVENTS.TASK_CREATED,    () => { _taskPending++; _updateSystemBar(); });
  Bus.on(EVENTS.TASK_COMPLETED,  () => { _taskPending = Math.max(0, _taskPending - 1); _updateSystemBar(); _spawnPulse(); });
  Bus.on(EVENTS.TASK_DELETED,    () => { _taskPending = Math.max(0, _taskPending - 1); _updateSystemBar(); });
  Bus.on(EVENTS.NOTE_CREATED,    _spawnPulse);
  Bus.on(EVENTS.TASK_CREATED,    _spawnPulse);

  // Success: triple wave expansion; Error: single warning pulse
  Bus.on(EVENTS.ORB_STATE_CHANGED, ({ state }) => {
    if (state === 'success') {
      _spawnPulse();
      setTimeout(_spawnPulse, 260);
      setTimeout(_spawnPulse, 520);
      pulseOrb();
    }
    if (state === 'error') {
      _spawnPulse();
    }
  });

  _updateSystemBar();
  _updateGreeting();
  setInterval(_updateSystemBar,  1000);
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
  const style = getComputedStyle(document.documentElement);
  _color    = style.getPropertyValue('--orb-color').trim()     || '#00d4ff';
  _colorRgb = style.getPropertyValue('--orb-color-rgb').trim() || '0, 212, 255';
}

function _rgba(alpha) {
  return `rgba(${_colorRgb}, ${alpha.toFixed(3)})`;
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
  const L = 0.035; // lerp factor — ~28 frames to 63% of target
  for (const k of Object.keys(_live)) {
    if (k in target) _live[k] += (target[k] - _live[k]) * L;
  }
}

// ── Main loop ─────────────────────────────────────────────────

function _loop() {
  if (!_canvas || !_ctx) return;

  _frame++;
  _updateLiveParams();

  // Scanner speed with optional micro-boost overlay
  let scanDelta = _live.scanSpeed;
  if (_microScanBoost) {
    const age = Date.now() - _microScanBoost.born;
    if (age < _microScanBoost.duration) {
      const t     = age / _microScanBoost.duration;
      const boost = Math.sin(t * Math.PI); // ramps up then back down
      scanDelta  *= 1 + boost * (_microScanBoost.multiplier - 1);
    } else {
      _microScanBoost = null;
    }
  }

  _scanAngle += scanDelta;
  _arcAngle1 += 0.0018;
  _arcAngle2 -= 0.0008;

  _checkIdlePulse();
  _checkFragment();
  _checkArcSpawn();
  _checkMicroEvent();

  _ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  _drawMouseGlow();
  _drawTicks();
  _drawArcs();
  _drawEnergyArcs();
  _drawScanner();
  _drawPulses();
  _drawFragments();
  _drawCardinalLabels();

  _rafId = requestAnimationFrame(_loop);
}

// ── Draw: mouse directional glow ──────────────────────────────

function _drawMouseGlow() {
  if (Math.abs(_mouseNX) < 0.02 && Math.abs(_mouseNY) < 0.02) return;

  const shift = 55;
  const gx    = CX + _mouseNX * shift;
  const gy    = CY + _mouseNY * shift;

  const grad = _ctx.createRadialGradient(gx, gy, 8, CX, CY, 215);
  grad.addColorStop(0,   _rgba(0.08));
  grad.addColorStop(0.5, _rgba(0.025));
  grad.addColorStop(1,   _rgba(0));

  _ctx.save();
  _ctx.beginPath();
  _ctx.arc(CX, CY, 215, 0, TWO_PI);
  _ctx.fillStyle = grad;
  _ctx.fill();
  _ctx.restore();
}

// ── Draw: tick marks ──────────────────────────────────────────

function _drawTicks() {
  const count      = 60;
  const majorEvery = 5;

  _ctx.save();
  for (let i = 0; i < count; i++) {
    const angle    = (TWO_PI / count) * i - HALF_PI;
    const isMajor  = i % majorEvery === 0;
    const len      = isMajor ? 7 : 3.5;
    const alpha    = isMajor ? _live.tickAlpha : _live.tickAlpha * 0.43;

    const x1 = CX + Math.cos(angle) * R_TICKS;
    const y1 = CY + Math.sin(angle) * R_TICKS;
    const x2 = CX + Math.cos(angle) * (R_TICKS + len);
    const y2 = CY + Math.sin(angle) * (R_TICKS + len);

    _ctx.beginPath();
    _ctx.moveTo(x1, y1);
    _ctx.lineTo(x2, y2);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = isMajor ? 1.2 : 0.7;
    _ctx.stroke();
  }
  _ctx.restore();
}

// ── Draw: rotating arc segments ───────────────────────────────

function _drawArcs() {
  const s = _live.arcScale;
  _ctx.save();

  const arc1Start = _arcAngle1;
  const arc1Span  = (100 / 180) * Math.PI;
  const gap       = (12 / 180) * Math.PI;

  _ctx.strokeStyle = _rgba(0.38 * s);
  _ctx.lineWidth   = 1.2;

  for (let i = 0; i < 2; i++) {
    const offset = i * Math.PI;
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ARC_INNER, arc1Start + offset + gap, arc1Start + offset + arc1Span - gap);
    _ctx.stroke();
  }

  _ctx.strokeStyle = _rgba(0.18 * s);
  _ctx.lineWidth   = 0.8;
  _ctx.beginPath();
  _ctx.arc(CX, CY, R_ARC_OUTER, _arcAngle2, _arcAngle2 + (170 / 180) * Math.PI);
  _ctx.stroke();

  _ctx.fillStyle = _rgba(0.5 * s);
  const dotAngle = arc1Start + gap;
  for (let i = 0; i < 2; i++) {
    const a = dotAngle + i * Math.PI;
    _ctx.beginPath();
    _ctx.arc(CX + Math.cos(a) * R_ARC_INNER, CY + Math.sin(a) * R_ARC_INNER, 1.8, 0, TWO_PI);
    _ctx.fill();
  }

  _ctx.restore();
}

// ── Draw: scanner beam ────────────────────────────────────────

function _drawScanner() {
  _ctx.save();

  const endX = CX + Math.cos(_scanAngle) * R_SCANNER;
  const endY = CY + Math.sin(_scanAngle) * R_SCANNER;
  const sa   = _live.scanAlpha;

  const grad = _ctx.createLinearGradient(CX, CY, endX, endY);
  grad.addColorStop(0,    _rgba(0));
  grad.addColorStop(0.4,  _rgba(sa * 0.25));
  grad.addColorStop(0.85, _rgba(sa * 0.68));
  grad.addColorStop(1,    _rgba(sa));

  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.lineTo(endX, endY);
  _ctx.strokeStyle = grad;
  _ctx.lineWidth   = 1.5;
  _ctx.stroke();

  _ctx.beginPath();
  _ctx.arc(endX, endY, 2, 0, TWO_PI);
  _ctx.fillStyle = _rgba(sa * 1.65);
  _ctx.fill();

  const trailAngle = 0.18;
  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.arc(CX, CY, R_SCANNER, _scanAngle - trailAngle, _scanAngle, false);
  _ctx.closePath();
  const sweepGrad = _ctx.createRadialGradient(CX, CY, 40, CX, CY, R_SCANNER);
  sweepGrad.addColorStop(0, _rgba(0));
  sweepGrad.addColorStop(1, _rgba(sa * 0.14));
  _ctx.fillStyle = sweepGrad;
  _ctx.fill();

  _ctx.restore();
}

// ── Draw: pulse rings ─────────────────────────────────────────

function _spawnPulse(options) {
  _pulses.push({ r: options?.r ?? R_PULSE_START, born: Date.now(), fast: options?.fast ?? false });
}

function _drawPulses() {
  const now = Date.now();

  for (let i = _pulses.length - 1; i >= 0; i--) {
    const p   = _pulses[i];
    const dur = p.fast ? 1300 : 2200;
    const age = now - p.born;
    if (age > dur) { _pulses.splice(i, 1); continue; }

    const t     = age / dur;
    const r     = p.r + (R_PULSE_END - p.r) * _easeOut(t);
    const alpha = (1 - t) * (p.fast ? 0.38 : 0.45);

    _ctx.save();
    _ctx.beginPath();
    _ctx.arc(CX, CY, r, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = p.fast ? 0.8 : 1;
    _ctx.stroke();
    _ctx.restore();
  }
}

// ── Draw: data fragments ──────────────────────────────────────

function _checkFragment() {
  if (Date.now() < _nextFragment) return;
  _nextFragment = Date.now() + _randMs(14000, 28000);

  const angle = Math.random() * TWO_PI;
  const dist  = R_LABELS + 10 + Math.random() * 20;
  _fragments.push({
    text: FRAGMENT_POOL[Math.floor(Math.random() * FRAGMENT_POOL.length)],
    x:    CX + Math.cos(angle) * dist,
    y:    CY + Math.sin(angle) * dist,
    born: Date.now(),
    life: 1800 + Math.random() * 800,
  });
}

function _drawFragments() {
  const now = Date.now();
  _ctx.save();
  _ctx.font         = '9px "SF Mono", "Fira Code", "Consolas", monospace';
  _ctx.textAlign    = 'center';
  _ctx.textBaseline = 'middle';

  for (let i = _fragments.length - 1; i >= 0; i--) {
    const f   = _fragments[i];
    const age = now - f.born;
    if (age > f.life) { _fragments.splice(i, 1); continue; }

    const t     = age / f.life;
    const alpha = t < 0.15
      ? (t / 0.15) * 0.35
      : t > 0.75
        ? ((1 - t) / 0.25) * 0.35
        : 0.35;

    _ctx.fillStyle = _rgba(alpha);
    _ctx.fillText(f.text, f.x, f.y);
  }
  _ctx.restore();
}

// ── Draw: cardinal data labels ────────────────────────────────

function _drawCardinalLabels() {
  _ctx.save();
  _ctx.font         = '9px -apple-system, "Segoe UI", system-ui, sans-serif';
  _ctx.textBaseline = 'middle';

  const positions = [
    { angle: -HALF_PI,  align: 'center', label: `${_noteCount} NOTES` },
    { angle:  0,        align: 'left',   label: `${_taskPending} PENDING` },
    { angle:  HALF_PI,  align: 'center', label: _getDateLabel() },
    { angle:  Math.PI,  align: 'right',  label: _getUptimeLabel() },
  ];

  for (const { angle, align, label } of positions) {
    const x = CX + Math.cos(angle) * R_LABELS;
    const y = CY + Math.sin(angle) * R_LABELS;
    _ctx.textAlign    = align;
    _ctx.fillStyle    = _rgba(0.38);
    _ctx.letterSpacing = '0.1em';
    _ctx.fillText(label, x, y);
  }

  _ctx.restore();
}

// ── Energy arcs ────────────────────────────────────────────────

function _checkArcSpawn() {
  const state = State.get('orbState') || 'idle';
  const rate  = ARC_RATES[state] ?? 0;
  if (rate > 0 && Math.random() < rate) _spawnEnergyArc(state);
}

function _spawnEnergyArc(state) {
  const cfg = ARC_CONFIGS[state];
  if (!cfg) return;

  const startAngle = Math.random() * TWO_PI;
  const span       = cfg.minSpan + Math.random() * (cfg.maxSpan - cfg.minSpan);
  const dir        = Math.random() > 0.5 ? 1 : -1;
  const endAngle   = startAngle + span * dir;
  const bow        = cfg.bow + (Math.random() - 0.5) * 0.15;
  const r          = R_ARC_INNER + (Math.random() - 0.5) * 18;
  const life       = cfg.minLife + Math.random() * (cfg.maxLife - cfg.minLife);

  _energyArcs.push({
    startAngle, endAngle, bow, r, life,
    w: cfg.w, peakAlpha: cfg.peakAlpha,
    born:   Date.now(),
    broken: state === 'error',
  });

  if (_energyArcs.length > 9) _energyArcs.splice(0, 1);
}

function _drawEnergyArcs() {
  if (_energyArcs.length === 0) return;
  const now = Date.now();

  _ctx.save();
  _ctx.lineCap = 'round';

  for (let i = _energyArcs.length - 1; i >= 0; i--) {
    const arc = _energyArcs[i];
    const age = now - arc.born;

    if (age > arc.life) { _energyArcs.splice(i, 1); continue; }

    const t = age / arc.life;
    // Fade-in: 0–12%, hold: 12–72%, fade-out: 72–100%
    let env;
    if (t < 0.12)      env = t / 0.12;
    else if (t > 0.72) env = (1 - t) / 0.28;
    else               env = 1;

    const alpha = arc.peakAlpha * env;
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = arc.w;

    if (arc.broken) {
      const mid = (arc.startAngle + arc.endAngle) / 2;
      const gap = 0.12;
      _drawArcBezier(arc.startAngle, mid - gap, arc.r, arc.bow);
      _drawArcBezier(mid + gap, arc.endAngle, arc.r, arc.bow);
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
  const cpX = CX + Math.cos(mid) * r * bow;
  const cpY = CY + Math.sin(mid) * r * bow;
  _ctx.beginPath();
  _ctx.moveTo(x1, y1);
  _ctx.quadraticCurveTo(cpX, cpY, x2, y2);
  _ctx.stroke();
}

// ── Ambient micro-events ───────────────────────────────────────

function _checkMicroEvent() {
  if (Date.now() < _nextMicroEvent) return;
  _nextMicroEvent = Date.now() + _randMs(15000, 42000);

  const state = State.get('orbState') || 'idle';
  // Don't interrupt active AI processing states
  if (state === 'offline' || state === 'thinking' || state === 'responding') return;

  const roll = Math.random();

  if (roll < 0.28) {
    // Scanner sweep burst — briefly 3.5× speed for ~2 seconds
    _microScanBoost = { born: Date.now(), duration: 2200, multiplier: 3.5 };

  } else if (roll < 0.52) {
    // Triple energy ripple
    _spawnPulse();
    setTimeout(_spawnPulse, 230);
    setTimeout(_spawnPulse, 460);

  } else if (roll < 0.72) {
    // Core burst — 4 fast tight pulses from the inner reactor
    for (let i = 0; i < 4; i++) {
      setTimeout(() => _pulses.push({ r: 52, born: Date.now(), fast: true }), i * 115);
    }

  } else {
    // Ring recalibration — offset the arc angles slightly
    _arcAngle1 += (Math.random() - 0.5) * 0.9;
    _arcAngle2 += (Math.random() - 0.5) * 0.9;
  }
}

// ── Ambient idle pulse ────────────────────────────────────────

function _checkIdlePulse() {
  if (Date.now() < _nextIdlePulse) return;
  _nextIdlePulse = Date.now() + _randMs(20000, 42000);
  _spawnPulse();
  pulseOrb();
}

// ── System bar ────────────────────────────────────────────────

function _updateSystemBar() {
  const notesEl  = document.getElementById('sys-notes');
  const tasksEl  = document.getElementById('sys-tasks');
  const uptimeEl = document.getElementById('sys-uptime');

  if (notesEl)  notesEl.textContent  = `${_noteCount} NOTES`;
  if (tasksEl)  tasksEl.textContent  = `${_taskPending} PENDING`;
  if (uptimeEl) uptimeEl.textContent = `UPTIME ${_getUptimeLabel()}`;
}

// ── Greeting ──────────────────────────────────────────────────

function _updateGreeting() {
  const el = document.getElementById('nova-greeting');
  if (!el) return;

  const hour = new Date().getHours();
  const name = State.get('userName');

  let salutation;
  if (hour < 5)       salutation = 'WORKING LATE';
  else if (hour < 12) salutation = 'GOOD MORNING';
  else if (hour < 17) salutation = 'GOOD AFTERNOON';
  else if (hour < 21) salutation = 'GOOD EVENING';
  else                salutation = 'GOOD NIGHT';

  el.textContent = name ? `${salutation}, ${name.toUpperCase()}` : salutation;
}

// ── Helpers ───────────────────────────────────────────────────

function _getUptimeLabel() {
  const s   = Math.floor((Date.now() - _sessionStart) / 1000);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function _getDateLabel() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

function _easeOut(t) {
  return 1 - Math.pow(1 - t, 2.5);
}

function _randMs(min, max) {
  return min + Math.random() * (max - min);
}
