/**
 * NOVA Activity Timeline
 * Groups events by Today / Yesterday / Earlier.
 * Lazy-loads in pages of 30.
 */

import { DB }        from '../core/db.js';
import { escHtml, formatRelativeTime } from '../core/utils.js';

const PAGE_SIZE = 30;

const EVENT_ICONS = {
  note_created:     '◈',
  note_updated:     '◈',
  note_deleted:     '◈',
  task_created:     '◎',
  task_updated:     '◎',
  task_completed:   '✓',
  task_deleted:     '◎',
  memory_created:   '◆',
  theme_changed:    '◑',
  view_changed:     '→',
  settings_updated: '⚙',
  app_started:      '◉',
};

const EVENT_COLORS = {
  note_created:     'event-col--note',
  note_updated:     'event-col--note',
  note_deleted:     'event-col--note',
  task_created:     'event-col--task',
  task_updated:     'event-col--task',
  task_completed:   'event-col--done',
  task_deleted:     'event-col--task',
  memory_created:   'event-col--mem',
  theme_changed:    'event-col--sys',
  view_changed:     'event-col--sys',
  settings_updated: 'event-col--sys',
  app_started:      'event-col--sys',
};

export async function renderTimeline() {
  const content = document.getElementById('panel-content');
  if (!content) return;

  content.innerHTML = '<div class="tl-loading">Loading activity…</div>';

  try {
    const all = await DB.events.getRecent(500);
    if (all.length === 0) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" aria-hidden="true">◉</div>
          <div class="empty-title">No activity yet</div>
          <div class="empty-desc">Events will appear here as you use NOVA.</div>
        </div>
      `;
      return;
    }

    _renderPage(content, all, 0);
  } catch (err) {
    console.error('[Timeline]', err);
    content.innerHTML = `<p class="diag-error">Failed to load activity: ${escHtml(err.message)}</p>`;
  }
}

function _renderPage(container, all, offset) {
  const page   = all.slice(0, offset + PAGE_SIZE);
  const groups = _groupByDate(page);
  const hasMore = all.length > offset + PAGE_SIZE;

  const html = Object.entries(groups).map(([label, events]) => `
    <div class="tl-group">
      <div class="tl-group-label">${label}</div>
      ${events.map(_eventRow).join('')}
    </div>
  `).join('');

  container.innerHTML = `
    <div class="tl-wrap">
      <div class="tl-header">
        <span class="section-title">Activity Log</span>
        <span class="count-badge">${all.length}</span>
      </div>
      ${html}
      ${hasMore ? `
        <button class="tl-load-more btn btn-ghost btn-sm" data-offset="${offset + PAGE_SIZE}">
          Load more (${all.length - offset - PAGE_SIZE} remaining)
        </button>
      ` : '<div class="tl-end">· All events loaded ·</div>'}
    </div>
  `;

  container.querySelector('.tl-load-more')?.addEventListener('click', (e) => {
    const nextOffset = parseInt(e.currentTarget.dataset.offset, 10);
    _renderPage(container, all, nextOffset);
    // Scroll to where we were
    container.scrollTop = container.scrollHeight;
  });
}

function _groupByDate(events) {
  const now       = new Date();
  const todayStr  = now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const yestStr   = yesterday.toDateString();

  const groups = {};
  for (const ev of events) {
    const d   = new Date(ev.timestamp);
    const dStr = d.toDateString();
    let label;
    if (dStr === todayStr)  label = 'Today';
    else if (dStr === yestStr) label = 'Yesterday';
    else label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    if (!groups[label]) groups[label] = [];
    groups[label].push(ev);
  }
  return groups;
}

function _eventRow(ev) {
  const icon  = EVENT_ICONS[ev.type]  ?? '·';
  const color = EVENT_COLORS[ev.type] ?? 'event-col--sys';
  const time  = _formatTime(ev.timestamp);

  return `
    <div class="tl-row card-appear">
      <div class="tl-icon ${color}" aria-hidden="true">${icon}</div>
      <div class="tl-body">
        <div class="tl-desc">${escHtml(ev.description)}</div>
        <div class="tl-time">${time}</div>
      </div>
    </div>
  `;
}

function _formatTime(iso) {
  if (!iso) return '';
  const d    = new Date(iso);
  const diff = Date.now() - d;
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
