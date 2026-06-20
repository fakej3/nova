/**
 * NOVA Boot Sequence
 * Initializes all modules in order. Wires together the entire app.
 * This is the only file that imports from every other module.
 */

import { DB }                       from './db.js';
import { State }                    from './state.js';
import { Bus, EVENTS }              from './bus.js';
import { logEvent, EVENT_TYPES }    from '../services/events.js';
import { initOrb, setOrbState }     from '../ui/orb.js';
import { initThemeEngine, applyTheme, setAutoTheme } from '../ui/theme.js';
import { initClock }                from '../ui/clock.js';
import { initParticles }            from '../ui/particles.js';
import { initToasts, showToast }    from '../ui/toast.js';
import { initInstallPrompt, renderInstallSection, triggerInstall } from '../ui/install.js';
import { initNotes, renderNotesPanel } from '../modules/notes.js';
import { initTasks, renderTasksPanel } from '../modules/tasks.js';
import { initMouse }                   from '../ui/mouse.js';
import { initHud }                     from '../ui/hud.js';

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

    // 8b. Mouse parallax + HUD (after DOM is ready, before modules)
    initMouse();
    await initHud();

    // 9. Init modules
    await initNotes();
    await initTasks();

    // 10. Wire UI
    _wireNavigation();
    _wirePanel();
    _wireInputBar();
    _wireSettings();
    _wireConnectivity();

    // 11. PWA install prompt
    await initInstallPrompt();
    _wireInstallIndicator();

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
    dot.addEventListener('click', () => {
      const view = dot.dataset.view;
      _switchView(view);
    });
    dot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const view = dot.dataset.view;
        _switchView(view);
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
    // Same view clicked again — toggle panel
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
  logEvent(EVENT_TYPES.VIEW_CHANGED, `Switched to ${view} view`);
}

// ── Panel ─────────────────────────────────────────────────────

function _wirePanel() {
  const panel   = document.getElementById('panel');
  const backdrop = document.getElementById('panel-backdrop');
  const closeBtn = document.getElementById('panel-close');

  closeBtn?.addEventListener('click', _closePanel);
  backdrop?.addEventListener('click', _closePanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && State.get('panelOpen')) _closePanel();
  });
}

function _openPanel(view) {
  const panel    = document.getElementById('panel');
  const backdrop = document.getElementById('panel-backdrop');
  const title    = document.getElementById('panel-title');

  const labels = { notes: 'Notes', tasks: 'Tasks', events: 'Activity Log' };

  if (title) title.textContent = labels[view] ?? view;
  if (panel) panel.setAttribute('aria-hidden', 'false');
  if (backdrop) backdrop.classList.add('visible');

  State.set('panelOpen', true);
  Bus.emit(EVENTS.PANEL_TOGGLE, { open: true, view });

  // Render view content
  if (view === 'notes') renderNotesPanel();
  if (view === 'tasks') renderTasksPanel();
  if (view === 'events') _renderEventsPanel();

  // Focus first focusable element in panel
  requestAnimationFrame(() => {
    panel?.querySelector('button, input, [tabindex="0"]')?.focus();
  });
}

function _closePanel() {
  const panel    = document.getElementById('panel');
  const backdrop = document.getElementById('panel-backdrop');

  if (panel) panel.setAttribute('aria-hidden', 'true');
  if (backdrop) backdrop.classList.remove('visible');

  State.set('panelOpen', false);
  State.set('activeView', 'home');
  Bus.emit(EVENTS.PANEL_TOGGLE, { open: false });
  Bus.emit(EVENTS.VIEW_CHANGED, { view: 'home' });
}

// ── Events panel ──────────────────────────────────────────────

async function _renderEventsPanel() {
  const content = document.getElementById('panel-content');
  if (!content) return;

  const events = await DB.events.getRecent(100);

  if (events.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">◉</div>
        <div class="empty-title">No activity yet</div>
        <div class="empty-desc">Events will appear here as you use NOVA.</div>
      </div>
    `;
    return;
  }

  const items = events
    .map((ev) => {
      const time = _formatEventTime(ev.timestamp);
      return `
        <div class="event-item">
          <div class="event-dot" aria-hidden="true"></div>
          <div class="event-body">
            <div class="event-desc">${_escHtml(ev.description)}</div>
            <div class="event-time">${time}</div>
          </div>
        </div>
      `;
    })
    .join('');

  content.innerHTML = `
    <div class="section-header">
      <span class="section-title">Recent Activity</span>
      <span class="count-badge">${events.length}</span>
    </div>
    ${items}
  `;
}

function _formatEventTime(iso) {
  if (!iso) return '';
  const d   = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000)    return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Refresh events panel if it's open when a new event is logged
Bus.on(EVENTS.EVENT_LOGGED, () => {
  if (State.get('activeView') === 'events' && State.get('panelOpen')) {
    _renderEventsPanel();
  }
});

// ── Input Bar ─────────────────────────────────────────────────

function _wireInputBar() {
  const input   = document.getElementById('nova-input');
  const sendBtn = document.getElementById('send-btn');

  const handleSubmit = () => {
    const value = input?.value.trim();
    if (!value) return;
    input.value = '';
    showToast('AI integration coming in Phase 2 — but I heard you!', 'info', 4000);
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
  const settingsBtn   = document.getElementById('settings-btn');
  const modal         = document.getElementById('settings-modal');
  const closeBtn      = modal?.querySelector('.modal-close');
  const backdrop      = modal?.querySelector('.modal-backdrop');
  const saveBtn       = document.getElementById('settings-save');
  const themePicker   = document.getElementById('theme-picker');
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
  const modal     = document.getElementById('settings-modal');
  const aiInput   = document.getElementById('setting-ai-name');
  const userInput = document.getElementById('setting-user-name');
  const autoToggle = document.getElementById('setting-auto-theme');

  if (aiInput)    aiInput.value        = State.get('aiName')    ?? 'NOVA';
  if (userInput)  userInput.value      = State.get('userName')  ?? '';
  if (autoToggle) autoToggle.checked   = State.get('autoTheme') ?? false;

  // Render install section with current state every time settings opens
  renderInstallSection();

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

// ── Install indicator ─────────────────────────────────────────

function _wireInstallIndicator() {
  const indicator = document.getElementById('install-indicator');
  if (!indicator) return;

  // Clicking the main-screen badge opens Settings directly to the install section
  indicator.addEventListener('click', () => {
    _openSettings();
  });
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
  // Set initial state
  State.set('connectivity', navigator.onLine);
  if (dot) dot.classList.toggle('offline', !navigator.onLine);
}

// ── Helpers ───────────────────────────────────────────────────

function _escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Run ───────────────────────────────────────────────────────

boot();
