/**
 * NOVA Theme Engine
 * Applies themes, persists choices, handles time-based auto-switching.
 */

import { DB } from '../core/db.js';
import { State } from '../core/state.js';
import { Bus, EVENTS } from '../core/bus.js';
import { logEvent, EVENT_TYPES } from '../services/events.js';

export const THEMES = ['ironman', 'space', 'cyberpunk', 'minimal'];

const TIME_SCHEDULE = [
  { start: 6,  end: 12, theme: 'minimal'   },
  { start: 12, end: 18, theme: 'ironman'   },
  { start: 18, end: 24, theme: 'cyberpunk' },
  { start: 0,  end: 6,  theme: 'space'     },
];

const MANUAL_OVERRIDE_HOURS = 6;

let _autoThemeInterval = null;

export async function initThemeEngine() {
  const savedTheme    = await DB.settings.get('theme');
  const autoTheme     = await DB.settings.get('autoTheme');
  const themeManualAt = await DB.settings.get('themeManualAt');

  State.set('autoTheme',     autoTheme     ?? false);
  State.set('themeManualAt', themeManualAt ?? null);

  if (autoTheme && !_isManualOverrideActive(themeManualAt)) {
    applyTheme(getTimeBasedTheme(), false);
  } else {
    applyTheme(savedTheme ?? 'ironman', false);
  }

  _startAutoThemeLoop();
}

export function applyTheme(name, isManual = true) {
  if (!THEMES.includes(name)) {
    console.warn(`[Theme] Unknown theme: "${name}"`);
    return;
  }

  // Suppress transition flash on initial load
  if (!State.get('initialized')) {
    document.documentElement.classList.add('no-transition');
    requestAnimationFrame(() => {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.setAttribute('data-theme', name);
      requestAnimationFrame(() => document.documentElement.classList.remove('no-transition'));
    });
  } else {
    document.documentElement.setAttribute('data-theme', name);
  }

  State.set('theme', name);
  DB.settings.set('theme', name).catch((e) => console.error('[Theme] Failed to persist theme:', e));

  if (isManual) {
    const ts = new Date().toISOString();
    State.set('themeManualAt', ts);
    DB.settings.set('themeManualAt', ts).catch((e) => console.error('[Theme] Failed to persist themeManualAt:', e));
    logEvent(EVENT_TYPES.THEME_CHANGED, `Theme changed to ${name}`);
  }

  Bus.emit(EVENTS.THEME_CHANGED, { theme: name });
  _syncThemePickerUI(name);
}

export function getCurrentTheme() {
  return State.get('theme');
}

export function setAutoTheme(enabled) {
  State.set('autoTheme', enabled);
  DB.settings.set('autoTheme', enabled);
  if (enabled) {
    _startAutoThemeLoop();
  } else {
    _stopAutoThemeLoop();
  }
}

function getTimeBasedTheme() {
  const hour = new Date().getHours();
  for (const slot of TIME_SCHEDULE) {
    if (slot.start <= slot.end) {
      if (hour >= slot.start && hour < slot.end) return slot.theme;
    } else {
      if (hour >= slot.start || hour < slot.end) return slot.theme;
    }
  }
  return 'ironman';
}

function _isManualOverrideActive(themeManualAt) {
  if (!themeManualAt) return false;
  const manualTime  = new Date(themeManualAt).getTime();
  const cutoff      = MANUAL_OVERRIDE_HOURS * 60 * 60 * 1000;
  return Date.now() - manualTime < cutoff;
}

function _startAutoThemeLoop() {
  _stopAutoThemeLoop();
  if (!State.get('autoTheme')) return;

  _autoThemeInterval = setInterval(() => {
    const manualAt = State.get('themeManualAt');
    if (_isManualOverrideActive(manualAt)) return;
    const target = getTimeBasedTheme();
    if (target !== State.get('theme')) {
      applyTheme(target, false);
    }
  }, 60_000); // check every minute
}

function _stopAutoThemeLoop() {
  if (_autoThemeInterval) {
    clearInterval(_autoThemeInterval);
    _autoThemeInterval = null;
  }
}

function _syncThemePickerUI(name) {
  document.querySelectorAll('.theme-option').forEach((btn) => {
    const isActive = btn.dataset.theme === name;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', String(isActive));
  });
}
