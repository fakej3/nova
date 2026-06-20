/**
 * NOVA Particle System
 * Canvas-based ambient particles. Lightweight — no physics engine.
 * Respects prefers-reduced-motion: shows static dots only.
 * Listens to theme:changed to re-read particle color.
 */

import { Bus, EVENTS } from '../core/bus.js';

const MAX_PARTICLES = 55;
const BASE_SPEED    = 0.25;

let _canvas  = null;
let _ctx     = null;
let _rafId   = null;
let _particles = [];
let _color   = '#00d4ff';
let _reduced = false;

export function initParticles() {
  _canvas = document.getElementById('particles-canvas');
  if (!_canvas) return;
  _ctx = _canvas.getContext('2d');

  _reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  _resize();
  window.addEventListener('resize', _resize);

  _readColor();
  Bus.on(EVENTS.THEME_CHANGED, () => {
    // Color must be read after the theme CSS is applied (one frame later)
    requestAnimationFrame(_readColor);
  });

  _spawnParticles();

  if (!_reduced) {
    _loop();
  } else {
    _drawStatic();
  }
}

function _resize() {
  if (!_canvas) return;
  _canvas.width  = window.innerWidth;
  _canvas.height = window.innerHeight;
  if (_reduced) _drawStatic();
}

function _readColor() {
  const style = getComputedStyle(document.documentElement);
  _color = style.getPropertyValue('--particle-color').trim() || '#00d4ff';
  _particles.forEach((p) => { p.color = _color; });
}

function _spawnParticles() {
  _particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    _particles.push(_createParticle(true));
  }
}

function _createParticle(randomY = false) {
  const size = Math.random() * 1.5 + 0.5;
  return {
    x:       Math.random() * window.innerWidth,
    y:       randomY ? Math.random() * window.innerHeight : window.innerHeight + 10,
    size,
    speedX:  (Math.random() - 0.5) * BASE_SPEED,
    speedY:  -(Math.random() * BASE_SPEED + 0.1),
    opacity: Math.random() * 0.5 + 0.1,
    opDir:   Math.random() > 0.5 ? 1 : -1,
    opSpeed: Math.random() * 0.003 + 0.001,
    color:   _color,
  };
}

function _loop() {
  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

  _particles.forEach((p, i) => {
    // Move
    p.x += p.speedX;
    p.y += p.speedY;

    // Fade
    p.opacity += p.opSpeed * p.opDir;
    if (p.opacity >= 0.6) { p.opDir = -1; }
    if (p.opacity <= 0.05) { p.opDir = 1; }

    // Recycle if off-screen
    if (p.y < -10 || p.x < -10 || p.x > _canvas.width + 10) {
      _particles[i] = _createParticle(false);
      return;
    }

    // Draw
    _ctx.beginPath();
    _ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    _ctx.fillStyle = _hexToRgba(p.color, p.opacity);
    _ctx.fill();
  });

  _rafId = requestAnimationFrame(_loop);
}

function _drawStatic() {
  if (!_ctx) return;
  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
  _particles.forEach((p) => {
    _ctx.beginPath();
    _ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    _ctx.fillStyle = _hexToRgba(p.color, 0.25);
    _ctx.fill();
  });
}

function _hexToRgba(hex, alpha) {
  // Handle 3-char hex, 6-char hex, and rgb() values
  if (!hex || typeof hex !== 'string') return `rgba(200,200,200,${alpha})`;
  const h = hex.trim();
  if (h.startsWith('rgb')) {
    // Already rgb/rgba — just adjust alpha
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
