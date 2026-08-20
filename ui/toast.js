/**
 * NOVA Toast Notifications
 * Non-blocking, auto-dismissing, stackable.
 */

let _container = null;

const ICONS = {
  info:    'ℹ',
  success: '✓',
  warning: '⚠',
  error:   '✕',
};

export function initToasts() {
  _container = document.getElementById('toast-container');
}

/**
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} duration ms before auto-dismiss (0 = no auto-dismiss)
 */
export function showToast(message, type = 'info', duration = 3500) {
  if (!_container) {
    _container = document.getElementById('toast-container');
    if (!_container) { console.warn('[Toast] No container'); return; }
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${ICONS[type] ?? 'ℹ'}</span>
    <span class="toast-msg">${_escape(message)}</span>
  `;

  _container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => _dismiss(toast), duration);
  }

  return toast;
}

function _dismiss(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.add('toast-out');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
  // Fallback if animation doesn't fire
  setTimeout(() => toast.remove(), 400);
}

function _escape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
