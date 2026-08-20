/**
 * NOVA Global Search Panel
 * Live cross-store search — notes, tasks, events, memories.
 * Results grouped by type; clicking navigates to the item.
 */

import { search }   from '../services/search.js';
import { escHtml }  from '../core/utils.js';

const TYPE_LABELS = { note: 'Notes', task: 'Tasks', event: 'Events', memory: 'Memories' };
const TYPE_ORDER  = ['note', 'task', 'event', 'memory'];

export function renderSearchPanel() {
  const content = document.getElementById('panel-content');
  if (!content) return;

  content.innerHTML = `
    <div class="sp-wrap">
      <div class="search-wrapper">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          id="sp-input"
          class="search-input"
          placeholder="Search notes, tasks, events, memories…"
          aria-label="Search everything"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
        />
      </div>
      <div id="sp-results" aria-live="polite" aria-label="Search results">
        <div class="sp-hint">Start typing to search everything</div>
      </div>
    </div>
  `;

  const input   = content.querySelector('#sp-input');
  const results = content.querySelector('#sp-results');
  input?.focus();

  let timer;
  input?.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) {
      results.innerHTML = '<div class="sp-hint">Start typing to search everything</div>';
      return;
    }
    results.innerHTML = '<div class="sp-searching">Searching…</div>';
    timer = setTimeout(async () => {
      try {
        const hits = await search(q);
        if (hits.length === 0) {
          results.innerHTML = `<div class="sp-no-results">No results for "<strong>${escHtml(q)}</strong>"</div>`;
          return;
        }
        results.innerHTML = _renderGroups(hits);
        _wireClicks(results);
      } catch (err) {
        console.error('[Search] Error:', err);
        results.innerHTML = '<div class="sp-error">Search failed — try again</div>';
      }
    }, 200);
  });

  // Arrow-key navigation
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      results.innerHTML = '<div class="sp-hint">Start typing to search everything</div>';
    }
  });
}

// ── Rendering ─────────────────────────────────────────────────

function _renderGroups(hits) {
  const groups = {};
  for (const h of hits) {
    if (!groups[h.type]) groups[h.type] = [];
    groups[h.type].push(h);
  }

  const totalCount = hits.length;
  let html = `<div class="sp-total">${totalCount} result${totalCount !== 1 ? 's' : ''}</div>`;

  for (const type of TYPE_ORDER) {
    const group = groups[type];
    if (!group) continue;
    const shown = group.slice(0, 6);
    html += `
      <div class="sp-group">
        <div class="sp-group-header">
          <span class="sp-group-label">${TYPE_LABELS[type]}</span>
          <span class="count-badge">${group.length}</span>
        </div>
        ${shown.map((h) => _resultRow(h, type)).join('')}
        ${group.length > 6 ? `<div class="sp-more">+${group.length - 6} more</div>` : ''}
      </div>
    `;
  }
  return html;
}

function _resultRow(h, type) {
  const icon = { note: '◈', task: '◎', event: '◉', memory: '◆' }[type] ?? '·';
  return `
    <div class="sp-result card-appear" data-type="${type}" data-id="${escHtml(h.id)}" role="button" tabindex="0"
         aria-label="${escHtml(h.title)}">
      <span class="sp-result-icon sp-icon--${type}" aria-hidden="true">${icon}</span>
      <div class="sp-result-body">
        <div class="sp-result-title">${escHtml(h.title)}</div>
        ${h.excerpt ? `<div class="sp-result-excerpt">${escHtml(h.excerpt)}</div>` : ''}
      </div>
      <span class="sp-result-score" title="Relevance">${h.score}</span>
    </div>
  `;
}

function _wireClicks(container) {
  container.querySelectorAll('.sp-result').forEach((el) => {
    const open = () => {
      document.dispatchEvent(new CustomEvent('nova:open-result', {
        detail: { type: el.dataset.type, id: el.dataset.id },
      }));
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}
