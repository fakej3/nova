/**
 * NOVA Diagnostics Panel
 * Developer view — live counts for all data stores + context snapshot.
 * Accessible from Settings. No production features here.
 */

import { DB }             from '../core/db.js';
import { buildContext }   from '../services/context.js';
import { search }         from '../services/search.js';
import { escHtml }        from '../core/utils.js';

// ── Public API ────────────────────────────────────────────────

export async function renderDiagnosticsPanel() {
  const container = document.getElementById('diagnostics-section');
  if (!container) return;

  container.innerHTML = _htmlLoading();

  try {
    const [notesCount, tasksCount, eventsCount, memoriesCount, ctx] = await Promise.all([
      DB.notes.count(),
      DB.tasks.count(),
      DB.events.count(),
      DB.memories.count(),
      buildContext(),
    ]);

    container.innerHTML = _htmlPanel({
      notesCount:    notesCount   ?? 0,
      tasksCount:    tasksCount   ?? 0,
      eventsCount:   eventsCount  ?? 0,
      memoriesCount: memoriesCount ?? 0,
      ctx,
    });

    _wireSearch(container);
    _wireRefresh(container);
  } catch (err) {
    console.error('[Diagnostics] Failed to load:', err);
    container.innerHTML = `<p class="diag-error">Failed to load diagnostics: ${escHtml(err.message)}</p>`;
  }
}

// ── Wiring ────────────────────────────────────────────────────

function _wireRefresh(container) {
  container.querySelector('#diag-refresh-btn')
    ?.addEventListener('click', renderDiagnosticsPanel);
}

function _wireSearch(container) {
  const input  = container.querySelector('#diag-search-input');
  const output = container.querySelector('#diag-search-results');
  if (!input || !output) return;

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) { output.innerHTML = ''; return; }

      output.innerHTML = '<div class="diag-searching">Searching…</div>';
      try {
        const results = await search(q);
        output.innerHTML = results.length === 0
          ? '<div class="diag-no-results">No results.</div>'
          : results.slice(0, 10).map(_resultRow).join('');
      } catch (err) {
        output.innerHTML = `<div class="diag-error">Search error: ${escHtml(err.message)}</div>`;
      }
    }, 250);
  });
}

// ── HTML ──────────────────────────────────────────────────────

function _htmlLoading() {
  return '<div class="diag-loading">Loading diagnostics…</div>';
}

function _htmlPanel({ notesCount, tasksCount, eventsCount, memoriesCount, ctx }) {
  return `
    <div class="diag-counts">
      ${_countCell('Notes',    notesCount,    '◈')}
      ${_countCell('Tasks',    tasksCount,    '◎')}
      ${_countCell('Events',   eventsCount,   '◉')}
      ${_countCell('Memories', memoriesCount, '◆')}
    </div>

    <details class="diag-panel diag-context-panel">
      <summary class="diag-summary">Context Snapshot</summary>
      <div class="diag-context-grid">
        <span class="diag-label">Date</span>
        <span class="diag-val">${escHtml(ctx.day_of_week)}, ${escHtml(ctx.date)}</span>
        <span class="diag-label">Time</span>
        <span class="diag-val">${escHtml(ctx.time)}</span>
        <span class="diag-label">Pending tasks</span>
        <span class="diag-val">${ctx.pending_tasks_count}</span>
        <span class="diag-label">Memories</span>
        <span class="diag-val">${ctx.memories_count}</span>
        <span class="diag-label">Recent activity</span>
        <span class="diag-val">${ctx.recent_activity.length} events</span>
      </div>
      ${ctx.recent_activity.length > 0 ? `
        <div class="diag-activity-list">
          ${ctx.recent_activity.slice(0, 5).map((e) => `
            <div class="diag-activity-row">
              <span class="diag-activity-type">${escHtml(_fmt(e.type))}</span>
              <span class="diag-activity-desc">${escHtml(e.description)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </details>

    <div class="diag-search-block">
      <label class="diag-label" for="diag-search-input">Search all stores</label>
      <input
        type="search"
        id="diag-search-input"
        class="search-input"
        placeholder="Search notes, tasks, events, memories…"
        aria-label="Search all stores"
      />
      <div id="diag-search-results" class="diag-search-results"></div>
    </div>

    <div class="diag-footer">
      <span class="diag-label">Generated at ${escHtml(new Date().toLocaleTimeString())}</span>
      <button id="diag-refresh-btn" class="btn btn-ghost btn-sm">↺ Refresh</button>
    </div>
  `;
}

function _countCell(label, count, icon) {
  return `
    <div class="diag-count-cell">
      <span class="diag-count-icon" aria-hidden="true">${icon}</span>
      <span class="diag-count-num">${count}</span>
      <span class="diag-count-label">${label}</span>
    </div>
  `;
}

function _resultRow(r) {
  const typeClass = `diag-result-type--${r.type}`;
  return `
    <div class="diag-result-row">
      <span class="diag-result-type ${typeClass}">${escHtml(r.type)}</span>
      <div class="diag-result-body">
        <div class="diag-result-title">${escHtml(r.title)}</div>
        <div class="diag-result-excerpt">${escHtml(r.excerpt)}</div>
      </div>
      <span class="diag-result-score" title="Relevance score">${r.score}</span>
    </div>
  `;
}

function _fmt(type) {
  return (type ?? '').replace(/_/g, ' ');
}
