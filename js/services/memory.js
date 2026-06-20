/**
 * NOVA Memory Engine
 * Service layer for the memories store.
 * Memories are discrete, typed facts the system accumulates over time.
 * Phase 2.5: auto-populated from note and task activity via upsert (de-duplicated).
 */

import { DB }          from '../core/db.js';
import { Bus, EVENTS } from '../core/bus.js';

export const MEMORY_TYPES = {
  NOTE:   'note',
  TASK:   'task',
  EVENT:  'event',
  MEMORY: 'memory',
};

// ── Auto-wiring: called from notes.js and tasks.js ────────────

/**
 * Create or update the memory entry linked to a note.
 * Always reads the full note from DB — never trusts a partial changes object.
 */
export async function upsertMemoryForNote(noteId) {
  if (!noteId) return;
  try {
    const note = await DB.notes.get(noteId);
    if (!note) return;
    const content  = _buildNoteContent(note);
    const tags     = (note.tags ?? []).slice();
    const isUpdate = !!(await DB.memories.getByRelatedId(noteId));
    await DB.memories.upsertByRelatedId(noteId, {
      type:      MEMORY_TYPES.NOTE,
      content,
      tags,
      source:    'note',
      relatedId: noteId,
    });
    Bus.emit(isUpdate ? EVENTS.MEMORY_UPDATED : EVENTS.MEMORY_CREATED, {
      relatedId: noteId,
      type:      MEMORY_TYPES.NOTE,
    });
  } catch (err) {
    console.error('[Memory] Failed to upsert note memory:', err);
  }
}

/**
 * Create or update the memory entry linked to a task.
 * Always reads the full task from DB — never trusts a partial changes object.
 */
export async function upsertMemoryForTask(taskId) {
  if (!taskId) return;
  try {
    const task = await DB.tasks.get(taskId);
    if (!task) return;
    const content  = _buildTaskContent(task);
    const tags     = _buildTaskTags(task);
    const isUpdate = !!(await DB.memories.getByRelatedId(taskId));
    await DB.memories.upsertByRelatedId(taskId, {
      type:      MEMORY_TYPES.TASK,
      content,
      tags,
      source:    'task',
      relatedId: taskId,
    });
    Bus.emit(isUpdate ? EVENTS.MEMORY_UPDATED : EVENTS.MEMORY_CREATED, {
      relatedId: taskId,
      type:      MEMORY_TYPES.TASK,
    });
  } catch (err) {
    console.error('[Memory] Failed to upsert task memory:', err);
  }
}

// ── Content builders ──────────────────────────────────────────

function _buildNoteContent(data) {
  const title   = data.title   ?? '';
  const content = data.content ?? '';
  const tags    = data.tags    ?? [];
  const summary = content.replace(/\n/g, ' ').trim().slice(0, 100);

  const parts = [`Note: "${title || 'Untitled'}"`];
  if (summary) parts.push(`Summary: ${summary}${content.length > 100 ? '…' : ''}`);
  if (tags.length) parts.push(`Tags: ${tags.join(', ')}`);
  return parts.join(' | ');
}

function _buildTaskContent(data) {
  const title       = data.title       ?? '';
  const status      = data.status      ?? 'pending';
  const priority    = data.priority    ?? 2;
  const description = data.description ?? '';
  const dueDate     = data.dueDate     ?? null;
  const completedAt = data.completedAt ?? null;

  const priorityLabel = priority === 1 ? 'High' : priority === 3 ? 'Low' : 'Medium';
  const parts = [`Task: "${title || 'Untitled'}"`];
  parts.push(`Status: ${status}`);
  parts.push(`Priority: ${priorityLabel}`);
  if (dueDate) parts.push(`Due: ${dueDate}`);
  if (completedAt) parts.push(`Completed: ${new Date(completedAt).toLocaleDateString()}`);
  if (description) parts.push(`Notes: ${description.slice(0, 80)}${description.length > 80 ? '…' : ''}`);
  return parts.join(' | ');
}

function _buildTaskTags(data) {
  const tags = ['task'];
  if (data.status) tags.push(data.status.replace('_', '-'));
  if (data.priority === 1) tags.push('high-priority');
  if (data.completedAt) tags.push('completed');
  return tags;
}

// ── General public API ────────────────────────────────────────

export async function rememberFact(type, content, tags = [], source = 'user') {
  if (!content?.trim()) return null;
  try {
    const id = await DB.memories.create({ type, content: content.trim(), tags, source });
    Bus.emit(EVENTS.MEMORY_CREATED, { id, type, source });
    return id;
  } catch (err) {
    console.error('[Memory] Failed to save memory:', err);
    return null;
  }
}

export async function getMemory(id) {
  return DB.memories.get(id);
}

export async function getAllMemories() {
  return DB.memories.getAll();
}

export async function getMemoriesByType(type) {
  return DB.memories.getByType(type);
}

export async function getRecentMemories(limit = 20) {
  return DB.memories.getRecent(limit);
}

export async function deleteMemory(id) {
  try {
    await DB.memories.delete(id);
    Bus.emit(EVENTS.MEMORY_DELETED, { id });
  } catch (err) {
    console.error('[Memory] Failed to delete memory:', err);
  }
}

export async function searchMemories(query) {
  return DB.memories.search(query);
}

export async function getMemoryCount() {
  return DB.memories.count();
}
