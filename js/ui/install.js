/**
 * NOVA PWA Install System
 * Diagnoses install availability, never leaves UI stuck.
 * Logs every decision to console with [NOVA Install] prefix.
 */

import { DB }          from '../core/db.js';
import { Bus, EVENTS } from '../core/bus.js';
import { showToast }   from './toast.js';

// ── State ──────────────────────────────────────────────────────

let _deferredPrompt  = null;
let _installed       = false;
let _standalone      = false;
let _bannerDismissed = false;
let _toastShown      = false;
let _diagTimer       = null;

// Diagnostic results — populated during init, used by renderInstallSection
const _diag = {
  https:       location.protocol === 'https:' || location.hostname === 'localhost',
  manifest:    null,   // true | false | null (unknown)
  swActive:    null,
  swSupported: 'serviceWorker' in navigator,
  promptFired: false,
  standalone:  false,
};

const LOG = (...args) => console.log('[NOVA Install]', ...args);
const WARN = (...args) => console.warn('[NOVA Install]', ...args);

// ── Init ───────────────────────────────────────────────────────

export async function initInstallPrompt() {
  LOG('Initializing install system');
  LOG('HTTPS:', _diag.https);
  LOG('SW supported:', _diag.swSupported);

  // Standalone check
  _standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  _diag.standalone = _standalone;
  LOG('Running as standalone PWA:', _standalone);

  // DB checks
  const [savedInstalled, dismissed] = await Promise.all([
    DB.settings.get('nova_installed'),
    DB.settings.get('install_dismissed'),
  ]);
  if (savedInstalled) { _installed = true; LOG('Previously installed (from DB)'); }
  if (dismissed)      { _bannerDismissed = true; }

  // Run diagnostics in background — don't block boot
  _runDiagnostics();

  // Capture install prompt
  window.addEventListener('beforeinstallprompt', _onBeforeInstallPrompt);
  LOG('Listening for beforeinstallprompt');

  // Track install completion
  window.addEventListener('appinstalled', _onAppInstalled);

  // Wire bottom banner buttons
  document.getElementById('install-btn')?.addEventListener('click', triggerInstall);
  document.getElementById('install-dismiss')?.addEventListener('click', _dismissBanner);

  // Banner after first action
  Bus.on(EVENTS.FIRST_ACTION, () => {
    if (_deferredPrompt && !_bannerDismissed && !_standalone && !_installed) {
      _showBanner();
    }
  });

  if (_standalone || _installed) _setIndicatorInstalled();

  // 5-second timeout: if prompt hasn't fired, refresh UI with diagnostic info
  _diagTimer = setTimeout(() => {
    LOG('5s timeout reached — beforeinstallprompt has not fired');
    LOG('Diagnostic snapshot:', JSON.stringify(_diag, null, 2));
    _refreshSettingsSection();
  }, 5000);
}

// ── Diagnostics ────────────────────────────────────────────────

async function _runDiagnostics() {
  // Check manifest is fetchable and valid
  try {
    const res = await fetch('./manifest.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      _diag.manifest = !!(json.name && json.icons?.length && json.start_url && json.display);
      LOG('Manifest fetched OK, valid:', _diag.manifest, json);
    } else {
      _diag.manifest = false;
      WARN('Manifest fetch failed:', res.status);
    }
  } catch (err) {
    _diag.manifest = false;
    WARN('Manifest fetch error:', err);
  }

  // Check SW state
  if (_diag.swSupported) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('./');
      if (reg) {
        const sw = reg.active || reg.installing || reg.waiting;
        _diag.swActive = !!reg.active;
        LOG('SW registration found. Active:', !!reg.active, 'State:', sw?.state);
      } else {
        _diag.swActive = false;
        WARN('No SW registration found for this scope');
      }
    } catch (err) {
      _diag.swActive = false;
      WARN('SW check error:', err);
    }
  } else {
    _diag.swActive = false;
    WARN('Service workers not supported in this browser');
  }

  LOG('Diagnostics complete:', _diag);
  _refreshSettingsSection();
}

// ── Event handlers ─────────────────────────────────────────────

function _onBeforeInstallPrompt(e) {
  e.preventDefault();
  _deferredPrompt     = e;
  _diag.promptFired   = true;
  clearTimeout(_diagTimer);
  LOG('beforeinstallprompt fired ✓ — install is available');

  _showIndicator();

  if (!_toastShown && !_standalone && !_installed) {
    _toastShown = true;
    showToast('NOVA can be installed on this device.', 'info', 5000);
  }

  if (!_bannerDismissed) {
    setTimeout(() => {
      if (_deferredPrompt && !_installed) _showBanner();
    }, 30_000);
  }

  _refreshSettingsSection();
}

async function _onAppInstalled() {
  LOG('appinstalled event fired — install confirmed');
  _installed      = true;
  _deferredPrompt = null;

  await DB.settings.set('nova_installed', true);
  showToast('NOVA installed! Launch it from your desktop or taskbar.', 'success', 6000);

  _hideBanner();
  _setIndicatorInstalled();
  _refreshSettingsSection();
}

// ── Public API ─────────────────────────────────────────────────

export async function triggerInstall() {
  if (!_deferredPrompt) {
    WARN('triggerInstall called but no prompt available');
    return false;
  }
  LOG('Triggering install prompt');
  _deferredPrompt.prompt();
  const { outcome } = await _deferredPrompt.userChoice;
  LOG('User choice:', outcome);

  if (outcome === 'accepted') _hideBanner();
  _deferredPrompt = null;
  _refreshSettingsSection();
  return outcome === 'accepted';
}

export function isInstalled()       { return _installed || _standalone; }
export function isPromptAvailable() { return _deferredPrompt !== null; }

// ── Render install section ─────────────────────────────────────

export function renderInstallSection() {
  const container = document.getElementById('install-section');
  if (!container) return;

  LOG('Rendering install section. State:', {
    standalone: _standalone,
    installed: _installed,
    promptAvailable: !!_deferredPrompt,
    diag: _diag,
  });

  if (_standalone || _installed) {
    container.innerHTML = _htmlInstalled();
    return;
  }

  if (_deferredPrompt) {
    container.innerHTML = _htmlPromptReady();
    container.querySelector('#settings-install-btn')
      ?.addEventListener('click', async () => {
        const btn = container.querySelector('#settings-install-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
        await triggerInstall();
        renderInstallSection();
      });
    return;
  }

  // No prompt — show reason + diagnostics + manual steps
  container.innerHTML = _htmlNotAvailable();
}

// ── Banner helpers ─────────────────────────────────────────────

function _showBanner() {
  const b = document.getElementById('install-banner');
  if (b) b.hidden = false;
}

function _hideBanner() {
  const b = document.getElementById('install-banner');
  if (b) b.hidden = true;
}

async function _dismissBanner() {
  _hideBanner();
  _bannerDismissed = true;
  await DB.settings.set('install_dismissed', true);
}

function _showIndicator() {
  const el = document.getElementById('install-indicator');
  if (el) el.hidden = false;
}

function _setIndicatorInstalled() {
  const el = document.getElementById('install-indicator');
  if (el) el.hidden = true;
}

function _refreshSettingsSection() {
  const modal = document.getElementById('settings-modal');
  if (!modal || modal.hidden) return;
  renderInstallSection();
}

// ── HTML templates ─────────────────────────────────────────────

function _htmlInstalled() {
  return `
    <div class="install-state install-state--done">
      <div class="install-state-icon">✓</div>
      <div class="install-state-text">
        <strong>NOVA Installed</strong>
        <span>Running as an installed app on this device.</span>
      </div>
    </div>
    ${_htmlDiagPanel()}
  `;
}

function _htmlPromptReady() {
  return `
    <div class="install-state install-state--ready">
      <p class="install-desc">
        Install NOVA as a desktop app — instant access, no browser required,
        works fully offline.
      </p>
      <button id="settings-install-btn" class="btn btn-primary btn-full install-cta">
        ↓ &nbsp;Install NOVA on this device
      </button>
    </div>
    ${_htmlDiagPanel()}
  `;
}

function _htmlNotAvailable() {
  const reason = _getNotAvailableReason();
  return `
    <div class="install-state install-state--unavailable">
      <div class="install-unavailable-reason">
        <span class="install-reason-icon">ℹ</span>
        <span>${reason}</span>
      </div>
    </div>
    ${_htmlDiagPanel()}
    ${_htmlManualSteps()}
  `;
}

function _getNotAvailableReason() {
  if (!_diag.https)      return 'Site must be served over HTTPS for installation.';
  if (!_diag.swSupported) return 'This browser does not support PWA installation.';
  if (_diag.swActive === false && _diag.swSupported) {
    return 'Service worker is not yet active. Try reloading the page once.';
  }
  if (_diag.manifest === false) return 'App manifest could not be loaded — check the browser console.';
  return 'Install prompt not yet available. The browser may need a moment, or try reloading.';
}

function _htmlDiagPanel() {
  const check = (val) => {
    if (val === true)  return '<span class="diag-yes">Yes</span>';
    if (val === false) return '<span class="diag-no">No</span>';
    return '<span class="diag-unknown">—</span>';
  };
  return `
    <details class="diag-panel">
      <summary class="diag-summary">Diagnostics</summary>
      <div class="diag-grid">
        <span class="diag-label">HTTPS</span>          ${check(_diag.https)}
        <span class="diag-label">Manifest loaded</span> ${check(_diag.manifest)}
        <span class="diag-label">Service worker</span>  ${check(_diag.swActive)}
        <span class="diag-label">Install prompt</span>  ${check(_diag.promptFired)}
        <span class="diag-label">Running as PWA</span>  ${check(_diag.standalone || _installed)}
      </div>
    </details>
  `;
}

function _htmlManualSteps() {
  return `
    <div class="install-steps" style="margin-top:12px">
      <div class="install-step">
        <span class="install-step-browser">Chrome</span>
        <span class="install-step-action">
          Click <strong>⋮</strong> → <strong>"Install NOVA…"</strong>
        </span>
      </div>
      <div class="install-step">
        <span class="install-step-browser">Edge</span>
        <span class="install-step-action">
          Click <strong>…</strong> → <strong>Apps</strong> → <strong>"Install this site as an app"</strong>
        </span>
      </div>
      <div class="install-step">
        <span class="install-step-browser">Brave</span>
        <span class="install-step-action">
          Click <strong>☰</strong> → <strong>"Install NOVA…"</strong>
        </span>
      </div>
    </div>
  `;
}
