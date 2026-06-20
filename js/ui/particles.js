/**
 * NOVA Particle System
 * Canvas-based ambient particles with varied motion, depth layers,
 * and occasional shooting particles.
 * Respects prefers-reduced-motion.
 */

import { Bus, EVENTS } from '../core/bus.js';

const PARTICLE_COUNT  = 70;
const SHOOTING_CHANCE = 0.0008; // per frame, per particle check

let _canvas    = null;
let _ctx       = null;
let _rafId     = null;
let _particles = [];
let _color     = '#00d4ff';
let _reduced   = false;
let _w         = 0;
let _h         = 0;

export function initParticles() {
  _canvas = document.getElementById('particles-canvas');
  if (!_canvas) return;
  _ctx = _canvas.getContext('2d');

  _reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  _resize();
  window.addEventListener('resize', _resize);

  _readColor();
  Bus.on(EVENTS.THEME_CHANGED, () => requestAnimationFrame(_readColor));

  _spawnAll();

  if (_reduced) {
    _drawStatic();
  } else {
    _loop();
  }
}

function _resize() {
  if (!_canvas) return;
  _w = _canvas.width  = window.innerWidth;
  _h = _canvas.height = window.innerHeight;
  if (_reduced) _drawStatic();
}

function _readColor() {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--particle-color').trim();
  _color = v || '#00d4ff';
  _particles.forEach(p => { p.color = _color; });
}

// ── Particle factory ───────────────────────────────────────────

function _createParticle(randomPos = false) {
  const layer = Math.random();                 // 0=far, 1=near
  const size  = layer * 1.6 + 0.3;            // 0.3–1.9px (depth illusion)
  const speed = layer * 0.22 + 0.05;          // far = slow, near = faster

  // Varied motion directions: mostly upward drift with gentle horizontal wander
  const angle  = -Math.PI / 2 + (Math.random() - 0.5) * 1.1;

  return {
    x:        randomPos ? Math.random() * _w : Math.random() * _w,
    y:        randomPos ? Math.random() * _h : _h + size + 2,
    vx:       Math.cos(angle) * speed,
    vy:       Math.sin(angle) * speed,
    size,
    layer,
    opacity:  Math.random() * 0.45 + 0.05,
    opDir:    Math.random() > 0.5 ? 1 : -1,
    opSpeed:  Math.random() * 0.004 + 0.0008,
    opMax:    layer * 0.45 + 0.12,            // near particles brighter
    color:    _color,
    shooting: false,
    shootLife: 0,
  };
}

function _createShootingParticle() {
  // Shoots across at a shallow diagonal angle
  const fromLeft = Math.random() > 0.5;
  return {
    x:        fromLeft ? -20 : _w + 20,
    y:        Math.random() * _h * 0.6 + _h * 0.1,
    vx:       (fromLeft ? 1 : -1) * (2.5 + Math.random() * 2),
    vy:       (Math.random() - 0.5) * 0.8,
    size:     1.2,
    layer:    1,
    opacity:  0.8,
    opDir:    -1,
    opSpeed:  0.012,
    opMax:    0.8,
    color:    _color,
    shooting: true,
    shootLife: 0,
    tailLength: 60 + Math.random() * 60,
  };
}

function _spawnAll() {
  _particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    _particles.push(_createParticle(true));
  }
}

// ── Animation loop ─────────────────────────────────────────────

function _loop() {
  _ctx.clearRect(0, 0, _w, _h);

  for (let i = 0; i < _particles.length; i++) {
    const p = _particles[i];

    // Move
    p.x += p.vx;
    p.y += p.vy;

    // Subtle horizontal wander (only on regular particles)
    if (!p.shooting) {
      p.vx += (Math.random() - 0.5) * 0.003;
      // Dampen drift to avoid runaway horizontal speed
      p.vx *= 0.998;
    }

    // Opacity breathe
    p.opacity += p.opSpeed * p.opDir;
    if (p.opacity >= p.opMax)  { p.opDir = -1; }
    if (p.opacity <= 0.03)     { p.opDir =  1; }

    // Recycle off-screen
    const offScreen =
      p.y < -20 ||
      p.x < -60 ||
      p.x > _w + 60 ||
      (p.shooting && p.opacity <= 0.01);

    if (offScreen) {
      // Occasionally spawn a shooting particle instead
      if (!p.shooting && Math.random() < SHOOTING_CHANCE * 60) {
        _particles[i] = _createShootingParticle();
      } else {
        _particles[i] = _createParticle(false);
      }
      continue;
    }

    // Draw
    if (p.shooting) {
      _drawShootingParticle(p);
    } else {
      _drawDot(p);
    }
  }

  _rafId = requestAnimationFrame(_loop);
}

function _drawDot(p) {
  _ctx.beginPath();
  _ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  _ctx.fillStyle = _toRgba(p.color, p.opacity * p.layer * 0.8 + p.opacity * 0.2);
  _ctx.fill();
}

function _drawShootingParticle(p) {
  // Draw a glowing dot with a trailing line
  const tailX = p.x - p.vx * p.tailLength;
  const tailY = p.y - p.vy * p.tailLength;

  const grad = _ctx.createLinearGradient(tailX, tailY, p.x, p.y);
  grad.addColorStop(0, _toRgba(p.color, 0));
  grad.addColorStop(1, _toRgba(p.color, p.opacity));

  _ctx.beginPath();
  _ctx.moveTo(tailX, tailY);
  _ctx.lineTo(p.x, p.y);
  _ctx.strokeStyle = grad;
  _ctx.lineWidth = p.size * 0.8;
  _ctx.stroke();

  // Bright head
  _ctx.beginPath();
  _ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  _ctx.fillStyle = _toRgba(p.color, p.opacity);
  _ctx.fill();
}

function _drawStatic() {
  if (!_ctx) return;
  _ctx.clearRect(0, 0, _w, _h);
  _particles.forEach(p => {
    _ctx.beginPath();
    _ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    _ctx.fillStyle = _toRgba(p.color, 0.18 * p.layer);
    _ctx.fill();
  });
}

// ── Helpers ────────────────────────────────────────────────────

function _toRgba(hex, alpha) {
  if (!hex || typeof hex !== 'string') return `rgba(200,200,200,${alpha})`;
  const h = hex.trim();

  if (h.startsWith('rgb')) {
    const nums = h.match(/[\d.]+/g);
    if (nums && nums.length >= 3) {
      return `rgba(${nums[0]},${nums[1]},${nums[2]},${alpha})`;
    }
  }

  let r = 0, g = 0, b = 0;
  if (h.length === 4) {
    r = parseInt(h[1] + h[1], 16);
    g = parseInt(h[2] + h[2], 16);
    b = parseInt(h[3] + h[3], 16);
  } else if (h.length >= 7) {
    r = parseInt(h.slice(1, 3), 16);
    g = parseInt(h.slice(3, 5), 16);
    b = parseInt(h.slice(5, 7), 16);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}
