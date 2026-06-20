/**
 * NOVA HUD System
 * Canvas-drawn orbital HUD around the orb + screen-level ambient elements.
 *
 * Phase 2.7: state-aware params, energy arcs, micro-events, mouse glow
 * Phase 3.0 additions:
 *   - Memory constellation (Phase C): real memory count → node ring
 *   - Orbital satellites (Phase F): 4 tiny satellites with trails
 *   - Awareness integration (Phase A/D): idle/time modifiers on all animation
 *   - Enhanced micro-events (Phase E): 6 event types, 20–90s range
 */

import { DB }              from '../core/db.js';
import { Bus, EVENTS }     from '../core/bus.js';
import { pulseOrb }        from './orb.js';
import { State }           from '../core/state.js';
import { getAwareness }    from './awareness.js';

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

const STATE_TARGETS = {
  idle:       { scanSpeed: 0.0040, scanAlpha: 0.22, arcScale: 1.00, tickAlpha: 0.28 },
  listening:  { scanSpeed: 0.0070, scanAlpha: 0.34, arcScale: 1.30, tickAlpha: 0.36 },
  thinking:   { scanSpeed: 0.0165, scanAlpha: 0.52, arcScale: 1.80, tickAlpha: 0.50 },
  responding: { scanSpeed: 0.0120, scanAlpha: 0.42, arcScale: 1.50, tickAlpha: 0.40 },
  success:    { scanSpeed: 0.0022, scanAlpha: 0.12, arcScale: 0.55, tickAlpha: 0.16 },
  error:      { scanSpeed: 0.0085, scanAlpha: 0.30, arcScale: 0.90, tickAlpha: 0.22 },
  offline:    { scanSpeed: 0.0008, scanAlpha: 0.05, arcScale: 0.10, tickAlpha: 0.06 },
};

// ── Energy arc config ─────────────────────────────────────────

const ARC_RATES = {
  idle: 0.0022, listening: 0.010, thinking: 0.038,
  responding: 0.028, success: 0, error: 0.018, offline: 0,
};

const ARC_CONFIGS = {
  idle:       { minSpan:0.25, maxSpan:1.0,  bow:0.84, minLife:700,  maxLife:1600, w:0.7,  peakAlpha:0.28 },
  listening:  { minSpan:0.4,  maxSpan:1.5,  bow:0.88, minLife:500,  maxLife:1200, w:0.9,  peakAlpha:0.38 },
  thinking:   { minSpan:0.3,  maxSpan:2.2,  bow:0.78, minLife:250,  maxLife:900,  w:1.0,  peakAlpha:0.48 },
  responding: { minSpan:0.6,  maxSpan:2.4,  bow:0.72, minLife:180,  maxLife:650,  w:1.15, peakAlpha:0.52 },
  error:      { minSpan:0.12, maxSpan:0.65, bow:1.18, minLife:120,  maxLife:450,  w:0.8,  peakAlpha:0.34 },
};

// ── Module state ──────────────────────────────────────────────

let _canvas  = null;
let _ctx     = null;
let _dpr     = 1;
let _rafId   = null;
let _frame   = 0;
let _isMobile = false;

let _color    = '#00d4ff';
let _colorRgb = '0, 212, 255';

let _scanAngle = -HALF_PI;
let _arcAngle1 =  0;
let _arcAngle2 =  Math.PI;

let _noteCount    = 0;
let _taskPending  = 0;
let _memoryCount  = 0;
let _sessionStart = Date.now();

// Live interpolated state params
let _live = { ...STATE_TARGETS.idle };

// Awareness modifiers (updated each frame from getAwareness())
let _awIdleMul = 1.0;
let _awTimeMod = 1.0;
let _awEnergy  = 1.0;

// Pulse rings
const _pulses = [];
let _nextIdlePulse = Date.now() + _randMs(18000, 35000);

// Data fragment flashes
const _fragments = [];
let _nextFragment = Date.now() + _randMs(12000, 25000);

const FRAGMENT_POOL = [
  'SYS:OK','MEM:IDLE','CTX:READY','IDX:0','SYNC:—',
  '0x00FF','INT:0','PROC:—','NET:OK','BUF:CLR',
];

// Energy arcs
const _energyArcs = [];

// Micro-events
let _microScanBoost = null;
let _nextMicroEvent = Date.now() + _randMs(22000, 55000);

// Mouse influence
let _mouseNX = 0;
let _mouseNY = 0;

// ── Memory constellation (Phase C) ───────────────────────────

const MAX_CON_NODES = 16;
const _conNodes     = [];
let   _conBuilt     = false;

// ── Orbital satellites (Phase F) ─────────────────────────────
// 4 satellites mapping to notes, tasks, memories, events

const _satellites = [
  { angle: 0,              r: 192, speed:  0.00028, size: 2.0, alpha: 0.42 },
  { angle: Math.PI * 0.5,  r: 201, speed: -0.00019, size: 1.7, alpha: 0.36 },
  { angle: Math.PI,        r: 186, speed:  0.00035, size: 1.5, alpha: 0.33 },
  { angle: Math.PI * 1.5,  r: 209, speed:  0.00015, size: 1.4, alpha: 0.28 },
];

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
  Bus.on(EVENTS.NOTE_DELETED,   () => { _noteCount = Math.max(0, _noteCount - 1);   _updateSystemBar(); });
  Bus.on(EVENTS.TASK_CREATED,   () => { _taskPending++;  _updateSystemBar(); });
  Bus.on(EVENTS.TASK_COMPLETED, () => { _taskPending = Math.max(0, _taskPending - 1); _updateSystemBar(); _spawnPulse(); });
  Bus.on(EVENTS.TASK_DELETED,   () => { _taskPending = Math.max(0, _taskPending - 1); _updateSystemBar(); });

  // Memory constellation updates
  Bus.on(EVENTS.MEMORY_CREATED, () => { _memoryCount++; _buildConstellation(); });
  Bus.on(EVENTS.MEMORY_DELETED, () => { _memoryCount = Math.max(0, _memoryCount - 1); _buildConstellation(); });

  Bus.on(EVENTS.NOTE_CREATED,  _spawnPulse);
  Bus.on(EVENTS.TASK_CREATED,  _spawnPulse);

  // Orb state reactions
  Bus.on(EVENTS.ORB_STATE_CHANGED, ({ state }) => {
    if (state === 'success') {
      _spawnPulse(); setTimeout(_spawnPulse, 260); setTimeout(_spawnPulse, 520);
      pulseOrb();
    }
    if (state === 'error') _spawnPulse();
  });

  _buildConstellation();

  _updateSystemBar();
  _updateGreeting();
  setInterval(_updateSystemBar, 1000);
  setInterval(_updateGreeting, 60000);

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
    const [notes, pending, memCount] = await Promise.all([
      DB.notes.getAll(),
      DB.tasks.getByStatus('pending'),
      DB.memories.count(),
    ]);
    _noteCount    = notes.length;
    _taskPending  = pending.length;
    _memoryCount  = memCount ?? 0;
  } catch { /* non-fatal */ }
}

// ── State param interpolation ─────────────────────────────────

function _updateLiveParams() {
  const state  = State.get('orbState') || 'idle';
  const target = STATE_TARGETS[state] ?? STATE_TARGETS.idle;
  const L = 0.035;
  for (const k of Object.keys(_live)) {
    if (k in target) _live[k] += (target[k] - _live[k]) * L;
  }

  // Awareness modifiers — applied at draw time, not stored in _live
  const ora  = getAwareness();
  _awIdleMul = ora.idleLevel === 2 ? 0.42 : ora.idleLevel === 1 ? 0.70 : 1.0;
  _awTimeMod = ora.timeModifier;
  _awEnergy  = 1 + ora.energy * 0.28;
}

// ── Main loop ─────────────────────────────────────────────────

function _loop() {
  if (!_canvas || !_ctx) return;

  _frame++;
  _updateLiveParams();

  // Scan speed with micro-boost overlay
  let scanDelta = _live.scanSpeed;
  if (_microScanBoost) {
    const age = Date.now() - _microScanBoost.born;
    if (age < _microScanBoost.duration) {
      const boost = Math.sin((age / _microScanBoost.duration) * Math.PI);
      scanDelta  *= 1 + boost * (_microScanBoost.multiplier - 1);
    } else {
      _microScanBoost = null;
    }
  }

  // Apply awareness idle/time multipliers to all rotation speeds
  const speedMod = _awIdleMul * _awTimeMod;
  _scanAngle += scanDelta * speedMod;
  _arcAngle1 += 0.0018  * speedMod;
  _arcAngle2 -= 0.0008  * speedMod;

  // Satellite angles advance every frame regardless (slow enough)
  for (const sat of _satellites) sat.angle += sat.speed * speedMod;

  _checkIdlePulse();
  _checkFragment();
  _checkArcSpawn();
  _checkMicroEvent();

  _ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  _drawMouseGlow();
  _drawTicks();
  _drawArcs();
  if (!_isMobile) _drawConstellation();
  _drawSatellites();
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
  const gx   = CX + _mouseNX * 55;
  const gy   = CY + _mouseNY * 55;
  const grad = _ctx.createRadialGradient(gx, gy, 8, CX, CY, 215);
  grad.addColorStop(0,   _rgba(0.08 * _awTimeMod));
  grad.addColorStop(0.5, _rgba(0.025 * _awTimeMod));
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
    const angle   = (TWO_PI / count) * i - HALF_PI;
    const isMajor = i % majorEvery === 0;
    const len     = isMajor ? 7 : 3.5;
    const alpha   = (isMajor ? _live.tickAlpha : _live.tickAlpha * 0.43) * _awTimeMod * _awIdleMul;

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
  const s = _live.arcScale * _awTimeMod * _awIdleMul;
  _ctx.save();

  const arc1Start = _arcAngle1;
  const arc1Span  = (100 / 180) * Math.PI;
  const gap       = (12 / 180)  * Math.PI;

  _ctx.strokeStyle = _rgba(0.38 * s);
  _ctx.lineWidth   = 1.2;
  for (let i = 0; i < 2; i++) {
    _ctx.beginPath();
    _ctx.arc(CX, CY, R_ARC_INNER, arc1Start + i * Math.PI + gap, arc1Start + i * Math.PI + arc1Span - gap);
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
  const sa   = _live.scanAlpha * _awTimeMod * _awIdleMul;

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

  const sweepGrad = _ctx.createRadialGradient(CX, CY, 40, CX, CY, R_SCANNER);
  sweepGrad.addColorStop(0, _rgba(0));
  sweepGrad.addColorStop(1, _rgba(sa * 0.14));
  _ctx.beginPath();
  _ctx.moveTo(CX, CY);
  _ctx.arc(CX, CY, R_SCANNER, _scanAngle - 0.18, _scanAngle, false);
  _ctx.closePath();
  _ctx.fillStyle = sweepGrad;
  _ctx.fill();

  _ctx.restore();
}

// ── Draw: pulse rings ─────────────────────────────────────────

function _spawnPulse(opts) {
  _pulses.push({ r: opts?.r ?? R_PULSE_START, born: Date.now(), fast: opts?.fast ?? false });
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
    const alpha = (1 - t) * (p.fast ? 0.38 : 0.45) * _awTimeMod;
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
    x:   CX + Math.cos(angle) * dist,
    y:   CY + Math.sin(angle) * dist,
    born: Date.now(),
    life: 1800 + Math.random() * 800,
  });
}

function _drawFragments() {
  const now = Date.now();
  _ctx.save();
  _ctx.font         = '9px "SF Mono","Fira Code","Consolas",monospace';
  _ctx.textAlign    = 'center';
  _ctx.textBaseline = 'middle';
  for (let i = _fragments.length - 1; i >= 0; i--) {
    const f   = _fragments[i];
    const age = now - f.born;
    if (age > f.life) { _fragments.splice(i, 1); continue; }
    const t     = age / f.life;
    const alpha = (t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1) * 0.35 * _awTimeMod;
    _ctx.fillStyle = _rgba(alpha);
    _ctx.fillText(f.text, f.x, f.y);
  }
  _ctx.restore();
}

// ── Draw: cardinal labels ─────────────────────────────────────

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
    _ctx.textAlign    = align;
    _ctx.fillStyle    = _rgba(0.38 * _awTimeMod);
    _ctx.letterSpacing = '0.1em';
    _ctx.fillText(label, CX + Math.cos(angle) * R_LABELS, CY + Math.sin(angle) * R_LABELS);
  }
  _ctx.restore();
}

// ── Memory constellation (Phase C) ───────────────────────────

function _buildConstellation() {
  _conNodes.length = 0;
  const count = Math.min(_memoryCount, MAX_CON_NODES);
  if (count === 0) { _conBuilt = false; return; }

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TWO_PI + (Math.random() - 0.5) * 0.5;
    const r     = 186 + Math.random() * 28;
    _conNodes.push({
      angle,
      r,
      driftSpeed: (Math.random() - 0.5) * 0.00022,
      size:       1.1 + Math.random() * 0.9,
      alpha:      0.20 + Math.random() * 0.20,
      connections: [],
    });
  }

  // Connect nearby nodes (angular proximity)
  for (let i = 0; i < _conNodes.length; i++) {
    for (let j = i + 1; j < _conNodes.length; j++) {
      const diff = Math.abs(_conNodes[i].angle - _conNodes[j].angle);
      const minD = Math.min(diff, TWO_PI - diff);
      if (minD < 0.52 && _conNodes[i].connections.length < 2) {
        _conNodes[i].connections.push(j);
      }
    }
  }
  _conBuilt = true;
}

function _drawConstellation() {
  if (!_conBuilt || _conNodes.length === 0) return;
  const timeFade = _awTimeMod * _awIdleMul;
  _ctx.save();

  // Drift nodes
  for (const n of _conNodes) n.angle += n.driftSpeed;

  // Connections
  _ctx.lineWidth = 0.5;
  for (let i = 0; i < _conNodes.length; i++) {
    const n  = _conNodes[i];
    const nx = CX + Math.cos(n.angle) * n.r;
    const ny = CY + Math.sin(n.angle) * n.r;
    for (const j of n.connections) {
      const m  = _conNodes[j];
      const mx = CX + Math.cos(m.angle) * m.r;
      const my = CY + Math.sin(m.angle) * m.r;
      _ctx.beginPath();
      _ctx.moveTo(nx, ny);
      _ctx.lineTo(mx, my);
      _ctx.strokeStyle = _rgba(0.065 * timeFade);
      _ctx.stroke();
    }
  }

  // Nodes
  for (const n of _conNodes) {
    const nx = CX + Math.cos(n.angle) * n.r;
    const ny = CY + Math.sin(n.angle) * n.r;
    const a  = n.alpha * timeFade;
    // Soft halo
    const glow = _ctx.createRadialGradient(nx, ny, 0, nx, ny, n.size * 3.5);
    glow.addColorStop(0, _rgba(a));
    glow.addColorStop(1, _rgba(0));
    _ctx.fillStyle = glow;
    _ctx.beginPath();
    _ctx.arc(nx, ny, n.size * 3.5, 0, TWO_PI);
    _ctx.fill();
    // Core point
    _ctx.beginPath();
    _ctx.arc(nx, ny, n.size, 0, TWO_PI);
    _ctx.fillStyle = _rgba(a * 2);
    _ctx.fill();
  }
  _ctx.restore();
}

// ── Orbital satellites (Phase F) ─────────────────────────────

function _drawSatellites() {
  const timeFade = _awTimeMod * _awIdleMul;
  _ctx.save();
  _ctx.lineCap = 'round';

  for (const sat of _satellites) {
    const sx = CX + Math.cos(sat.angle) * sat.r;
    const sy = CY + Math.sin(sat.angle) * sat.r;

    // Trailing arc (short segment behind satellite)
    const trailSpan = Math.abs(sat.speed) * 22;
    const trailDir  = sat.speed > 0 ? -1 : 1;
    const t0 = sat.angle + trailDir * trailSpan;
    const t1 = sat.angle;

    const grad = _ctx.createLinearGradient(
      CX + Math.cos(t0) * sat.r, CY + Math.sin(t0) * sat.r,
      sx, sy,
    );
    grad.addColorStop(0, _rgba(0));
    grad.addColorStop(1, _rgba(sat.alpha * 0.35 * timeFade));
    _ctx.beginPath();
    _ctx.arc(CX, CY, sat.r, t0, t1, sat.speed < 0);
    _ctx.strokeStyle = grad;
    _ctx.lineWidth   = sat.size * 0.65;
    _ctx.stroke();

    // Satellite dot
    _ctx.beginPath();
    _ctx.arc(sx, sy, sat.size, 0, TWO_PI);
    _ctx.fillStyle = _rgba(sat.alpha * timeFade);
    _ctx.fill();

    // Micro ring
    _ctx.beginPath();
    _ctx.arc(sx, sy, sat.size * 2.2, 0, TWO_PI);
    _ctx.strokeStyle = _rgba(sat.alpha * 0.22 * timeFade);
    _ctx.lineWidth   = 0.5;
    _ctx.stroke();
  }
  _ctx.restore();
}

// ── Energy arcs ───────────────────────────────────────────────

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
    bow:       cfg.bow + (Math.random() - 0.5) * 0.15,
    r:         R_ARC_INNER + (Math.random() - 0.5) * 18,
    life:      cfg.minLife + Math.random() * (cfg.maxLife - cfg.minLife),
    w:         cfg.w,
    peakAlpha: cfg.peakAlpha,
    born:      Date.now(),
    broken:    state === 'error',
  });
  if (_energyArcs.length > 9) _energyArcs.splice(0, 1);
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
    const t   = age / arc.life;
    const env = t < 0.12 ? t / 0.12 : t > 0.72 ? (1 - t) / 0.28 : 1;
    const alpha = arc.peakAlpha * env * _awTimeMod * _awIdleMul;
    _ctx.strokeStyle = _rgba(alpha);
    _ctx.lineWidth   = arc.w;
    if (arc.broken) {
      const mid = (arc.startAngle + arc.endAngle) / 2;
      _drawArcBezier(arc.startAngle, mid - 0.12, arc.r, arc.bow);
      _drawArcBezier(mid + 0.12, arc.endAngle,   arc.r, arc.bow);
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
  _ctx.quadraticCurveTo(CX + Math.cos(mid) * r * bow, CY + Math.sin(mid) * r * bow, x2, y2);
  _ctx.stroke();
}

// ── Ambient micro-events (Phase E) ───────────────────────────
// 6 types, 20–90s intervals

function _checkMicroEvent() {
  if (Date.now() < _nextMicroEvent) return;
  _nextMicroEvent = Date.now() + _randMs(20000, 90000);

  const state = State.get('orbState') || 'idle';
  if (state === 'offline' || state === 'thinking' || state === 'responding') return;

  const roll = Math.random();

  if (roll < 0.22) {
    // Scanner sweep burst
    _microScanBoost = { born: Date.now(), duration: 2200, multiplier: 3.5 };

  } else if (roll < 0.42) {
    // Triple energy ripple
    _spawnPulse(); setTimeout(_spawnPulse, 230); setTimeout(_spawnPulse, 460);

  } else if (roll < 0.56) {
    // Core burst — tight inner pulses
    for (let i = 0; i < 4; i++) {
      setTimeout(() => _pulses.push({ r: 52, born: Date.now(), fast: true }), i * 115);
    }

  } else if (roll < 0.68) {
    // Arc burst — multiple energy arcs spawn simultaneously
    const state2 = State.get('orbState') || 'idle';
    for (let i = 0; i < 5; i++) _spawnEnergyArc(state2 === 'offline' ? 'idle' : state2);

  } else if (roll < 0.82) {
    // Ring recalibration — arc angles offset
    _arcAngle1 += (Math.random() - 0.5) * 0.9;
    _arcAngle2 += (Math.random() - 0.5) * 0.9;

  } else {
    // Core resonance — big single deep pulse from center
    _pulses.push({ r: 30, born: Date.now(), fast: false });
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
  const sal  = h < 5 ? 'WORKING LATE' : h < 12 ? 'GOOD MORNING' : h < 17 ? 'GOOD AFTERNOON' : h < 21 ? 'GOOD EVENING' : 'GOOD NIGHT';
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
