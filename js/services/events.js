/**
 * NOVA Event Logging Service
 * Single point of entry for all activity events.
 * Call logEvent() from any module. Never write to DB.events directly.
 */

import { DB } from '../core/db.js';
import { Bus, EVENTS } from '../core/bus.js';

export const EVENT_TYPES = {
  APP_STARTED:      'app_started',
  NOTE_CREATED:     'note_created',
  NOTE_UPDATED:     'note_updated',
  NOTE_DELETED:     'note_deleted',
  TASK_CREATED:     'task_created',
  TASK_UPDATED:     'task_updated',
  TASK_COMPLETED:   'task_completed',
  TASK_DELETED:     'task_deleted',
  THEME_CHANGED:    'theme_changed',
  VIEW_CHANGED:     'view_changed',
  SETTINGS_UPDATED: 'settings_updated',
};

/**
 * @param {string} type         - One of EVENT_TYPES values
 * @param {string} description  - Human-readable description
 * @param {string|null} relatedId    - UUID of the triggering record (optional)
 * @param {string|null} relatedTable - Table name of the triggering record (optional)
 * @returns {Promise<string>} The created event's id
 */
export async function logEvent(type, description, relatedId = null, relatedTable = null) {
  try {
    const id = await DB.events.create({ type, description, relatedId, relatedTable });
    Bus.emit(EVENTS.EVENT_LOGGED, { id, type, description, relatedId, relatedTable });
    return id;
  } catch (err) {
    console.error('[EventService] Failed to log event:', err);
    return null;
  }
}
