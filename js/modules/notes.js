/**
 * NOVA Notes Module
 * Full CRUD. Manages its own panel UI when the notes view is active.
 */

import { DB } from '../core/db.js';
import { Bus, EVENTS } from '../core/bus.js';
import { logEvent, EVENT_TYPES } from '../services/events.js';
import { showToast } from '../ui/toast.js';
import { pulseOrb } from '../ui/orb.js';
import { escHtml } from '../core/utils.js';

let _panelContent = null;
let _currentView  = 'list'; // list | editor
let _editingId    = null;

export async function initNotes() {
  _panelContent = document.getElementById('panel-content');
}

export function renderNotesPanel() {
  _panelContent = document.getElementById('panel-content');
  _currentView  = 'list';
  _editingId    = null;
  _renderList();
}

// ── CRUD ──────────────────────────────────────────────────────

export async function createNote(title, content, tags = [], pinned = false) {
  const id = await DB.notes.create({ title, content, tags, pinned });
  await logEvent(EVENT_TYPES.NOTE_CREATED, `Note created: "${title || 'Untitled'}"`, id, 'notes');
  Bus.emit(EVENTS.NOTE_CREATED, { id, title });
  Bus.emit(EVENTS.FIRST_ACTION);
  pulseOrb();
  showToast('Note saved', 'success', 2000);
  return id;
}

export async function updateNote(id, changes) {
  await DB.notes.update(id, changes);
  await logEvent(EVENT_TYPES.NOTE_UPDATED, `Note updated: "${changes.title ?? ''}"`, id, 'notes');
  Bus.emit(EVENTS.NOTE_UPDATED, { id });
  showToast('Note updated', 'success', 2000);
}

export async function deleteNote(id) {
  const note = await DB.notes.get(id);
  await DB.notes.delete(id);
  await logEvent(EVENT_TYPES.NOTE_DELETED, `Note deleted: "${note?.title ?? id}"`, id, 'notes');
  Bus.emit(EVENTS.NOTE_DELETED, { id });
  showToast('Note deleted', 'info', 2000);
}

export async function searchNotes(query) {
  return DB.notes.search(query);
}

// ── Rendering ─────────────────────────────────────────────────

async function _renderList(query = '') {
  if (!_panelContent) return;
  _currentView = 'list';
  _editingId   = null;

  const all   = query ? await DB.notes.search(query) : await DB.notes.getAll();
  const notes = all.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return a.updatedAt > b.updatedAt ? -1 : 1;
  });

  _panelContent.innerHTML = `
    <div class="panel-actions">
      <button class="btn btn-primary btn-sm" id="notes-new-btn">+ New Note</button>
    </div>
    <div class="search-wrapper">
      <span class="search-icon" aria-hidden="true">⌕</span>
      <input
        type="search"
        class="search-input"
        id="notes-search"
        placeholder="Search notes..."
        value="${escHtml(query)}"
        aria-label="Search notes"
      />
    </div>
    <div id="notes-list" class="item-list" aria-label="Notes list">
      ${notes.length === 0 ? _emptyState() : notes.map(_noteCard).join('')}
    </div>
  `;

  document.getElementById('notes-new-btn')?.addEventListener('click', () => _renderEditor(null));

  const searchEl = document.getElementById('notes-search');
  let searchTimer;
  searchEl?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => _renderList(e.target.value), 250);
  });

  document.querySelectorAll('.note-card').forEach((el) => {
    el.addEventListener('click', () => _renderEditor(el.dataset.id));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') _renderEditor(el.dataset.id);
    });
  });
}

function _noteCard(note) {
  const date    = _formatDate(note.updatedAt);
  const preview = note.content.replace(/\n/g, ' ').slice(0, 120);
  const tags    = note.tags.slice(0, 3).map((t) => `<span class="tag">${escHtml(t)}</span>`).join('');

  return `
    <div class="card note-card card-appear ${note.pinned ? 'pinned' : ''}"
         data-id="${note.id}"
         tabindex="0"
         role="button"
         aria-label="Note: ${escHtml(note.title || 'Untitled')}"
    >
      <div class="card-title">${escHtml(note.title || 'Untitled')}</div>
      ${preview ? `<div class="card-preview">${escHtml(preview)}</div>` : ''}
      <div class="card-meta">
        <span class="card-date">${date}</span>
        ${tags}
        ${note.pinned ? '<span class="tag">📌 Pinned</span>' : ''}
      </div>
    </div>
  `;
}

async function _renderEditor(id) {
  if (!_panelContent) return;
  _currentView = 'editor';
  _editingId   = id;

  const note = id ? await DB.notes.get(id) : null;

  _panelContent.innerHTML = `
    <button class="back-btn" id="notes-back">← Back to Notes</button>
    <form class="editor-form" id="note-form" novalidate>
      <div class="form-group">
        <label class="form-label" for="note-title">Title</label>
        <input
          type="text"
          id="note-title"
          class="form-input"
          placeholder="Note title..."
          value="${escHtml(note?.title ?? '')}"
          maxlength="200"
          autocomplete="off"
        />
      </div>
      <div class="form-group">
        <label class="form-label" for="note-content">Content</label>
        <textarea
          id="note-content"
          class="form-textarea"
          placeholder="Start writing..."
          rows="8"
          style="min-height:160px"
        >${escHtml(note?.content ?? '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="note-tags">Tags <span style="font-weight:400;text-transform:none">(comma-separated)</span></label>
        <input
          type="text"
          id="note-tags"
          class="form-input"
          placeholder="work, idea, personal..."
          value="${escHtml((note?.tags ?? []).join(', '))}"
          autocomplete="off"
        />
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <label class="toggle-label">
          <input type="checkbox" id="note-pinned" ${note?.pinned ? 'checked' : ''} />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span class="toggle-text">Pin this note</span>
        </label>
      </div>
      <div class="editor-actions">
        ${id ? `<button type="button" class="btn btn-danger btn-sm" id="note-delete-btn">Delete</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" id="notes-cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm">${id ? 'Save Changes' : 'Create Note'}</button>
      </div>
    </form>
  `;

  document.getElementById('notes-back')?.addEventListener('click', () => _renderList());
  document.getElementById('notes-cancel-btn')?.addEventListener('click', () => _renderList());

  document.getElementById('note-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await _handleSave(id);
  });

  document.getElementById('note-delete-btn')?.addEventListener('click', async () => {
    if (!id) return;
    await deleteNote(id);
    _renderList();
  });

  // Focus title input
  document.getElementById('note-title')?.focus();
}

async function _handleSave(id) {
  const title  = document.getElementById('note-title')?.value.trim()  ?? '';
  const content = document.getElementById('note-content')?.value        ?? '';
  const tagsRaw = document.getElementById('note-tags')?.value           ?? '';
  const pinned  = document.getElementById('note-pinned')?.checked       ?? false;
  const tags    = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);

  if (id) {
    await updateNote(id, { title, content, tags, pinned });
  } else {
    await createNote(title, content, tags, pinned);
  }
  _renderList();
}

// ── Helpers ───────────────────────────────────────────────────

function _emptyState() {
  return `
    <div class="empty-state">
      <div class="empty-icon" aria-hidden="true">◈</div>
      <div class="empty-title">No notes yet</div>
      <div class="empty-desc">Create your first note to get started.</div>
    </div>
  `;
}

function _formatDate(iso) {
  if (!iso) return '';
  const d   = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000)   return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

