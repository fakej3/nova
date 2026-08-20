/**
 * NOVA Clock
 * Real-time clock and date display. Updates every second.
 */

const DAYS   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let _timeEl = null;
let _dateEl = null;
let _interval = null;

export function initClock() {
  _timeEl = document.getElementById('clock-time');
  _dateEl = document.getElementById('clock-date');
  _tick();
  _interval = setInterval(_tick, 1000);
}

function _tick() {
  const now  = new Date();
  const h    = String(now.getHours()).padStart(2, '0');
  const m    = String(now.getMinutes()).padStart(2, '0');
  const s    = String(now.getSeconds()).padStart(2, '0');
  const day  = DAYS[now.getDay()];
  const date = String(now.getDate()).padStart(2, '0');
  const mon  = MONTHS[now.getMonth()];
  const year = now.getFullYear();

  if (_timeEl) _timeEl.textContent = `${h}:${m}:${s}`;
  if (_dateEl) _dateEl.textContent = `${day}, ${date} ${mon} ${year}`;
}
