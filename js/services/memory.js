/**
 * NOVA Memory Engine
 * Service layer for the memories store.
 * Memories are discrete, typed facts the system accumulates over time.
 * They will feed Phase 3 AI context — for now they are stored and queryable.
 */

import { DB }          from '../core/db.js';
import { Bus, EVENTS } from '../core/bus.js';

export const MEMORY_TYPES = {
  NOTE:   'note',
  TASK:   'task',
  EVENT:  'event',
  MEMORY: 'memory',
};

/**
 * Save a new memory entry.
 * @param {string} type    - One of MEMORY_TYPES
 * @param {string} content - The memory content
 * @param {string[]} tags  - Optional tags
 * @param {string} source  - Where this memory came from (e.g. 'user', 'system', 'note')
 */
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
