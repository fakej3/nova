const $ = (s) => document.querySelector(s);
const worldSpace = $('#world-space');
const headline = $('#headline');
const subline = $('#subline');
const activity = $('#activity');
const activityLine = $('#activity-line');
const activityState = $('#activity-state');

// The interface should show the system, not narrate it. No "listening/thinking" copy.
if (headline) headline.textContent = 'WULAN';
if (subline) subline.textContent = 'PERSONAL OPERATING ENVIRONMENT';
if (activity) activity.hidden = true;

const layout = {
  wulan: [50, 51],
  memory: [37, 36], context: [63, 36],
  atlas: [17, 43], leon: [83, 43], oracle: [17, 64], pixel: [83, 64],
  sentinel: [31, 76], edgelab: [69, 76], github: [25, 24], vercel: [75, 24]
};

const colors = { system: '#79e8ff', agent: '#aa8cff', project: '#70e5b4', integration: '#9aaec5' };
const labels = { memory: 'MEMORY', context: 'CONTEXT', atlas: 'ATLAS', leon: 'LEON', oracle: 'ORACLE', pixel: 'PIXEL', sentinel: 'SENTINEL', edgelab: 'EDGELAB', github: 'GITHUB', vercel: 'VERCEL', wulan: 'WULAN' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function render(world) {
  if (!worldSpace) return;
  const entities = world.entities ?? [];
  const byId = new Map(entities.map(e => [e.id, e]));
  const visible = entities.filter(e => layout[e.id]);
  const width = 1000, height = 700;

  const lines = (world.relations ?? []).filter(r => layout[r.from] && layout[r.to]).map(r => {
    const [x1, y1] = layout[r.from]; const [x2, y2] = layout[r.to];
    return `<line x1="${x1 * 10}" y1="${y1 * 7}" x2="${x2 * 10}" y2="${y2 * 7}" class="world-link" data-from="${r.from}" data-to="${r.to}"/>`;
  }).join('');

  const nodes = visible.map(entity => {
    const [x, y] = layout[entity.id];
    const kind = entity.kind || 'system';
    const color = colors[kind] || colors.integration;
    const central = entity.id === 'wulan';
    return `<g class="world-node ${central ? 'world-node--core' : ''}" transform="translate(${x * 10} ${y * 7})" data-entity="${entity.id}">
      <rect x="${central ? -66 : -52}" y="-18" width="${central ? 132 : 104}" height="36" rx="10" class="world-card" style="--node-color:${color}"/>
      <circle cx="${central ? -50 : -37}" cy="0" r="3" class="world-dot" style="--node-color:${color}"/>
      <text x="${central ? -39 : -27}" y="-2" class="world-name">${escapeHtml(labels[entity.id] || entity.name)}</text>
      <text x="${central ? -39 : -27}" y="9" class="world-status">${escapeHtml(entity.status || 'unknown')}</text>
    </g>`;
  }).join('');

  worldSpace.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g class="world-links">${lines}</g><g class="world-nodes">${nodes}</g></svg>`;

  // A tiny live pulse follows the most recent observation instead of showing prose.
  const latest = world.observations?.at(-1);
  if (latest?.source) {
    const target = latest.source === 'github' ? $('[data-entity="github"]') : null;
    if (target) target.classList.add('world-node--active');
  }

  // Keep labels honest: these are actual entities from the world model.
  const counts = {
    agents: entities.filter(e => e.kind === 'agent').length,
    systems: entities.filter(e => e.kind === 'system').length,
    projects: entities.filter(e => e.kind === 'project').length,
  };
  const agentLabel = $('#agents-label');
  if (agentLabel) agentLabel.innerHTML = `AGENTS <b>${counts.agents}</b>`;
  const memoryLabel = $('#memory-label');
  if (memoryLabel) memoryLabel.innerHTML = `WORLD <b>${entities.length}</b>`;
}

async function syncWorld() {
  try {
    const response = await fetch('/api/world', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`world ${response.status}`);
    const world = await response.json();
    render(world);
    if (activityLine) activityLine.textContent = '';
    if (activityState) activityState.textContent = '';
  } catch (error) {
    // The local world still exists; the UI must remain usable offline.
    if (activityLine) activityLine.textContent = '';
  }
}

syncWorld();
setInterval(syncWorld, 30_000);
