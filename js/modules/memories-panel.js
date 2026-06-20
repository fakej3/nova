/**
 * NOVA Memory Center
 * Dedicated view for browsing, filtering, and searching all memories.
 */

import { DB }         from '../core/db.js';
import { escHtml, formatRelativeTime } from '../core/utils.js';

const FILTERS = ['all', 'note', 'task', 'manual'];
const SORTS   = ['recent', 'oldest', 'updated'];

let _activeFilter = 'all';
let _activeSort   = 'recent';
let _query        = '';

export async function renderMemoriesPanel() {
  const content = document.getElementById('panel-content');
  if (!content) return;

  content.innerHTML = '<div class="mem-panel-loading">Loading memories…</div>';

  try {
    let all = await DB.memories.getAll();
    _render(content, all);
  } catch (err) {
    console.error('[MemoriesPanel]', err);
    content.innerHTML = `<p class="diag-error">Failed to load memories: ${escHtml(err.message)}</p>`;
  }
}

// ── Rendering ─────────────────────────────────────────────────

function _render(container, all) {
  const counts = {
    all:    all.length,
    note:   all.filter((m) => m.source === 'note').length,
    task:   all.filter((m) => m.source === 'task').length,
    manual: all.filter((m) => m.source === 'user').length,
  };

  container.innerHTML = `
    <div class="mp-toolbar">
      <div class="mp-filters" role="tablist" aria-label="Filter memories">
        ${_filterTab('all',    'All',    counts.all)}
        ${_filterTab('note',   'Notes',  counts.note)}
        ${_filterTab('task',   'Tasks',  counts.task)}
        ${_filterTab('manual', 'Manual', counts.manual)}
      </div>
      <select id="mp-sort" class="mp-sort-select form-select" aria-label="Sort memories">
        <option value="recent"  ${_activeSort === 'recent'  ? 'selected' : ''}>Most Recent</option>
        <option value="updated" ${_activeSort === 'updated' ? 'selected' : ''}>Last Updated</option>
        <option value="oldest"  ${_activeSort === 'oldest'  ? 'selected' : ''}>Oldest First</option>
      </select>
    </div>

    <div class="search-wrapper mp-search">
      <span class="search-icon" aria-hidden="true">⌕</span>
      <input
        type="search"
        id="mp-search"
        class="search-input"
        placeholder="Search memories…"
        value="${escHtml(_query)}"
        aria-label="Search memories"
        autocomplete="off"
      />
    </div>

    <div id="mp-list" aria-label="Memories list">
      ${_renderList(all)}
    </div>
  `;

  _wire(container, all);
}

function _filterTab(key, label, count) {
  const active = _activeFilter === key;
  return `
    <button class="filter-tab ${active ? 'active' : ''}" data-filter="${key}"
            role="tab" aria-selected="${active}">
      ${label}${count > 0 ? ` <span class="count-badge">${count}</span>` : ''}
    </button>
  `;
}

function _renderList(all) {
  const filtered = _applyFilter(all, _activeFilter);
  const searched = _applySearch(filtered, _query);
  const sorted   = _applySort(searched, _activeSort);

  if (sorted.length === 0) {
    const msg = _query
      ? `No memories match "<strong>${escHtml(_query)}</strong>"`
      : 'No memories yet — create notes or tasks to build your memory.';
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">◆</div>
        <div class="empty-title">No memories</div>
        <div class="empty-desc">${msg}</div>
      </div>
    `;
  }

  return sorted.map((m) => _memoryCard(m)).join('');
}

function _memoryCard(m) {
  const typeLabel = { note: 'Note', task: 'Task', event: 'Event', memory: 'Memory' }[m.type] ?? m.type;
  const srcLabel  = m.source === 'user' ? 'manual' : m.source;
  const ts        = formatRelativeTime(m.updatedAt ?? m.timestamp);
  const createdTs = formatRelativeTime(m.timestamp);

  return `
    <div class="mp-card card-appear">
      <div class="mp-card-header">
        <span class="mem-type mem-type--${escHtml(m.type)}">${typeLabel}</span>
        <span class="mp-card-src">${escHtml(srcLabel)}</span>
        <span class="mp-card-ts" title="Created ${createdTs}">${ts}</span>
      </div>
      <div class="mp-card-content">${escHtml(m.content)}</div>
      ${m.tags?.length ? `
        <div class="mp-card-tags">
          ${m.tags.map((t) => `<span class="tag">${escHtml(t)}</span>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// ── Filtering / Sorting ───────────────────────────────────────

function _applyFilter(all, filter) {
  if (filter === 'all')    return all;
  if (filter === 'manual') return all.filter((m) => m.source === 'user');
  return all.filter((m) => m.source === filter);
}

function _applySearch(list, q) {
  if (!q) return list;
  const lower = q.toLowerCase();
  return list.filter((m) =>
    m.content.toLowerCase().includes(lower) ||
    (m.tags ?? []).some((t) => t.toLowerCase().includes(lower))
  );
}

function _applySort(list, sort) {
  return [...list].sort((a, b) => {
    if (sort === 'oldest') {
      return a.timestamp > b.timestamp ? 1 : -1;
    }
    if (sort === 'updated') {
      const ta = a.updatedAt ?? a.timestamp;
      const tb = b.updatedAt ?? b.timestamp;
      return tb > ta ? 1 : -1;
    }
    // recent: by creation time desc
    return b.timestamp > a.timestamp ? 1 : -1;
  });
}

// ── Wiring ────────────────────────────────────────────────────

function _wire(container, all) {
  // Filter tabs
  container.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      _activeFilter = tab.dataset.filter;
      document.getElementById('mp-list').innerHTML = _renderList(all);
    });
  });

  // Sort select
  const sortEl = container.querySelector('#mp-sort');
  sortEl?.addEventListener('change', () => {
    _activeSort = sortEl.value;
    document.getElementById('mp-list').innerHTML = _renderList(all);
  });

  // Search input
  const searchEl = container.querySelector('#mp-search');
  let timer;
  searchEl?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      _query = searchEl.value.trim();
      document.getElementById('mp-list').innerHTML = _renderList(all);
    }, 200);
  });
}
