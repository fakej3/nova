/**
 * NOVA Home Context Panel
 * Surfaces top task, active goal, and latest memory below the orb
 * when no panel is open. Updates reactively via Bus events.
 */

import { DB }                    from '../core/db.js';
import { Bus, EVENTS }           from '../core/bus.js';
import { State }                 from '../core/state.js';
import { getGoalsWithProgress }  from '../modules/goals.js';

const _el = () => document.getElementById('home-context');

// ── Public ────────────────────────────────────────────────────

export async function initHomeContext() {
  const el = _el();
  if (!el) return;

  await _render();

  // Refresh when data changes
  Bus.on(EVENTS.TASK_CREATED,   _render);
  Bus.on(EVENTS.TASK_COMPLETED, _render);
  Bus.on(EVENTS.TASK_UPDATED,   _render);
  Bus.on(EVENTS.GOAL_CREATED,   _render);
  Bus.on(EVENTS.GOAL_COMPLETED, _render);
  Bus.on(EVENTS.MEMORY_CREATED, _render);

  // Hide while panel is open, show when home
  Bus.on(EVENTS.PANEL_TOGGLE, ({ open }) => {
    if (el) el.classList.toggle('hc--hidden', open);
  });
}

// ── Internal ──────────────────────────────────────────────────

async function _render() {
  const el = _el();
  if (!el) return;

  try {
    const [tasks, goals, memories] = await Promise.all([
      DB.tasks.getAll(),
      getGoalsWithProgress(),
      DB.memories.getAll(),
    ]);

    const pending = tasks.filter(t => t.status !== 'completed');
    const now     = Date.now();

    const overdue   = pending.filter(t => t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString()));
    const dueToday  = pending.filter(t => t.dueDate && new Date(t.dueDate).toDateString() === new Date().toDateString());
    const focusTask = overdue[0] || dueToday[0] || pending.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5))[0];

    const activeGoal = goals.find(g => g.progress < 100);

    const facts    = memories.filter(m => m.type !== 'session_summary');
    const latestMem = facts.sort((a, b) => (b.updatedAt || b.timestamp) > (a.updatedAt || a.timestamp) ? 1 : -1)[0];

    const rows = [];

    if (focusTask) {
      const age   = Math.floor((now - new Date(focusTask.createdAt)) / 86400000);
      const badge = overdue.includes(focusTask)
        ? '<span class="hc-badge hc-badge--overdue">overdue</span>'
        : dueToday.includes(focusTask)
          ? '<span class="hc-badge hc-badge--today">today</span>'
          : '';
      rows.push(`
        <div class="hc-row">
          <span class="hc-label">FOCUS</span>
          <span class="hc-value">${_esc(focusTask.title)}${badge}</span>
        </div>`);
    }

    if (activeGoal) {
      rows.push(`
        <div class="hc-row">
          <span class="hc-label">GOAL</span>
          <span class="hc-value">${_esc(activeGoal.title)} <span class="hc-prog">${activeGoal.progress}%</span></span>
        </div>`);
    }

    if (latestMem) {
      rows.push(`
        <div class="hc-row">
          <span class="hc-label">MEMORY</span>
          <span class="hc-value hc-value--mem">${_esc(latestMem.content.slice(0, 70))}</span>
        </div>`);
    }

    el.innerHTML = rows.length
      ? rows.join('')
      : '<div class="hc-empty">Ask NOVA anything to get started</div>';

  } catch (err) {
    console.warn('[HomeContext]', err.message);
    el.innerHTML = '';
  }
}

function _esc(str) {
  return (str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
