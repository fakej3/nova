/**
 * NOVA Boot Sequence
 * Initializes all modules in order. Wires together the entire app.
 * This is the only file that imports from every other module.
 */

import { DB }                       from './db.js';
import { State }                    from './state.js';
import { Bus, EVENTS }              from './bus.js';
import { escHtml }                  from './utils.js';
import { logEvent, EVENT_TYPES }    from '../services/events.js';
import { initOrb, setOrbState }     from '../ui/orb.js';
import { initThemeEngine, applyTheme, setAutoTheme } from '../ui/theme.js';
import { initClock }                from '../ui/clock.js';
import { initParticles }            from '../ui/particles.js';
import { initToasts, showToast }    from '../ui/toast.js';
import { initInstallPrompt, renderInstallSection, triggerInstall } from '../ui/install.js';
import { initNotes, renderNotesPanel, openNote } from '../modules/notes.js';
import { initTasks, renderTasksPanel, openTask } from '../modules/tasks.js';
import { initAwareness }               from '../ui/awareness.js';
import { initReactor }                 from '../ui/reactor.js';
import { initMouse }                   from '../ui/mouse.js';
import { initHud }                     from '../ui/hud.js';
import { renderDiagnosticsPanel }      from '../ui/diagnostics.js';
import { renderSearchPanel }           from '../modules/search-panel.js';
import { renderMemoriesPanel }         from '../modules/memories-panel.js';
import { renderTimeline }              from '../modules/timeline.js';

// ── Boot ──────────────────────────────────────────────────────

async function boot() {
  try {
    // 1. Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('./sw.js')
        .catch((err) => console.warn('[SW] Registration failed:', err));
    }

    // 2. Init toasts early so we can surface errors
    initToasts();

    // 3. Orb to thinking during load
    initOrb();
    setOrbState('thinking');

    // 4. Open database
    await DB.init();

    // 5. Load persisted settings into State
    await _loadSettings();

    // 6. Apply theme (no-transition on first paint)
    await initThemeEngine();

    // 7. Start clock
    initClock();

    // 8. Start particles
    initParticles();

    // 8b. Awareness system (before mouse and HUD so they can read it)
    initAwareness();

    // 8c. Mouse parallax + HUD + reactor core
    initMouse();
    await initHud();
    initReactor();

    // 9. Init modules
    await initNotes();
    await initTasks();

    // 10. Wire UI
    _wireNavigation();
    _wirePanel();
    _wireInputBar();
    _wireSettings();
    _wireConnectivity();
    _wireKeyboardShortcuts();
    _wireOpenResult();

    // Refresh timeline if open when a new event is logged
    Bus.on(EVENTS.EVENT_LOGGED, () => {
      if (State.get('activeView') === 'events' && State.get('panelOpen')) {
        renderTimeline();
      }
    });

    // Refresh memories panel if open when a memory changes
    const _refreshMemories = () => {
      if (State.get('activeView') === 'memories' && State.get('panelOpen')) {
        renderMemoriesPanel();
      }
    };
    Bus.on(EVENTS.MEMORY_CREATED, _refreshMemories);
    Bus.on(EVENTS.MEMORY_UPDATED, _refreshMemories);
    Bus.on(EVENTS.MEMORY_DELETED, _refreshMemories);

    // 11. PWA install prompt
    await initInstallPrompt();
    _wireInstallIndicator();

    // 11b. Wire diagnostics panel (Phase 2)
    _wireDiagnostics();

    // 12. Done
    State.set('initialized', true);
    setOrbState('idle');
    _updateAiNameDisplay();

    await logEvent(EVENT_TYPES.APP_STARTED, 'NOVA started');

  } catch (err) {
    console.error('[NOVA] Boot failed:', err);
    setOrbState('offline');
    showToast('Failed to initialize NOVA. Please refresh.', 'error', 0);
  }
}

// ── Settings loader ───────────────────────────────────────────

async function _loadSettings() {
  const aiName   = await DB.settings.get('aiName');
  const userName = await DB.settings.get('userName');
  const autoTheme = await DB.settings.get('autoTheme');

  if (aiName)   State.set('aiName',    aiName);
  if (userName) State.set('userName',  userName);
  if (autoTheme !== null) State.set('autoTheme', autoTheme);
}

// ── Navigation ────────────────────────────────────────────────

function _wireNavigation() {
  const navDots = document.querySelectorAll('.nav-dot');

  navDots.forEach((dot) => {
    dot.addEventListener('click', () => _switchView(dot.dataset.view));
    dot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _switchView(dot.dataset.view);
      }
    });
  });

  Bus.on(EVENTS.VIEW_CHANGED, ({ view }) => {
    navDots.forEach((d) => {
      const isActive = d.dataset.view === view;
      d.classList.toggle('active', isActive);
      d.setAttribute('aria-pressed', String(isActive));
    });
  });
}

function _switchView(view) {
  const prev = State.get('activeView');
  if (view === prev && State.get('panelOpen')) {
    _closePanel();
    return;
  }

  State.set('activeView', view);
  Bus.emit(EVENTS.VIEW_CHANGED, { view });

  if (view === 'home') {
    _closePanel();
    return;
  }

  _openPanel(view);
  if (view !== 'search') {
    logEvent(EVENT_TYPES.VIEW_CHANGED, `Switched to ${view} view`);
  }
}

// ── Panel ─────────────────────────────────────────────────────

function _wirePanel() {
  const closeBtn  = document.getElementById('panel-close');
  const backdrop  = document.getElementById('panel-backdrop');

  closeBtn?.addEventListener('click', _closePanel);
  backdrop?.addEventListener('click', _closePanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && State.get('panelOpen')) _closePanel();
  });
}

const VIEW_LABELS = {
  notes:    'Notes',
  tasks:    'Tasks',
  events:   'Timeline',
  memories: 'Memories',
  search:   'Search',
};

function _openPanel(view) {
  const panel    = document.getElementById('panel');
  const backdrop = document.getElementById('panel-backdrop');
  const title    = document.getElementById('panel-title');

  if (title)    title.textContent = VIEW_LABELS[view] ?? view;
  if (panel)    panel.setAttribute('aria-hidden', 'false');
  if (backdrop) backdrop.classList.add('visible');

  State.set('panelOpen', true);
  Bus.emit(EVENTS.PANEL_TOGGLE, { open: true, view });

  if (view === 'notes')    renderNotesPanel();
  if (view === 'tasks')    renderTasksPanel();
  if (view === 'events')   renderTimeline();
  if (view === 'memories') renderMemoriesPanel();
  if (view === 'search')   renderSearchPanel();

  requestAnimationFrame(() => {
    panel?.querySelector('button, input, [tabindex="0"]')?.focus();
  });
}

function _closePanel() {
  const panel    = document.getElementById('panel');
  const backdrop = document.getElementById('panel-backdrop');

  if (panel)    panel.setAttribute('aria-hidden', 'true');
  if (backdrop) backdrop.classList.remove('visible');

  State.set('panelOpen', false);
  State.set('activeView', 'home');
  Bus.emit(EVENTS.PANEL_TOGGLE, { open: false });
  Bus.emit(EVENTS.VIEW_CHANGED, { view: 'home' });
}

// ── Keyboard shortcuts ────────────────────────────────────────

function _wireKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Cmd+K / Ctrl+K — open global search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const current = State.get('activeView');
      if (current === 'search' && State.get('panelOpen')) {
        // Focus the search input if already open
        document.getElementById('sp-input')?.focus();
      } else {
        _switchView('search');
      }
    }
  });
}

// ── Open search result ────────────────────────────────────────

function _wireOpenResult() {
  document.addEventListener('nova:open-result', async (e) => {
    const { type, id } = e.detail;

    if (type === 'note') {
      _switchView('notes');
      // Wait for notes panel to render, then open editor
      requestAnimationFrame(() => openNote(id));
      return;
    }
    if (type === 'task') {
      _switchView('tasks');
      requestAnimationFrame(() => openTask(id));
      return;
    }
    if (type === 'event') {
      _switchView('events');
      return;
    }
    if (type === 'memory') {
      _switchView('memories');
      return;
    }
  });
}

// ── Input Bar ─────────────────────────────────────────────────

function _wireInputBar() {
  const input   = document.getElementById('nova-input');
  const sendBtn = document.getElementById('send-btn');

  const handleSubmit = () => {
    const value = input?.value.trim();
    if (!value) return;
    input.value = '';
    showToast('AI integration coming in Phase 3 — but I heard you!', 'info', 4000);
    setOrbState('thinking');
    setTimeout(() => setOrbState('idle'), 2000);
    logEvent('conversation_attempted', `User said: "${value.slice(0, 80)}${value.length > 80 ? '…' : ''}"`);
  };

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  });

  sendBtn?.addEventListener('click', handleSubmit);
}

// ── Settings ──────────────────────────────────────────────────

function _wireSettings() {
  const settingsBtn     = document.getElementById('settings-btn');
  const modal           = document.getElementById('settings-modal');
  const closeBtn        = modal?.querySelector('.modal-close');
  const backdrop        = modal?.querySelector('.modal-backdrop');
  const saveBtn         = document.getElementById('settings-save');
  const themePicker     = document.getElementById('theme-picker');
  const autoThemeToggle = document.getElementById('setting-auto-theme');

  settingsBtn?.addEventListener('click', _openSettings);
  closeBtn?.addEventListener('click',    _closeSettings);
  backdrop?.addEventListener('click',    _closeSettings);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal?.hidden) _closeSettings();
  });

  themePicker?.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-option');
    if (!btn) return;
    applyTheme(btn.dataset.theme);
  });

  saveBtn?.addEventListener('click', _saveSettings);
}

function _openSettings() {
  const modal      = document.getElementById('settings-modal');
  const aiInput    = document.getElementById('setting-ai-name');
  const userInput  = document.getElementById('setting-user-name');
  const autoToggle = document.getElementById('setting-auto-theme');

  if (aiInput)    aiInput.value      = State.get('aiName')    ?? 'NOVA';
  if (userInput)  userInput.value    = State.get('userName')  ?? '';
  if (autoToggle) autoToggle.checked = State.get('autoTheme') ?? false;

  renderInstallSection();
  renderDiagnosticsPanel();

  if (modal) modal.hidden = false;
  aiInput?.focus();
}

function _closeSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.hidden = true;
}

async function _saveSettings() {
  const aiName    = document.getElementById('setting-ai-name')?.value.trim()   || 'NOVA';
  const userName  = document.getElementById('setting-user-name')?.value.trim() || '';
  const autoTheme = document.getElementById('setting-auto-theme')?.checked     ?? false;

  State.set('aiName',    aiName);
  State.set('userName',  userName);
  State.set('autoTheme', autoTheme);

  await DB.settings.set('aiName',    aiName);
  await DB.settings.set('userName',  userName);
  await DB.settings.set('autoTheme', autoTheme);

  setAutoTheme(autoTheme);
  _updateAiNameDisplay();
  _closeSettings();
  await logEvent(EVENT_TYPES.SETTINGS_UPDATED, 'Settings updated');
  Bus.emit(EVENTS.SETTINGS_SAVED, { aiName, userName, autoTheme });
  showToast('Settings saved', 'success', 2000);
}

function _updateAiNameDisplay() {
  const el = document.getElementById('ai-name-display');
  if (el) el.textContent = State.get('aiName') || 'NOVA';
}

// ── Diagnostics ───────────────────────────────────────────────

function _wireDiagnostics() {
  // Re-renders whenever Settings opens (handled in _openSettings).
}

// ── Install indicator ─────────────────────────────────────────

function _wireInstallIndicator() {
  const indicator = document.getElementById('install-indicator');
  indicator?.addEventListener('click', () => _openSettings());
}

// ── Connectivity ──────────────────────────────────────────────

function _wireConnectivity() {
  const dot = document.getElementById('connectivity-dot');

  function updateDot() {
    const online = navigator.onLine;
    State.set('connectivity', online);
    if (dot) {
      dot.classList.toggle('offline', !online);
      dot.title = online ? 'Online' : 'Offline';
    }
    setOrbState(online ? 'idle' : 'offline');
    if (!online) {
      showToast('You are offline. NOVA continues to work locally.', 'warning', 4000);
      Bus.emit(EVENTS.OFFLINE);
    } else {
      Bus.emit(EVENTS.ONLINE);
    }
  }

  window.addEventListener('online',  updateDot);
  window.addEventListener('offline', updateDot);
  State.set('connectivity', navigator.onLine);
  if (dot) dot.classList.toggle('offline', !navigator.onLine);
}

// ── Run ───────────────────────────────────────────────────────

boot();
