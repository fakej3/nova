/**
 * NOVA PWA Install Prompt
 * Captures beforeinstallprompt, shows non-intrusive banner
 * after 30s or after the user's first meaningful action.
 */

import { DB } from '../core/db.js';
import { Bus, EVENTS } from '../core/bus.js';
import { showToast } from './toast.js';

let _deferredPrompt = null;
let _banner         = null;
let _installBtn     = null;
let _dismissBtn     = null;
let _firstActionTriggered = false;
let _timer          = null;

export async function initInstallPrompt() {
  // Check if already installed (standalone mode)
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  // Check if user previously dismissed
  const dismissed = await DB.settings.get('install_dismissed');
  if (dismissed) return;

  _banner     = document.getElementById('install-banner');
  _installBtn = document.getElementById('install-btn');
  _dismissBtn = document.getElementById('install-dismiss');

  if (!_banner) return;

  // Capture the native browser prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredPrompt = e;
    _scheduleOrShowBanner();
  });

  window.addEventListener('appinstalled', () => {
    _hideBanner();
    showToast('NOVA installed successfully!', 'success');
    _deferredPrompt = null;
  });

  // Listen for first user action
  Bus.on(EVENTS.FIRST_ACTION, () => {
    if (!_firstActionTriggered && _deferredPrompt) {
      _firstActionTriggered = true;
      clearTimeout(_timer);
      _showBanner();
    }
  });

  _installBtn?.addEventListener('click', _triggerInstall);
  _dismissBtn?.addEventListener('click', _handleDismiss);
}

function _scheduleOrShowBanner() {
  if (_firstActionTriggered) {
    _showBanner();
    return;
  }
  // 30-second fallback
  _timer = setTimeout(_showBanner, 30_000);
}

function _showBanner() {
  if (!_banner || !_deferredPrompt) return;
  _banner.hidden = false;
  _banner.removeAttribute('hidden');
}

function _hideBanner() {
  if (!_banner) return;
  _banner.hidden = true;
}

async function _triggerInstall() {
  if (!_deferredPrompt) return;
  _deferredPrompt.prompt();
  const { outcome } = await _deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    _hideBanner();
  }
  _deferredPrompt = null;
}

async function _handleDismiss() {
  _hideBanner();
  await DB.settings.set('install_dismissed', true);
  clearTimeout(_timer);
}
