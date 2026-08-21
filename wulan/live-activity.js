const scene = document.querySelector('.scene');
const worldSpace = document.querySelector('#world-space');

const state = { world: null, previous: new Map(), events: [], timer: null };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function ensureLayer() {
  if (!scene || document.querySelector('.live-activity-layer')) return;
  const layer = document.createElement('div');
  layer.className = 'live-activity-layer';
  layer.innerHTML = '<div class="live-activity-head"><span>LIVE WORLD</span><b id="live-activity-status">SYNC</b></div><div class="live-activity-events" id="live-activity-events"></div><svg class="live-activity-lines" aria-hidden="true"></svg>';
  scene.appendChild(layer);
}

function entityName(id) {
  return state.world?.entities?.find((e) => e.id === id)?.name || id;
}

function eventLabel(item) {
  const type = String(item.type || '').replaceAll('_', ' ');
  if (item.source && item.target && item.source !== item.target) return `${entityName(item.source)} → ${entityName(item.target)} · ${type}`;
  return `${entityName(item.source || item.capabilityId || 'world')} · ${type}`;
}

function statusClass(status) {
  return status === 'failed' ? 'is-failed' : status === 'degraded' ? 'is-degraded' : 'is-complete';
}

function drawActivityLines() {
  const svg = document.querySelector('.live-activity-lines');
  if (!svg || !worldSpace || !state.events.length) return;
  const sceneRect = scene.getBoundingClientRect();
  const paths = [];
  for (const item of state.events.slice(0, 5)) {
    if (!item.source || !item.target || item.source === item.target) continue;
    const from = worldSpace.querySelector(`[data-entity="${CSS.escape(item.source)}"]`);
    const to = worldSpace.querySelector(`[data-entity="${CSS.escape(item.target)}"]`);
    if (!from || !to) continue;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const x1 = a.left + a.width / 2 - sceneRect.left;
    const y1 = a.top + a.height / 2 - sceneRect.top;
    const x2 = b.left + b.width / 2 - sceneRect.left;
    const y2 = b.top + b.height / 2 - sceneRect.top;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy) || 1;
    const nx = -dy / distance;
    const ny = dx / distance;
    const bend = Math.min(50, distance * .12);
    const cx = (x1 + x2) / 2 + nx * bend;
    const cy = (y1 + y2) / 2 + ny * bend;
    const key = `${item.id || item.type}:${item.source}:${item.target}`;
    paths.push(`<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" class="live-activity-path ${statusClass(item.status)}" data-key="${esc(key)}"><circle r="3" class="live-activity-packet"><animateMotion dur="${1.3 + (paths.length * .22)}s" repeatCount="indefinite" path="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}"/></circle></path>`);
  }
  svg.setAttribute('viewBox', `0 0 ${sceneRect.width} ${sceneRect.height}`);
  svg.innerHTML = paths.join('');
}

function renderEvents() {
  ensureLayer();
  const container = document.querySelector('#live-activity-events');
  if (!container) return;
  const visible = state.events.slice(0, 4);
  container.innerHTML = visible.length ? visible.map((item) => `
    <div class="live-activity-event ${statusClass(item.status)}">
      <i></i><span>${esc(eventLabel(item))}</span><small>${item.latencyMs ? `${item.latencyMs}ms` : esc(item.status || 'active')}</small>
    </div>`).join('') : '<div class="live-activity-empty">No live operations</div>';
  const badge = document.querySelector('#live-activity-status');
  if (badge) badge.textContent = visible.length ? `${visible.length} ACTIVE` : 'IDLE';
  drawActivityLines();
}

function detectNewActivities(world) {
  const next = new Map((world.activities || []).map((item) => [item.id || `${item.type}:${item.at}`, item]));
  for (const [key, item] of next) {
    if (!state.previous.has(key)) state.events.unshift(item);
  }
  state.previous = next;
  state.events = state.events.slice(0, 12);
}

async function sync() {
  try {
    const response = await fetch('/api/world', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`world ${response.status}`);
    const world = await response.json();
    state.world = world;
    detectNewActivities(world);
    // The backend activity records are evidence of actual operations. The UI
    // only animates a packet for an operation that exists in that data.
    renderEvents();
  } catch (error) {
    const badge = document.querySelector('#live-activity-status');
    if (badge) badge.textContent = 'OFFLINE';
  }
}

ensureLayer();
sync();
state.timer = setInterval(sync, 5000);
window.addEventListener('resize', drawActivityLines);
window.addEventListener('scroll', drawActivityLines, true);
setInterval(drawActivityLines, 700);
