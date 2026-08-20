/**
 * NOVA Search Foundation
 * Local full-text search across notes, tasks, and events.
 * Returns ranked results — title/type hits score higher than body hits.
 * No embeddings, no cloud, no AI. Pure string matching.
 */

import { DB } from '../core/db.js';

/**
 * @typedef {Object} SearchResult
 * @property {string} id
 * @property {'note'|'task'|'event'|'memory'} type
 * @property {string} title       - Display title
 * @property {string} excerpt     - Relevant snippet (up to 120 chars)
 * @property {number} score       - Relevance score (higher = better)
 * @property {string} timestamp   - ISO timestamp of the record
 */

const MAX_RESULTS_PER_TYPE = 20;
const EXCERPT_LENGTH       = 120;

/**
 * Search notes, tasks, events, and memories for query.
 * @param {string} query
 * @param {{ types?: string[] }} options  - Optionally limit to specific types
 * @returns {Promise<SearchResult[]>} Ranked results, best first
 */
export async function search(query, options = {}) {
  if (!query || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const types = options.types ?? ['note', 'task', 'event', 'memory'];

  const searches = [];
  if (types.includes('note'))   searches.push(_searchNotes(q));
  if (types.includes('task'))   searches.push(_searchTasks(q));
  if (types.includes('event'))  searches.push(_searchEvents(q));
  if (types.includes('memory')) searches.push(_searchMemories(q));

  const resultGroups = await Promise.all(searches);
  const all = resultGroups.flat();

  // Sort by score descending, then by timestamp descending
  return all.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.timestamp > a.timestamp ? 1 : -1;
  });
}

// ── Per-type search functions ─────────────────────────────────

async function _searchNotes(q) {
  const all     = await DB.notes.getAll();
  const results = [];

  for (const note of all) {
    if (results.length >= MAX_RESULTS_PER_TYPE) break;
    const score = _scoreNote(note, q);
    if (score === 0) continue;

    const bodyMatch = _findExcerpt(note.content, q);
    results.push({
      id:        note.id,
      type:      'note',
      title:     note.title || 'Untitled',
      excerpt:   bodyMatch || _truncate(note.content, EXCERPT_LENGTH),
      score,
      timestamp: note.updatedAt,
    });
  }

  return results;
}

async function _searchTasks(q) {
  const all     = await DB.tasks.getAll();
  const results = [];

  for (const task of all) {
    if (results.length >= MAX_RESULTS_PER_TYPE) break;
    const score = _scoreTask(task, q);
    if (score === 0) continue;

    results.push({
      id:        task.id,
      type:      'task',
      title:     task.title || 'Untitled task',
      excerpt:   task.description ? _truncate(task.description, EXCERPT_LENGTH) : `Status: ${task.status}`,
      score,
      timestamp: task.updatedAt,
    });
  }

  return results;
}

async function _searchEvents(q) {
  const all     = await DB.events.getAll();
  const results = [];

  for (const ev of all) {
    if (results.length >= MAX_RESULTS_PER_TYPE) break;
    const desc  = (ev.description ?? '').toLowerCase();
    const type  = (ev.type ?? '').toLowerCase();
    if (!desc.includes(q) && !type.includes(q)) continue;

    const score = type.includes(q) ? 2 : 1;
    results.push({
      id:        ev.id,
      type:      'event',
      title:     _formatEventType(ev.type),
      excerpt:   _truncate(ev.description, EXCERPT_LENGTH),
      score,
      timestamp: ev.timestamp,
    });
  }

  return results;
}

async function _searchMemories(q) {
  const all     = await DB.memories.getAll();
  const results = [];

  for (const mem of all) {
    if (results.length >= MAX_RESULTS_PER_TYPE) break;
    const content = (mem.content ?? '').toLowerCase();
    const tags    = (mem.tags ?? []).join(' ').toLowerCase();
    if (!content.includes(q) && !tags.includes(q)) continue;

    const score = tags.includes(q) ? 3 : 1;
    results.push({
      id:        mem.id,
      type:      'memory',
      title:     `Memory (${mem.type})`,
      excerpt:   _truncate(mem.content, EXCERPT_LENGTH),
      score,
      timestamp: mem.timestamp,
    });
  }

  return results;
}

// ── Scoring ───────────────────────────────────────────────────

function _scoreNote(note, q) {
  let score = 0;
  if ((note.title ?? '').toLowerCase().includes(q))   score += 5;
  if ((note.content ?? '').toLowerCase().includes(q)) score += 2;
  if ((note.tags ?? []).some((t) => t.toLowerCase().includes(q))) score += 3;
  if (note.pinned) score += 1;
  return score;
}

function _scoreTask(task, q) {
  let score = 0;
  if ((task.title ?? '').toLowerCase().includes(q))       score += 5;
  if ((task.description ?? '').toLowerCase().includes(q)) score += 2;
  // Pending tasks are slightly more relevant
  if (task.status === 'pending' || task.status === 'in_progress') score += 1;
  return score;
}

// ── Helpers ───────────────────────────────────────────────────

function _truncate(str, len) {
  if (!str) return '';
  const s = str.replace(/\n/g, ' ').trim();
  return s.length <= len ? s : s.slice(0, len) + '…';
}

function _findExcerpt(text, q) {
  if (!text) return '';
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 40);
  const end   = Math.min(text.length, idx + q.length + 80);
  const excerpt = text.slice(start, end).replace(/\n/g, ' ').trim();
  return (start > 0 ? '…' : '') + excerpt + (end < text.length ? '…' : '');
}

function _formatEventType(type) {
  if (!type) return 'Event';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
