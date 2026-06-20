/**
 * NOVA HUD System
 * Canvas-drawn orbital HUD around the orb + screen-level ambient elements.
 * Everything here is cosmetic and reads real data (note/task counts).
 * No fake metrics. No noise for noise's sake.
 */

import { DB }              from '../core/db.js';
import { Bus, EVENTS }     from '../core/bus.js';
import { pulseOrb }        from './orb.js';
import { State }           from '../core/state.js';

// ── Constants ─────────────────────────────────────────────────

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// Radii relative to canvas center (canvas is 520×520, center 260,260)
const CANVAS_SIZE  = 520;
const CX           = 260;
const CY           = 260;
const R_TICKS      = 136;  // tick marks ring
const R_ARC_INNER  = 154;  // fast arcs
const R_ARC_OUTER  = 172;  // slow outer arc
const R_SCANNER    = 170;  // scanner beam length
const R_LABELS     = 202;  // cardinal data readouts
const R_PULSE_START = 118;
const R_PULSE_END   = 270;

// ── State ──────────────────────────────────────────────────────

let _canvas   = null;
let _ctx      = null;
let _dpr      = 1;
let _rafId    = null;
let _frame    = 0;

let _color    = '#00d4ff';
let _colorRgb = '0, 212, 255';

// Animated values
let _scanAngle  = -HALF_PI;       // scanner beam, starts at 12 o'clock
let _arcAngle1  =  0;             // fast arc group rotation
let _arcAngle2  =  Math.PI;       // slow outer arc rotation (offset start)

// Live data from DB
let _noteCount   = 0;
let _taskPending = 0;
let _sessionStart = Date.now();

// Pulse rings — each: { r, opacity, born }
const _pulses = [];

// Ambient idle pulse timer
let _nextIdlePulse = Date.now() + _randMs(18000, 35000);

// Data fragments — brief text flashes near the orb
const _fragments = [];
let _nextFragment = Date.now() + _randMs(12000, 25000);

const FRAGMENT_POOL = [
  'SYS:OK', 'MEM:IDLE', 'CTX:READY', 'IDX:0', 'SYNC:—',
  '0x00FF', 'INT:0', 'PROC:—', 'NET:OK', 'BUF:CLR',
];

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

  // Load real counts
  await _refreshCounts();

  // Keep counts live
  Bus.on(EVENTS.NOTE_CREATED, () => { _noteCount++;    _updateSystemBar(); });
  Bus.on(EVENTS.NOTE_DELETED, () => { _noteCount = Math.max(0, _noteCount - 1); _updateSystemBar(); });
  Bus.on(EVENTS.TASK_CREATED, () => { _taskPending++;  _updateSystemBar(); });
  Bus.on(EVENTS.TASK_COMPLETED, () => {
    _taskPending = Math.max(0, _taskPending - 1);
    _updateSystemBar();
    _spawnPulse();   // celebrate completion
  });
  Bus.on(EVENTS.TASK_DELETED, () => {
    _taskPending = Math.max(0, _taskPending - 1);
    _updateSystemBar();
  });

  // Spawn a pulse on meaningful events
  Bus.on(EVENTS.NOTE_CREATED, _spawnPulse);
  Bus.on(EVENTS.TASK_CREATED, _spawnPulse);

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
  return `rgba(${_colorRgb}, ${alpha})`;
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

// ── Main loop ─────────────────────────────────────────────────

function _loop() {
  _frame++;

  // Advance angles
  _scanAngle  += 0.004;  // scanner rotates ~1 full turn per 26s
  _arcAngle1  += 0.0018;
  _arcAngle2  -= 0.0008; // opposite direction

  // Ambient events
  _checkIdlePulse();
  _checkFragment();

  // Draw
  _ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  _drawTicks();
  _drawArcs();
  _drawScanner();
  _drawPulses();
  _drawFragments();
  _drawCardinalLabels();

  _rafId = requestAnimationFrame(_loop);
}

// ── Draw: tick marks ──────────────────────────────────────────

function _drawTicks() {
  const count = 60;
  const majorEvery = 5;

  _ctx.save();
  for (let i = 0; i < count; i++) {
    const angle   = (TWO_PI / count) * i - HALF_PI;
    const isMajor = i % majorEvery === 0;
    const len     = isMajor ? 7 : 3.5;
    const alpha   = isMajor ? 0.28 : 0.12;

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
  _ctx.save();
  _ctx.lineWidth = 1;

  // Inner fast arcs — two 100° segments, opposite each other
  const arc1Start = _arcAngle1;
  const arc1Span  = (100 / 180) * Math.PI;
  const gap       = (12 / 180) * Math.PI;

  _ctx.strokeStyle = _rgba(0.38);
  _ctx.lineWidth   = 1.2;

  for (let i = 0; i < 2; i++) {
    const offset = i * Math.PI; // 180° apart
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ARC_INNER, arc1Start + offset + gap, arc1Start + offset + arc1Span - gap);
    _ctx.stroke();
  }

  // Outer slow arc — one 170° segment
  _ctx.strokeStyle = _rgba(0.18);
  _ctx.lineWidth   = 0.8;
  _ctx.beginPath();
  _ctx.arc(CX, CY, R_ARC_OUTER, _arcAngle2, _arcAngle2 + (170 / 180) * Math.PI);
  _ctx.stroke();

  // Small accent dots at arc ends
  _ctx.fillStyle = _rgba(0.5);
  const dotAngle = arc1Start + gap;
  _ctx.beginPath();
  _ctx.arc(
    CX + Math.cos(dotAngle) * R_ARC_INNER,
    CY + Math.sin(dotAngle) * R_ARC_INNER,
    1.8, 0, TWO_PI
  );
  _ctx.fill();
  _ctx.beginPath();
  _ctx.arc(
    CX + Math.cos(dotAngle + Math.PI) * R_ARC_INNER,
    CY + Math.sin(dotAngle + Math.PI) * R_ARC_INNER,
    1.8, 0, TWO_PI
  );
  _ctx.fill();

  _ctx.restore();
}

// ── Draw: scanner beam ────────────────────────────────────────

function _drawScanner() {
  _ctx.save();

  const endX = CX + Math.cos(_scanAngle) * R_SCANNER;
  const endY = CY + Math.sin(_scanAngle) * R_SCANNER;

  // Beam — gradient from center outward
  const grad = _ctx.createLinearGradient(CX, CY, endX, endY);
  grad.addColorStop(0,    _rgba(0));
  grad.addColorStop(0.4,  _rgba(0.06));
  grad.addColorStop(0.85, _rgba(0.22));
  grad.addColorStop(1,    _rgba(0.32));

  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.lineTo(endX, endY);
  _ctx.strokeStyle = grad;
  _ctx.lineWidth   = 1.5;
  _ctx.stroke();

  // Bright tip
  _ctx.beginPath();
  _ctx.arc(endX, endY, 2, 0, TWO_PI);
  _ctx.fillStyle = _rgba(0.55);
  _ctx.fill();

  // Trailing sweep (faint cone behind beam)
  const trailAngle = 0.18; // radians behind beam
  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.arc(CX, CY, R_SCANNER, _scanAngle - trailAngle, _scanAngle, false);
  _ctx.closePath();
  const sweepGrad = _ctx.createRadialGradient(CX, CY, 40, CX, CY, R_SCANNER);
  sweepGrad.addColorStop(0, _rgba(0));
  sweepGrad.addColorStop(1, _rgba(0.04));
  _ctx.fillStyle = sweepGrad;
  _ctx.fill();

  _ctx.restore();
}

// ── Draw: pulse rings ─────────────────────────────────────────

function _spawnPulse() {
  _pulses.push({ r: R_PULSE_START, born: Date.now() });
}

function _drawPulses() {
  const now      = Date.now();
  const DURATION = 2200; // ms

  for (let i = _pulses.length - 1; i >= 0; i--) {
    const p    = _pulses[i];
    const age  = now - p.born;
    if (age > DURATION) { _pulses.splice(i, 1); continue; }

    const t   = age / DURATION;               // 0 → 1
    const r   = R_PULSE_START + (R_PULSE_END - R_PULSE_START) * _easeOut(t);
    const alpha = (1 - t) * 0.45;

    _ctx.save();
    _ctx.beginPath();
    _ctx.arc(CX, CY, r, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = 1;
    _ctx.stroke();
    _ctx.restore();
  }
}

// ── Draw: data fragments ──────────────────────────────────────

function _checkFragment() {
  if (Date.now() < _nextFragment) return;
  _nextFragment = Date.now() + _randMs(14000, 28000);

  const angle  = Math.random() * TWO_PI;
  const dist   = R_LABELS + 10 + Math.random() * 20;
  _fragments.push({
    text:  FRAGMENT_POOL[Math.floor(Math.random() * FRAGMENT_POOL.length)],
    x:     CX + Math.cos(angle) * dist,
    y:     CY + Math.sin(angle) * dist,
    born:  Date.now(),
    life:  1800 + Math.random() * 800,
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

    const t = age / f.life;
    // Fade in quickly, hold, fade out
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
    { angle: -HALF_PI,       align: 'center', label: `${_noteCount} NOTES` },
    { angle:  0,             align: 'left',   label: `${_taskPending} PENDING` },
    { angle:  HALF_PI,       align: 'center', label: _getDateLabel() },
    { angle:  Math.PI,       align: 'right',  label: _getUptimeLabel() },
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

// ── Ambient idle pulse ────────────────────────────────────────

function _checkIdlePulse() {
  if (Date.now() < _nextIdlePulse) return;
  _nextIdlePulse = Date.now() + _randMs(20000, 40000);
  _spawnPulse();
  pulseOrb();
}

// ── System bar (DOM) ──────────────────────────────────────────

function _updateSystemBar() {
  const notesEl  = document.getElementById('sys-notes');
  const tasksEl  = document.getElementById('sys-tasks');
  const uptimeEl = document.getElementById('sys-uptime');

  if (notesEl)  notesEl.textContent  = `${_noteCount} NOTES`;
  if (tasksEl)  tasksEl.textContent  = `${_taskPending} PENDING`;
  if (uptimeEl) uptimeEl.textContent = `UPTIME ${_getUptimeLabel()}`;
}

// ── Greeting (DOM) ────────────────────────────────────────────

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
  const s = Math.floor((Date.now() - _sessionStart) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function _getDateLabel() {
  return new Date().toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
  }).toUpperCase();
}

function _easeOut(t) {
  return 1 - Math.pow(1 - t, 2.5);
}

function _randMs(min, max) {
  return min + Math.random() * (max - min);
}
