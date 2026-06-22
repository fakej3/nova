/**
 * NOVA Goals System
 *
 * Goals are chat-driven — created and queried through conversation.
 * No dedicated panel. Goals surface in daily briefings, system prompts,
 * and offline responses.
 *
 * Progress is computed live from linked tasks:
 *   progress = completedLinkedTasks / totalLinkedTasks × 100
 *   (0 if no linked tasks)
 */

import { DB }        from '../core/db.js';
import { Bus, EVENTS } from '../core/bus.js';
import { showToast } from '../ui/toast.js';

// ── Public API ────────────────────────────────────────────────

export async function createGoal(title, description = '', targetDate = null) {
  const id = await DB.goals.create({ title, description, targetDate });
  Bus.emit(EVENTS.GOAL_CREATED ?? 'goal:created', { id, title });
  showToast(`◎ Goal set: "${title.slice(0, 40)}"`, 'success', 2500);
  return id;
}

export async function completeGoal(id) {
  await DB.goals.update(id, { status: 'completed' });
  showToast('◎ Goal completed', 'success', 2000);
}

export async function linkTaskToGoal(goalId, taskId) {
  const goal = await DB.goals.get(goalId);
  if (!goal) return;
  const ids = [...new Set([...(goal.linkedTaskIds || []), taskId])];
  await DB.goals.update(goalId, { linkedTaskIds: ids });
}

/**
 * Load all active goals and compute progress from linked tasks.
 * Returns array of goal objects with a `progress` field (0–100).
 */
export async function getGoalsWithProgress() {
  const [allGoals, allTasks] = await Promise.all([
    DB.goals.getActive(),
    DB.tasks.getAll(),
  ]);

  return allGoals.map(g => {
    const linked    = allTasks.filter(t => (g.linkedTaskIds || []).includes(t.id));
    const completed = linked.filter(t => t.status === 'completed');
    const progress  = linked.length
      ? Math.round((completed.length / linked.length) * 100)
      : 0;
    return { ...g, progress, linkedCount: linked.length, completedCount: completed.length };
  });
}

/**
 * Return a short inline string for use in briefings.
 * Example: "Launch NOVA (60%) · Study economics (0%)"
 */
export function formatGoalsBrief(goalsWithProgress) {
  if (!goalsWithProgress.length) return '';
  return goalsWithProgress
    .slice(0, 3)
    .map(g => `"${g.title}" ${g.linkedCount ? `(${g.progress}%)` : '(no tasks linked)'}`)
    .join(' · ');
}

/**
 * Return a multi-line block for injection into Gemini system prompts.
 */
export function formatGoalsForContext(goalsWithProgress) {
  if (!goalsWithProgress.length) return 'No active goals.';
  return goalsWithProgress.map(g => {
    const due = g.targetDate
      ? ` · target ${new Date(g.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : '';
    const prog = g.linkedCount
      ? ` — ${g.progress}% (${g.completedCount}/${g.linkedCount} tasks)`
      : ' — no linked tasks';
    return `• "${g.title}"${prog}${due}`;
  }).join('\n');
}

/**
 * Find the best-matching active goal for a task title (for auto-linking suggestions).
 * Returns the goal or null.
 */
export async function findRelatedGoal(taskTitle) {
  const activeGoals = await DB.goals.getActive();
  if (!activeGoals.length) return null;

  const words = taskTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  let best = null, bestScore = 0;

  for (const g of activeGoals) {
    const hay   = (g.title + ' ' + g.description).toLowerCase();
    const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = g; }
  }
  return bestScore > 0 ? best : null;
}
