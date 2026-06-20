/**
 * NOVA PWA Install System
 *
 * Responsibilities:
 * - Capture beforeinstallprompt immediately, regardless of banner dismissal
 * - Expose triggerInstall() so Settings can fire it without a banner
 * - Render the install section inside the Settings modal
 * - Show a small main-screen indicator when install is available
 * - Persist installed state in DB so it survives page reloads
 * - Show a one-time toast when the prompt first becomes available
 */

import { DB }         from '../core/db.js';
import { Bus, EVENTS } from '../core/bus.js';
import { showToast }  from './toast.js';

// ── Internal state ─────────────────────────────────────────────

let _deferredPrompt     = null;   // the captured BeforeInstallPromptEvent
let _installed          = false;  // true after appinstalled or DB says so
let _standalone         = false;  // true if already running in standalone mode
let _toastShown         = false;  // only toast once per session
let _bannerDismissed    = false;

// ── Init ───────────────────────────────────────────────────────

export async function initInstallPrompt() {
  // Are we already running as an installed PWA?
  _standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  // Did the user install in a previous session?
  const savedInstalled = await DB.settings.get('nova_installed');
  if (savedInstalled) _installed = true;

  // Did the user dismiss the banner before?
  const dismissed = await DB.settings.get('install_dismissed');
  if (dismissed) _bannerDismissed = true;

  // Always capture the prompt — even if banner is dismissed,
  // the Settings panel button still needs it.
  window.addEventListener('beforeinstallprompt', _onBeforeInstallPrompt);

  // Track successful install
  window.addEventListener('appinstalled', _onAppInstalled);

  // Banner wiring (the small bottom banner)
  const installBtn  = document.getElementById('install-btn');
  const dismissBtn  = document.getElementById('install-dismiss');
  installBtn?.addEventListener('click', triggerInstall);
  dismissBtn?.addEventListener('click', _dismissBanner);

  // Show banner after first meaningful action (if prompt already captured)
  Bus.on(EVENTS.FIRST_ACTION, () => {
    if (_deferredPrompt && !_bannerDismissed && !_standalone && !_installed) {
      _showBanner();
    }
  });

  // If already installed/standalone, update indicator immediately
  if (_standalone || _installed) {
    _setIndicatorInstalled();
  }
}

// ── beforeinstallprompt handler ────────────────────────────────

function _onBeforeInstallPrompt(e) {
  e.preventDefault();
  _deferredPrompt = e;

  // Show main-screen indicator badge
  _showIndicator();

  // Toast — once per session
  if (!_toastShown && !_standalone && !_installed) {
    _toastShown = true;
    showToast('NOVA can be installed on this device.', 'info', 5000);
  }

  // Show bottom banner after 30s (if not dismissed)
  if (!_bannerDismissed) {
    setTimeout(() => {
      if (_deferredPrompt && !_installed) _showBanner();
    }, 30_000);
  }

  // Refresh settings panel if it's open
  _refreshSettingsSection();
}

// ── appinstalled handler ───────────────────────────────────────

async function _onAppInstalled() {
  _installed      = true;
  _deferredPrompt = null;

  await DB.settings.set('nova_installed', true);
  showToast('NOVA installed successfully! You can now launch it from your desktop.', 'success', 6000);

  _hideBanner();
  _setIndicatorInstalled();
  _refreshSettingsSection();
}

// ── Public: trigger install prompt ────────────────────────────

export async function triggerInstall() {
  if (!_deferredPrompt) return false;

  _deferredPrompt.prompt();
  const { outcome } = await _deferredPrompt.userChoice;

  if (outcome === 'accepted') {
    // appinstalled event will fire shortly and handle the rest
    _hideBanner();
  }

  _deferredPrompt = null;
  _refreshSettingsSection();
  return outcome === 'accepted';
}

// ── Public: state accessors ────────────────────────────────────

export function isInstalled()      { return _installed || _standalone; }
export function isPromptAvailable() { return _deferredPrompt !== null; }

// ── Public: render install section into settings modal ─────────

export function renderInstallSection() {
  const container = document.getElementById('install-section');
  if (!container) return;

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
        renderInstallSection(); // re-render after attempt
      });
    return;
  }

  // Prompt not available — show manual instructions immediately
  container.innerHTML = _htmlManualInstructions();
  // If the prompt arrives later while settings is open, update automatically
  window.addEventListener('beforeinstallprompt', () => renderInstallSection(), { once: true });
}

// ── Banner helpers ─────────────────────────────────────────────

function _showBanner() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.hidden = false;
}

function _hideBanner() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.hidden = true;
}

async function _dismissBanner() {
  _hideBanner();
  _bannerDismissed = true;
  await DB.settings.set('install_dismissed', true);
}

// ── Main-screen indicator ──────────────────────────────────────

function _showIndicator() {
  const el = document.getElementById('install-indicator');
  if (el) el.hidden = false;
}

function _setIndicatorInstalled() {
  const el = document.getElementById('install-indicator');
  if (el) el.hidden = true; // hide once installed — no longer needed
}

// ── Settings section re-render ─────────────────────────────────

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
        <span>NOVA is installed on this device.</span>
      </div>
    </div>
  `;
}

function _htmlPromptReady() {
  return `
    <div class="install-state install-state--ready">
      <p class="install-desc">
        Install NOVA as a desktop app for instant access — no browser needed.
        It works fully offline and launches like any native application.
      </p>
      <button id="settings-install-btn" class="btn btn-primary btn-full install-cta">
        ↓ &nbsp;Install NOVA on this device
      </button>
    </div>
  `;
}

function _htmlManualInstructions() {
  return `
    <div class="install-state install-state--manual">
      <p class="install-desc">
        Your browser will offer an install option once NOVA is ready.
        If you don't see a prompt, use your browser menu:
      </p>
      <div class="install-steps">
        <div class="install-step">
          <span class="install-step-browser">Chrome</span>
          <span class="install-step-action">
            Click the <strong>⋮</strong> menu → <strong>"Install NOVA…"</strong>
          </span>
        </div>
        <div class="install-step">
          <span class="install-step-browser">Edge</span>
          <span class="install-step-action">
            Click the <strong>…</strong> menu → <strong>Apps</strong> → <strong>"Install this site as an app"</strong>
          </span>
        </div>
        <div class="install-step">
          <span class="install-step-browser">Brave</span>
          <span class="install-step-action">
            Click the <strong>☰</strong> menu → <strong>"Install NOVA…"</strong>
          </span>
        </div>
      </div>
      <p class="install-note">
        The install option appears after NOVA's service worker has loaded
        (usually within a few seconds of opening the page).
      </p>
    </div>
  `;
}
