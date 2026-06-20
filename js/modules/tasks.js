/**
 * NOVA Tasks Module
 * Full CRUD. Manages its own panel UI when the tasks view is active.
 */

import { DB } from '../core/db.js';
import { Bus, EVENTS } from '../core/bus.js';
import { logEvent, EVENT_TYPES } from '../services/events.js';
import { showToast } from '../ui/toast.js';
import { pulseOrb } from '../ui/orb.js';
import { escHtml } from '../core/utils.js';
import { upsertMemoryForTask } from '../services/memory.js';

let _panelContent   = null;
let _activeFilter   = 'all';  // all | pending | in_progress | completed
let _currentView    = 'list'; // list | editor
let _editingId      = null;

export async function initTasks() {
  _panelContent = document.getElementById('panel-content');
}

export function renderTasksPanel() {
  _panelContent = document.getElementById('panel-content');
  _currentView  = 'list';
  _editingId    = null;
  _renderList(_activeFilter);
}

// ── CRUD ──────────────────────────────────────────────────────

export async function createTask(title, description = '', priority = 2, dueDate = null) {
  const id = await DB.tasks.create({ title, description, priority, dueDate, status: 'pending' });
  await logEvent(EVENT_TYPES.TASK_CREATED, `Task created: "${title}"`, id, 'tasks');
  Bus.emit(EVENTS.TASK_CREATED, { id, title });
  Bus.emit(EVENTS.FIRST_ACTION);
  pulseOrb();
  showToast('Task created', 'success', 2000);
  upsertMemoryForTask(id);
  return id;
}

export async function updateTask(id, changes) {
  await DB.tasks.update(id, changes);
  await logEvent(EVENT_TYPES.TASK_UPDATED, `Task updated: "${changes.title ?? id}"`, id, 'tasks');
  Bus.emit(EVENTS.TASK_UPDATED, { id });
  showToast('Task updated', 'success', 2000);
}

export async function completeTask(id) {
  const task = await DB.tasks.get(id);
  if (!task) return;

  // Toggle: if already completed, revert to pending
  if (task.status === 'completed') {
    await DB.tasks.update(id, { status: 'pending', completedAt: null });
    await logEvent(EVENT_TYPES.TASK_UPDATED, `Task reopened: "${task.title}"`, id, 'tasks');
    Bus.emit(EVENTS.TASK_UPDATED, { id });
    showToast('Task reopened', 'info', 2000);
    upsertMemoryForTask(id);
  } else {
    const completedAt = new Date().toISOString();
    await DB.tasks.update(id, { status: 'completed', completedAt });
    await logEvent(EVENT_TYPES.TASK_COMPLETED, `Task completed: "${task.title}"`, id, 'tasks');
    Bus.emit(EVENTS.TASK_COMPLETED, { id });
    pulseOrb();
    showToast('Task complete! 🎉', 'success', 2500);
    upsertMemoryForTask(id);
  }
}

export async function deleteTask(id) {
  const task = await DB.tasks.get(id);
  await DB.tasks.delete(id);
  await logEvent(EVENT_TYPES.TASK_DELETED, `Task deleted: "${task?.title ?? id}"`, id, 'tasks');
  Bus.emit(EVENTS.TASK_DELETED, { id });
  showToast('Task deleted', 'info', 2000);
  _deleteLinkedMemory(id);
}

async function _deleteLinkedMemory(sourceId) {
  try {
    const mem = await DB.memories.getByRelatedId(sourceId);
    if (mem) await DB.memories.delete(mem.id);
  } catch (err) {
    console.error('[Memory] Failed to delete linked memory:', err);
  }
}

// Navigate directly to a task's editor — used by search-panel result clicks.
export async function openTask(id) {
  _panelContent = document.getElementById('panel-content');
  _renderEditor(id);
}

// ── Rendering ─────────────────────────────────────────────────

async function _renderList(filter = 'all') {
  if (!_panelContent) return;
  _currentView  = 'list';
  _editingId    = null;
  _activeFilter = filter;

  const allTasks = await DB.tasks.getAll();
  const filtered = _filterTasks(allTasks, filter);
  const sorted   = filtered.sort((a, b) => {
    // Pending > in_progress > completed, then by priority, then createdAt
    const statusOrder = { pending: 0, in_progress: 1, completed: 2, cancelled: 3 };
    const so = statusOrder[a.status] - statusOrder[b.status];
    if (so !== 0) return so;
    const po = a.priority - b.priority;
    if (po !== 0) return po;
    return a.createdAt > b.createdAt ? -1 : 1;
  });

  const counts = {
    all:         allTasks.length,
    pending:     allTasks.filter((t) => t.status === 'pending').length,
    in_progress: allTasks.filter((t) => t.status === 'in_progress').length,
    completed:   allTasks.filter((t) => t.status === 'completed').length,
  };

  _panelContent.innerHTML = `
    <div class="panel-actions">
      <button class="btn btn-primary btn-sm" id="tasks-new-btn">+ New Task</button>
    </div>
    <div class="filter-tabs" role="tablist" aria-label="Filter tasks">
      ${_filterTab('all',         'All',         counts.all,         filter)}
      ${_filterTab('pending',     'Pending',     counts.pending,     filter)}
      ${_filterTab('in_progress', 'In Progress', counts.in_progress, filter)}
      ${_filterTab('completed',   'Done',        counts.completed,   filter)}
    </div>
    <div id="tasks-list" class="item-list" aria-label="Tasks list">
      ${sorted.length === 0 ? _emptyState(filter) : sorted.map(_taskCard).join('')}
    </div>
  `;

  document.getElementById('tasks-new-btn')?.addEventListener('click', () => _renderEditor(null));

  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => _renderList(tab.dataset.filter));
  });

  document.querySelectorAll('.task-checkbox').forEach((cb) => {
    cb.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = cb.closest('.task-card')?.dataset.id;
      if (id) {
        await completeTask(id);
        _renderList(_activeFilter);
      }
    });
  });

  document.querySelectorAll('.task-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('task-checkbox')) return;
      _renderEditor(card.dataset.id);
    });
  });
}

function _filterTasks(tasks, filter) {
  if (filter === 'all') return tasks;
  if (filter === 'in_progress') return tasks.filter((t) => t.status === 'in_progress');
  return tasks.filter((t) => t.status === filter);
}

function _filterTab(key, label, count, active) {
  return `
    <button
      class="filter-tab ${active === key ? 'active' : ''}"
      data-filter="${key}"
      role="tab"
      aria-selected="${active === key}"
    >
      ${label}${count > 0 ? ` <span class="count-badge">${count}</span>` : ''}
    </button>
  `;
}

function _taskCard(task) {
  const isComplete = task.status === 'completed';
  const priority   = _priorityLabel(task.priority);
  const due        = task.dueDate ? _dueDateLabel(task.dueDate) : null;
  const overdue    = task.dueDate && !isComplete && new Date(task.dueDate) < new Date();

  return `
    <div class="task-card card-appear" data-id="${task.id}" role="listitem">
      <div
        class="task-checkbox ${isComplete ? 'checked' : ''}"
        title="${isComplete ? 'Mark as pending' : 'Mark as complete'}"
        aria-label="${isComplete ? 'Reopen task' : 'Complete task'}"
        role="button"
        tabindex="0"
      ></div>
      <div class="task-body">
        <div class="task-title ${isComplete ? 'completed' : ''}">${escHtml(task.title)}</div>
        ${task.description ? `<div class="task-desc">${escHtml(task.description)}</div>` : ''}
        <div class="task-meta">
          <span class="priority-badge priority-${task.priority}">${priority}</span>
          <span class="status-badge status-${task.status.replace('_', '-')}">${_statusLabel(task.status)}</span>
          ${due ? `<span class="task-due ${overdue ? 'overdue' : ''}">${due}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

async function _renderEditor(id) {
  if (!_panelContent) return;
  _currentView = 'editor';
  _editingId   = id;

  const task = id ? await DB.tasks.get(id) : null;

  _panelContent.innerHTML = `
    <button class="back-btn" id="tasks-back">← Back to Tasks</button>
    <form class="editor-form" id="task-form" novalidate>
      <div class="form-group">
        <label class="form-label" for="task-title">Title *</label>
        <input
          type="text"
          id="task-title"
          class="form-input"
          placeholder="What needs to be done?"
          value="${escHtml(task?.title ?? '')}"
          maxlength="200"
          required
          autocomplete="off"
        />
      </div>
      <div class="form-group">
        <label class="form-label" for="task-desc">Description</label>
        <textarea
          id="task-desc"
          class="form-textarea"
          placeholder="Additional details..."
          rows="4"
        >${escHtml(task?.description ?? '')}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label" for="task-priority">Priority</label>
          <select id="task-priority" class="form-select">
            <option value="1" ${task?.priority === 1 ? 'selected' : ''}>🔴 High</option>
            <option value="2" ${(!task || task?.priority === 2) ? 'selected' : ''}>🟡 Medium</option>
            <option value="3" ${task?.priority === 3 ? 'selected' : ''}>🟢 Low</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="task-status">Status</label>
          <select id="task-status" class="form-select">
            <option value="pending"     ${(!task || task?.status === 'pending')     ? 'selected' : ''}>Pending</option>
            <option value="in_progress" ${task?.status === 'in_progress'           ? 'selected' : ''}>In Progress</option>
            <option value="completed"   ${task?.status === 'completed'             ? 'selected' : ''}>Completed</option>
            <option value="cancelled"   ${task?.status === 'cancelled'             ? 'selected' : ''}>Cancelled</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="task-due">Due Date</label>
        <input
          type="date"
          id="task-due"
          class="form-input"
          value="${task?.dueDate ?? ''}"
        />
      </div>
      <div class="editor-actions">
        ${id ? `<button type="button" class="btn btn-danger btn-sm" id="task-delete-btn">Delete</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" id="tasks-cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm">${id ? 'Save Changes' : 'Create Task'}</button>
      </div>
    </form>
  `;

  document.getElementById('tasks-back')?.addEventListener('click', () => _renderList(_activeFilter));
  document.getElementById('tasks-cancel-btn')?.addEventListener('click', () => _renderList(_activeFilter));

  document.getElementById('task-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await _handleSave(id);
  });

  document.getElementById('task-delete-btn')?.addEventListener('click', async () => {
    if (!id) return;
    await deleteTask(id);
    _renderList(_activeFilter);
  });

  document.getElementById('task-title')?.focus();
}

async function _handleSave(id) {
  const title       = document.getElementById('task-title')?.value.trim()    ?? '';
  const description = document.getElementById('task-desc')?.value.trim()     ?? '';
  const priority    = parseInt(document.getElementById('task-priority')?.value ?? '2', 10);
  const status      = document.getElementById('task-status')?.value           ?? 'pending';
  const dueDate     = document.getElementById('task-due')?.value              || null;

  if (!title) {
    showToast('Please enter a task title', 'warning');
    document.getElementById('task-title')?.focus();
    return;
  }

  const changes = { title, description, priority, status, dueDate };
  if (status === 'completed') {
    changes.completedAt = new Date().toISOString();
  }

  if (id) {
    const prev = await DB.tasks.get(id);
    await updateTask(id, changes);
    // Emit TASK_COMPLETED if status changed to completed via the editor form
    if (status === 'completed' && prev?.status !== 'completed') {
      Bus.emit(EVENTS.TASK_COMPLETED, { id });
      pulseOrb();
    }
    upsertMemoryForTask(id);
  } else {
    await createTask(title, description, priority, dueDate);
  }
  _renderList(_activeFilter);
}

// ── Helpers ───────────────────────────────────────────────────

function _emptyState(filter) {
  const msgs = {
    all:         ['No tasks yet', 'Create your first task to get started.'],
    pending:     ['No pending tasks', 'Everything is done — or create something new.'],
    in_progress: ['Nothing in progress', 'Start working on a task to see it here.'],
    completed:   ['No completed tasks', 'Complete a task to see it here.'],
  };
  const [title, desc] = msgs[filter] ?? msgs.all;
  return `
    <div class="empty-state">
      <div class="empty-icon" aria-hidden="true">◎</div>
      <div class="empty-title">${title}</div>
      <div class="empty-desc">${desc}</div>
    </div>
  `;
}

function _priorityLabel(p) {
  return p === 1 ? 'High' : p === 3 ? 'Low' : 'Medium';
}

function _statusLabel(s) {
  const labels = { pending: 'Pending', in_progress: 'In Progress', completed: 'Done', cancelled: 'Cancelled' };
  return labels[s] ?? s;
}

function _dueDateLabel(dateStr) {
  const d   = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const diff = Math.floor((d - now) / 86_400_000);
  if (diff < 0)  return `Overdue by ${Math.abs(diff)}d`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  return `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

