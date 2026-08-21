const $ = (s) => document.querySelector(s);
const worldSpace = $('#world-space');
const agentLabel = $('#agents-label');
const worldLabel = $('#memory-label');

const layout = {
  wulan: [50, 52],
  'provider:gemini': [33, 20],
  'provider:openai': [50, 15],
  'provider:anthropic': [67, 20],
  atlas: [18, 39], leon: [82, 39], oracle: [18, 63], pixel: [82, 63],
  memory: [38, 76], context: [62, 76],
  github: [31, 91], vercel: [69, 91], sentinel: [43, 91], edgelab: [57, 91],
};

const colors = {
  system: '#79e8ff',
  agent: '#aa8cff',
  project: '#70e5b4',
  integration: '#9aaec5',
  'ai-provider': '#e8c76f',
};

const fallbackLabels = {
  wulan: 'WULAN', memory: 'MEMORY', context: 'CONTEXT', atlas: 'ATLAS', leon: 'LEON',
  oracle: 'ORACLE', pixel: 'PIXEL', sentinel: 'SENTINEL', edgelab: 'EDGELAB',
  github: 'GITHUB', vercel: 'VERCEL', 'provider:gemini': 'GEMINI',
  'provider:openai': 'CHATGPT', 'provider:anthropic': 'CLAUDE',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function render(world) {
  if (!worldSpace) return;
  const entities = world.entities ?? [];
  const byId = new Map(entities.map(entity => [entity.id, entity]));
  const visible = entities.filter(entity => layout[entity.id]);
  const width = 1000;
  const height = 1000;

  const lines = (world.relations ?? [])
    .filter(relation => layout[relation.from] && layout[relation.to])
    .map(relation => {
      const [x1, y1] = layout[relation.from];
      const [x2, y2] = layout[relation.to];
      return `<line x1="${x1 * 10}" y1="${y1 * 10}" x2="${x2 * 10}" y2="${y2 * 10}" class="world-link" data-from="${escapeHtml(relation.from)}" data-to="${escapeHtml(relation.to)}"/>`;
    }).join('');

  const nodes = visible.map(entity => {
    const [x, y] = layout[entity.id];
    const kind = entity.kind || 'integration';
    const color = colors[kind] || colors.integration;
    const central = entity.id === 'wulan';
    const active = ['online', 'active', 'ready'].includes(entity.status);
    const provider = kind === 'ai-provider';
    const label = fallbackLabels[entity.id] || entity.name;
    return `<g class="world-node ${central ? 'world-node--core' : ''} ${active ? 'world-node--active' : ''} ${provider ? 'world-node--provider' : ''}" transform="translate(${x * 10} ${y * 10})" data-entity="${escapeHtml(entity.id)}">
      <rect x="${central ? -76 : provider ? -58 : -52}" y="-18" width="${central ? 152 : provider ? 116 : 104}" height="36" rx="10" class="world-card" style="--node-color:${color}"/>
      <circle cx="${central ? -59 : provider ? -43 : -37}" cy="0" r="3" class="world-dot" style="--node-color:${color}"/>
      <text x="${central ? -48 : provider ? -32 : -27}" y="-2" class="world-name">${escapeHtml(label)}</text>
      <text x="${central ? -48 : provider ? -32 : -27}" y="9" class="world-status">${escapeHtml(entity.status || 'unknown')}</text>
    </g>`;
  }).join('');

  const activePackets = (world.activities ?? []).slice(-3).map((activity, index) => {
    const source = activity.agentId || activity.source || 'wulan';
    const target = activity.capabilityId?.startsWith('github') ? 'github' : activity.capabilityId?.startsWith('sentinel') ? 'sentinel' : 'wulan';
    if (!layout[source] || !layout[target]) return '';
    const [x1, y1] = layout[source];
    const [x2, y2] = layout[target];
    return `<circle r="3" class="world-packet"><animate attributeName="cx" values="${x1 * 10};${x2 * 10};${x1 * 10}" dur="${2.2 + index * .4}s" repeatCount="indefinite"/><animate attributeName="cy" values="${y1 * 10};${y2 * 10};${y1 * 10}" dur="${2.2 + index * .4}s" repeatCount="indefinite"/></circle>`;
  }).join('');

  worldSpace.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <g class="world-links">${lines}</g>
    <g class="world-packets">${activePackets}</g>
    <g class="world-nodes">${nodes}</g>
  </svg>`;

  const latest = world.observations?.at(-1);
  if (latest?.source) {
    const target = $(`[data-entity="${CSS.escape(latest.source)}"]`);
    target?.classList.add('world-node--active');
  }

  if (agentLabel) agentLabel.innerHTML = `AGENTS <b>${entities.filter(entity => entity.kind === 'agent').length}</b>`;
  if (worldLabel) worldLabel.innerHTML = `WORLD <b>${entities.length}</b>`;
}

async function syncWorld() {
  try {
    const response = await fetch('/api/world', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`world ${response.status}`);
    render(await response.json());
  } catch {
    // Keep the local shell usable if a live integration is temporarily unavailable.
  }
}

syncWorld();
setInterval(syncWorld, 15000);
