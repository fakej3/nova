/**
 * NOVA Activity Feed — Live system event display
 * Listens to Bus events and populates #activity-feed-list.
 * Purely visual — reads existing events, changes nothing.
 */

import { Bus, EVENTS } from '../core/bus.js';

const MAX_ITEMS = 8;
const _listEl = () => document.getElementById('activity-feed-list');

const ICONS = {
  SYSTEM: '◎',
  NOTE:   '◇',
  TASK:   '◉',
  MEM:    '◈',
  CHAT:   '◌',
  ONLINE: '●',
};

function _time() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function _addEntry(type, title, sub) {
  const list = _listEl();
  if (!list) return;

  const item = document.createElement('div');
  item.className = 'af-item af-item--new';
  item.innerHTML = `
    <div class="af-icon af-icon--${type.toLowerCase()}">${ICONS[type] || '·'}</div>
    <div class="af-body">
      <div class="af-title">${title}</div>
      ${sub ? `<div class="af-sub">${sub}</div>` : ''}
    </div>
    <div class="af-time">${_time()}</div>
  `;

  list.insertBefore(item, list.firstChild);
  requestAnimationFrame(() => item.classList.remove('af-item--new'));

  // Trim to MAX_ITEMS
  while (list.children.length > MAX_ITEMS) {
    list.removeChild(list.lastChild);
  }
}

export function initActivityFeed() {
  const list = _listEl();
  if (!list) return;

  // Boot entries
  _addEntry('ONLINE', 'Session started',    'Interface initialized');
  _addEntry('SYSTEM', 'NOVA online',        'All systems nominal');

  Bus.on(EVENTS.NOTE_CREATED,   (d) => _addEntry('NOTE',   'Note created',     d?.title || ''));
  Bus.on(EVENTS.NOTE_UPDATED,   (d) => _addEntry('NOTE',   'Note updated',     d?.title || ''));
  Bus.on(EVENTS.NOTE_DELETED,   ()  => _addEntry('NOTE',   'Note deleted',     ''));
  Bus.on(EVENTS.TASK_CREATED,   (d) => _addEntry('TASK',   'Task created',     d?.title || ''));
  Bus.on(EVENTS.TASK_UPDATED,   (d) => _addEntry('TASK',   'Task updated',     d?.title || ''));
  Bus.on(EVENTS.TASK_COMPLETED, (d) => _addEntry('TASK',   'Task completed',   d?.title || ''));
  Bus.on(EVENTS.MEMORY_CREATED, ()  => _addEntry('MEM',    'Memory stored',    'New context saved'));
  Bus.on(EVENTS.ONLINE,                ()  => _addEntry('ONLINE',  'Connection online', 'Network restored'));
  Bus.on(EVENTS.OFFLINE,               ()  => _addEntry('SYSTEM',  'Connection lost',   'Local mode active'));
  Bus.on(EVENTS.APP_READY,             ()  => _addEntry('SYSTEM',  'System ready',      'NOVA initialized'));
  Bus.on(EVENTS.CHAT_MESSAGE_SENT,     (d) => _addEntry('CHAT',    'Message sent',      d?.preview || ''));
  Bus.on(EVENTS.AI_RESPONSE_RECEIVED,  (d) => _addEntry('SYSTEM',  'AI responded',      d?.preview || ''));
}
