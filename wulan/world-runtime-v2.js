const $ = (selector) => document.querySelector(selector);

const worldSpace = $('#world-space');
const agentLabel = $('#agents-label');
const worldLabel = $('#memory-label');

// The visual world is a projection of the live world model. It deliberately
// does not invent a second hard-coded graph: entities and relations come from
// /api/world, while the client supplies only layout, camera and interaction.
const palette = {
  system: '#79e8ff',
  agent: '#aa8cff',
  project: '#70e5b4',
  integration: '#9aaec5',
  'ai-provider': '#e8c76f',
};

const state = {
  world: null,
  selected: null,
  hovered: null,
  scale: 1,
  panX: 0,
  panY: 0,
  dragging: false,
  moved: false,
  startX: 0,
  startY: 0,
  startPanX: 0,
  startPanY: 0,
  raf: 0,
  startedAt: performance.now(),
};

let svg = null;
let viewport = null;
let worldRoot = null;
let inspector = null;
let lastSize = { width: 0, height: 0 };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function colorFor(entity) {
  return palette[entity?.kind] || palette.integration;
}

function labelFor(entity) {
  return String(entity?.name || entity?.id || '').toUpperCase();
}

function statusFor(entity) {
  return String(entity?.status || 'unknown').replaceAll('_', ' ');
}

function relationKey(relation) {
  return `${relation.from}:${relation.to}`;
}

function buildLayout(world) {
  const entities = world?.entities || [];
  const relations = world?.relations || [];
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const layout = new Map();

  // The first level is semantic, not a fixed list of business categories.
  // Systems occupy the centre, agents/providers form a working layer around
  // them, and projects/integrations/memory form the outer world.
  const groups = {
    system: entities.filter((e) => e.kind === 'system'),
    agent: entities.filter((e) => e.kind === 'agent'),
    provider: entities.filter((e) => e.kind === 'ai-provider'),
    project: entities.filter((e) => e.kind === 'project'),
    integration: entities.filter((e) => e.kind === 'integration'),
  };

  const center = { x: 0, y: 0 };
  const wulan = byId.get('wulan');
  if (wulan) layout.set(wulan.id, center);

  const placeRing = (items, radius, phase = 0, vertical = 0.72) => {
    items.filter((item) => item.id !== 'wulan').forEach((item, index) => {
      const angle = phase + (index / Math.max(items.length, 1)) * Math.PI * 2;
      layout.set(item.id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * vertical,
      });
    });
  };

  placeRing(groups.agent, 250, -Math.PI / 2);
  placeRing(groups.provider, 205, 0, 0.78);
  placeRing(groups.project, 360, Math.PI / 4);
  placeRing(groups.integration, 405, -Math.PI / 5);

  // Remaining systems are positioned between Wulan and the outer world.
  const otherSystems = groups.system.filter((item) => item.id !== 'wulan');
  placeRing(otherSystems, 145, Math.PI / 4, 0.9);

  // A stable force-like relaxation makes connected objects drift toward each
  // other without requiring a physics library. This keeps the browser shell
  // lightweight and gives the map a coherent, organic topology.
  const positions = new Map([...layout].map(([id, point]) => [id, { ...point }]));
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const delta = new Map([...positions.keys()].map((id) => [id, { x: 0, y: 0 }]));

    for (const a of positions.keys()) {
      for (const b of positions.keys()) {
        if (a >= b) continue;
        const pa = positions.get(a);
        const pb = positions.get(b);
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        const distance = Math.max(45, Math.hypot(dx, dy));
        const push = Math.max(0, 105 - distance) / distance * 2.1;
        dx *= push;
        dy *= push;
        delta.get(a).x += dx;
        delta.get(a).y += dy;
        delta.get(b).x -= dx;
        delta.get(b).y -= dy;
      }
    }

    for (const relation of relations) {
      const a = positions.get(relation.from);
      const b = positions.get(relation.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 1;
      const desired = relation.type === 'orchestrates' ? 220 : 170;
      const pull = (distance - desired) * 0.004;
      delta.get(relation.from).x += dx / distance * pull * 20;
      delta.get(relation.from).y += dy / distance * pull * 20;
      delta.get(relation.to).x -= dx / distance * pull * 20;
      delta.get(relation.to).y -= dy / distance * pull * 20;
    }

    for (const [id, point] of positions) {
      if (id === 'wulan') continue;
      point.x += delta.get(id).x;
      point.y += delta.get(id).y;
      const limit = 460;
      const length = Math.hypot(point.x, point.y);
      if (length > limit) {
        point.x = point.x / length * limit;
        point.y = point.y / length * limit;
      }
    }
  }

  return positions;
}

function graphSize() {
  const rect = worldSpace?.getBoundingClientRect();
  return {
    width: Math.max(rect?.width || 800, 320),
    height: Math.max(rect?.height || 600, 320),
  };
}

function project(point, size) {
  return {
    x: size.width / 2 + point.x * state.scale + state.panX,
    y: size.height / 2 + point.y * state.scale + state.panY,
  };
}

function createInspector() {
  if (!worldSpace || inspector) return;
  inspector = document.createElement('aside');
  inspector.className = 'world-inspector';
  inspector.hidden = true;
  worldSpace.appendChild(inspector);
}

function renderInspector(entity, point) {
  createInspector();
  if (!inspector) return;

  if (!entity) {
    inspector.hidden = true;
    return;
  }

  const relations = (state.world?.relations || []).filter((relation) =>
    relation.from === entity.id || relation.to === entity.id
  );
  const entityMap = new Map((state.world?.entities || []).map((item) => [item.id, item]));
  const connections = relations.slice(0, 6).map((relation) => {
    const otherId = relation.from === entity.id ? relation.to : relation.from;
    const other = entityMap.get(otherId);
    return `<div class="world-inspector__relation"><span>${escapeHtml(relation.type.replaceAll('_', ' '))}</span><b>${escapeHtml(labelFor(other) || otherId)}</b></div>`;
  }).join('');

  const metadata = Object.entries(entity.metadata || {}).slice(0, 4).map(([key, value]) =>
    `<div class="world-inspector__meta"><span>${escapeHtml(key)}</span><b>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</b></div>`
  ).join('');

  const rect = worldSpace.getBoundingClientRect();
  const left = Math.max(12, Math.min(point.x + 18, rect.width - 276));
  const top = Math.max(12, Math.min(point.y + 18, rect.height - 220));
  inspector.style.left = `${left}px`;
  inspector.style.top = `${top}px`;
  inspector.innerHTML = `
    <div class="world-inspector__eyebrow">${escapeHtml(entity.kind || 'entity')}</div>
    <strong>${escapeHtml(labelFor(entity))}</strong>
    <span class="world-inspector__status"><i></i>${escapeHtml(statusFor(entity))}</span>
    ${metadata ? `<div class="world-inspector__section">${metadata}</div>` : ''}
    ${connections ? `<div class="world-inspector__section">${connections}</div>` : '<div class="world-inspector__empty">No connections recorded.</div>'}
    <div class="world-inspector__hint">CLICK TO FOCUS · DRAG TO MOVE WORLD</div>
  `;
  inspector.hidden = false;
}

function focusEntity(id) {
  state.selected = state.selected === id ? null : id;
  state.hovered = null;
  if (state.selected) {
    const entity = state.world?.entities?.find((item) => item.id === state.selected);
    if (entity) state.panX = 0; // layout is centred; detail remains beside the node.
    renderInspector(entity, { x: graphSize().width / 2, y: graphSize().height / 2 });
  } else {
    renderInspector(null);
  }
  render();
}

function isConnected(id, selected) {
  if (!selected || id === selected) return true;
  return (state.world?.relations || []).some((relation) =>
    (relation.from === selected && relation.to === id) ||
    (relation.to === selected && relation.from === id)
  );
}

function drawNode(entity, point, size, elapsed) {
  const color = colorFor(entity);
  const selected = state.selected === entity.id;
  const connected = isConnected(entity.id, state.selected);
  const hovered = state.hovered === entity.id;
  const active = ['online', 'active', 'ready'].includes(entity.status);
  const isCore = entity.id === 'wulan';
  const radius = isCore ? 40 : entity.kind === 'agent' ? 27 : entity.kind === 'ai-provider' ? 24 : 22;
  const breathe = Math.sin(elapsed * (isCore ? 1.6 : 1.05) + entity.id.length) * (isCore ? 2.4 : 1.1);
  const r = radius + breathe + (selected ? 4 : 0);
  const opacity = state.selected && !connected ? 0.15 : hovered || selected ? 1 : 0.82;

  const shape = entity.kind === 'agent'
    ? `<polygon points="0,-${r} ${r * .86},-${r * .48} ${r * .86},${r * .48} 0,${r} -${r * .86},${r * .48} -${r * .86},-${r * .48}" class="world-node__shape"/>`
    : entity.kind === 'project'
      ? `<path d="M 0,-${r} C ${r*.8},-${r*.8} ${r},-${r*.25} ${r*.75},0 C ${r},${r*.5} ${r*.55},${r*.9} 0,${r} C -${r*.65},${r*.9} -${r},${r*.45} -${r*.7},0 C -${r},-${r*.4} -${r*.55},-${r*.85} 0,-${r} Z" class="world-node__shape"/>`
      : `<circle r="${r}" class="world-node__shape"/>`;

  const inner = isCore
    ? `<circle r="${r*.48}" class="world-node__core"/><circle r="${r*.18}" class="world-node__core-dot"/>`
    : `<circle r="${Math.max(3, r*.16)}" class="world-node__dot"/>`;

  const labelY = r + 18;
  return `<g class="world-node ${isCore ? 'world-node--core' : ''} ${active ? 'world-node--active' : ''} ${selected ? 'world-node--selected' : ''} ${hovered ? 'world-node--hovered' : ''}" data-entity="${escapeHtml(entity.id)}" transform="translate(${point.x} ${point.y})" style="--node-color:${color};--node-opacity:${opacity}">
      ${active ? `<circle r="${r + 9}" class="world-node__pulse"/>` : ''}
      ${selected ? `<circle r="${r + 15}" class="world-node__selection"/>` : ''}
      <g class="world-node__visual">${shape}${inner}</g>
      <text y="${labelY}" class="world-node__name">${escapeHtml(labelFor(entity))}</text>
      <text y="${labelY + 11}" class="world-node__status">${escapeHtml(statusFor(entity))}</text>
    </g>`;
}

function drawRelations(layout, size) {
  return (state.world?.relations || []).map((relation, index) => {
    const a = layout.get(relation.from);
    const b = layout.get(relation.to);
    if (!a || !b) return '';
    const A = project(a, size);
    const B = project(b, size);
    const connected = state.selected && (relation.from === state.selected || relation.to === state.selected);
    const x1 = A.x;
    const y1 = A.y;
    const x2 = B.x;
    const y2 = B.y;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const bend = Math.min(85, Math.hypot(dx, dy) * .16);
    const nx = -dy / (Math.hypot(dx, dy) || 1);
    const ny = dx / (Math.hypot(dx, dy) || 1);
    const cx = (x1 + x2) / 2 + nx * bend * (index % 2 ? -1 : 1);
    const cy = (y1 + y2) / 2 + ny * bend * (index % 2 ? -1 : 1);
    const opacity = state.selected && !connected ? .035 : connected ? .78 : .18;
    const label = connected ? `<text x="${cx}" y="${cy - 5}" class="world-link__label">${escapeHtml(relation.type.replaceAll('_', ' '))}</text>` : '';
    return `<g class="world-link-group" style="--link-opacity:${opacity}">
      <path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" class="world-link" data-relation="${escapeHtml(relationKey(relation))}"/>
      ${connected ? `<circle r="2.2" class="world-link__packet"><animateMotion dur="${2.4 + (index % 4) * .35}s" repeatCount="indefinite" path="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}"/></circle>` : ''}
      ${label}
    </g>`;
  }).join('');
}

function render() {
  if (!worldSpace || !state.world) return;
  const size = graphSize();
  lastSize = size;
  const layout = buildLayout(state.world);
  const elapsed = (performance.now() - state.startedAt) / 1000;

  const relationMarkup = drawRelations(layout, size);
  const nodes = (state.world.entities || []).filter((entity) => layout.has(entity.id)).map((entity) =>
    drawNode(entity, project(layout.get(entity.id), size), size, elapsed)
  ).join('');

  worldSpace.innerHTML = `
    <div class="world-vignette" aria-hidden="true"></div>
    <div class="world-controls" aria-label="World controls">
      <button type="button" data-world-action="zoom-out" aria-label="Zoom out">−</button>
      <button type="button" data-world-action="reset" aria-label="Reset world view">◎</button>
      <button type="button" data-world-action="zoom-in" aria-label="Zoom in">+</button>
    </div>
    <svg class="world-map" viewBox="0 0 ${size.width} ${size.height}" role="img" aria-label="Interactive Wulan world">
      <defs>
        <radialGradient id="world-core-glow"><stop offset="0" stop-color="#79e8ff" stop-opacity=".24"/><stop offset=".55" stop-color="#79e8ff" stop-opacity=".05"/><stop offset="1" stop-color="#79e8ff" stop-opacity="0"/></radialGradient>
        <filter id="world-blur"><feGaussianBlur stdDeviation="10"/></filter>
      </defs>
      <g class="world-grid" transform="translate(${state.panX} ${state.panY}) scale(${state.scale})">
        <circle cx="${size.width/2}" cy="${size.height/2}" r="230" class="world-aura"/>
        <circle cx="${size.width/2}" cy="${size.height/2}" r="150" class="world-aura world-aura--inner"/>
        ${relationMarkup}
        <g class="world-nodes">${nodes}</g>
      </g>
    </svg>
    <div class="world-caption"><span>WULAN WORLD</span><b>${state.selected ? 'FOCUSED' : 'EXPLORE'}</b><small>scroll to zoom · drag to move · click a node</small></div>
  `;

  svg = $('.world-map');
  viewport = $('.world-grid');
  createInspector();
  if (state.selected) {
    const selected = state.world.entities.find((entity) => entity.id === state.selected);
    if (selected) {
      const point = project(layout.get(selected.id), size);
      renderInspector(selected, point);
    }
  }

  wireWorldEvents();

  if (agentLabel) agentLabel.innerHTML = `AGENTS <b>${(state.world.entities || []).filter((entity) => entity.kind === 'agent').length}</b>`;
  if (worldLabel) worldLabel.innerHTML = `WORLD <b>${(state.world.entities || []).length}</b>`;
}

function wireWorldEvents() {
  worldSpace.querySelectorAll('[data-world-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = button.dataset.worldAction;
      if (action === 'zoom-in') state.scale = Math.min(2.2, state.scale * 1.16);
      if (action === 'zoom-out') state.scale = Math.max(.62, state.scale / 1.16);
      if (action === 'reset') {
        state.scale = 1;
        state.panX = 0;
        state.panY = 0;
        state.selected = null;
      }
      render();
    });
  });

  worldSpace.querySelectorAll('[data-entity]').forEach((node) => {
    node.addEventListener('mouseenter', () => {
      state.hovered = node.dataset.entity;
      render();
    });
    node.addEventListener('mouseleave', () => {
      state.hovered = null;
      if (!state.selected) renderInspector(null);
      render();
    });
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      focusEntity(node.dataset.entity);
    });
  });

  svg?.addEventListener('click', () => {
    state.selected = null;
    renderInspector(null);
    render();
  });

  svg?.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.09 : .92;
    state.scale = Math.max(.62, Math.min(2.2, state.scale * factor));
    render();
  }, { passive: false });

  svg?.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-entity]')) return;
    state.dragging = true;
    state.moved = false;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.startPanX = state.panX;
    state.startPanY = state.panY;
    svg.setPointerCapture?.(event.pointerId);
  });

  svg?.addEventListener('pointermove', (event) => {
    if (!state.dragging) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (Math.hypot(dx, dy) > 4) state.moved = true;
    state.panX = state.startPanX + dx;
    state.panY = state.startPanY + dy;
    if (viewport) viewport.setAttribute('transform', `translate(${state.panX} ${state.panY}) scale(${state.scale})`);
  });

  svg?.addEventListener('pointerup', () => { state.dragging = false; });
  svg?.addEventListener('pointercancel', () => { state.dragging = false; });
}

async function syncWorld() {
  try {
    const response = await fetch('/api/world', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`world ${response.status}`);
    state.world = await response.json();
    render();
  } catch (error) {
    // Keep the shell visible if a live capability is temporarily unavailable.
    console.warn('[Wulan World]', error?.message || error);
  }
}

createInspector();
syncWorld();
setInterval(syncWorld, 15000);
