/**
 * NOVA Context Engine
 * Builds a structured snapshot of current system state on demand.
 * This is the data package that will be handed to Phase 3 AI as context.
 * No AI calls here — pure local data aggregation.
 */

import { DB } from '../core/db.js';

/**
 * Build and return a full context snapshot.
 * @returns {Promise<ContextSnapshot>}
 */
export async function buildContext() {
  const now = new Date();

  const [
    notesCount,
    pendingTasks,
    allTasksCount,
    recentEvents,
    memoriesCount,
  ] = await Promise.all([
    DB.notes.count(),
    DB.tasks.getByStatus('pending'),
    DB.tasks.count(),
    DB.events.getRecent(10),
    DB.memories.count(),
  ]);

  const recentActivity = recentEvents.map((e) => ({
    type:        e.type,
    description: e.description,
    timestamp:   e.timestamp,
  }));

  return {
    generated_at:        now.toISOString(),
    time:                now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    date:                now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    day_of_week:         now.toLocaleDateString('en-US', { weekday: 'long' }),
    notes_count:         notesCount ?? 0,
    pending_tasks_count: pendingTasks?.length ?? 0,
    total_tasks_count:   allTasksCount ?? 0,
    memories_count:      memoriesCount ?? 0,
    recent_activity:     recentActivity,
  };
}

/**
 * Return a compact single-line context summary string.
 * Useful for debug display and future AI prompt prefix.
 */
export async function buildContextSummary() {
  const ctx = await buildContext();
  return [
    `${ctx.day_of_week} ${ctx.date} ${ctx.time}`,
    `${ctx.notes_count} notes`,
    `${ctx.pending_tasks_count} pending tasks`,
    `${ctx.memories_count} memories`,
  ].join(' · ');
}
