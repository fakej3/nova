/**
 * NOVA Starfield — Deep space background
 * Three-depth star layers with slow twinkle.
 * Runs at z-index -1, behind all UI elements.
 */

const TWO_PI = Math.PI * 2;

let _canvas = null;
let _ctx = null;
let _w = 0, _h = 0;
let _t = 0;
let _rafId = null;
let _reduced = false;
let _stars = [];

const LAYERS = [
  { count: 220, sizeMin: 0.3, sizeMax: 0.8,  opMin: 0.04, opMax: 0.18, twSpeed: 0.0005 },
  { count: 70,  sizeMin: 0.7, sizeMax: 1.4,  opMin: 0.10, opMax: 0.35, twSpeed: 0.0008 },
  { count: 14,  sizeMin: 1.1, sizeMax: 1.9,  opMin: 0.25, opMax: 0.65, twSpeed: 0.0014 },
];

function _rnd(a, b) { return a + Math.random() * (b - a); }

function _spawn() {
  _stars = [];
  for (let li = 0; li < LAYERS.length; li++) {
    const L = LAYERS[li];
    for (let i = 0; i < L.count; i++) {
      _stars.push({
        x:      Math.random(),
        y:      Math.random(),
        size:   _rnd(L.sizeMin, L.sizeMax),
        baseOp: _rnd(L.opMin, L.opMax),
        ph:     Math.random() * TWO_PI,
        spd:    L.twSpeed * (0.5 + Math.random()),
        layer:  li,
      });
    }
  }
}

export function initStarfield() {
  _canvas = document.getElementById('starfield-canvas');
  if (!_canvas) return;
  _ctx = _canvas.getContext('2d');
  _reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  _resize();
  window.addEventListener('resize', _resize, { passive: true });
  _spawn();

  if (_reduced) { _drawStatic(); return; }
  _rafId = requestAnimationFrame(_loop);
}

function _resize() {
  if (!_canvas) return;
  _w = _canvas.width  = window.innerWidth;
  _h = _canvas.height = window.innerHeight;
  if (_reduced) _drawStatic();
}

function _loop() {
  _t++;
  _ctx.clearRect(0, 0, _w, _h);
  _drawNebula();
  for (const s of _stars) {
    const op = s.baseOp * (0.5 + 0.5 * Math.sin(_t * s.spd + s.ph));
    _ctx.beginPath();
    _ctx.arc(s.x * _w, s.y * _h, s.size, 0, TWO_PI);
    _ctx.fillStyle = `rgba(255,248,232,${op.toFixed(3)})`;
    _ctx.fill();
  }
  _rafId = requestAnimationFrame(_loop);
}

function _drawNebula() {
  // Two very faint nebula regions — warm and cool
  const g1 = _ctx.createRadialGradient(_w * 0.68, _h * 0.28, 0, _w * 0.68, _h * 0.28, _w * 0.38);
  g1.addColorStop(0,   'rgba(180,130,45,0.018)');
  g1.addColorStop(0.5, 'rgba(140,100,40,0.010)');
  g1.addColorStop(1,   'transparent');
  _ctx.fillStyle = g1;
  _ctx.fillRect(0, 0, _w, _h);

  const g2 = _ctx.createRadialGradient(_w * 0.18, _h * 0.75, 0, _w * 0.18, _h * 0.75, _w * 0.30);
  g2.addColorStop(0,   'rgba(50,70,150,0.016)');
  g2.addColorStop(0.5, 'rgba(35,55,120,0.008)');
  g2.addColorStop(1,   'transparent');
  _ctx.fillStyle = g2;
  _ctx.fillRect(0, 0, _w, _h);
}

function _drawStatic() {
  if (!_ctx) return;
  _ctx.clearRect(0, 0, _w, _h);
  _drawNebula();
  for (const s of _stars) {
    _ctx.beginPath();
    _ctx.arc(s.x * _w, s.y * _h, s.size, 0, TWO_PI);
    _ctx.fillStyle = `rgba(255,248,232,${(s.baseOp * 0.55).toFixed(3)})`;
    _ctx.fill();
  }
}
