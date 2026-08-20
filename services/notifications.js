/**
 * NOVA Notification Service
 *
 * Strategy:
 *   - Never ask for permission on first launch.
 *   - Ask after TRUST_THRESHOLD interactions (trust established).
 *   - On each app open, check for overdue / due-today tasks once per day.
 *   - Show notification via the registered service worker.
 *   - Track per-day to avoid repeating.
 */

const LS_INTERACTIONS  = 'nova_interaction_count';
const LS_LAST_NOTIF    = 'nova_last_notif_date';
const LS_PERMISSION    = 'nova_notif_asked';
const TRUST_THRESHOLD  = 5;     // ask after this many messages

// ── Permission management ─────────────────────────────────────

/** Call once per user message sent. Asks for permission after TRUST_THRESHOLD. */
export function trackInteraction() {
  if (!('Notification' in window)) return;
  try {
    const n = (parseInt(localStorage.getItem(LS_INTERACTIONS), 10) || 0) + 1;
    localStorage.setItem(LS_INTERACTIONS, String(n));
    if (n === TRUST_THRESHOLD && Notification.permission === 'default') {
      _requestPermission();
    }
  } catch {}
}

async function _requestPermission() {
  try {
    const result = await Notification.requestPermission();
    localStorage.setItem(LS_PERMISSION, result);
    console.log('[Notifications] Permission:', result);
  } catch (e) {
    console.warn('[Notifications] Permission request failed:', e.message);
  }
}

export function notificationsGranted() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

// ── On-open daily check ───────────────────────────────────────

/**
 * Call on app open (after tasks are loaded).
 * Shows a notification if tasks are overdue/due-today and
 * a notification hasn't been shown today already.
 */
export async function checkOnOpenNotifications(allTasks) {
  if (!notificationsGranted()) return;

  const today    = new Date().toDateString();
  const lastShown = localStorage.getItem(LS_LAST_NOTIF);
  if (lastShown === today) return;

  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const pending  = allTasks.filter(t => t.status === 'pending');
  const overdue  = pending.filter(t => t.dueDate && new Date(t.dueDate) < midnight);
  const dueToday = pending.filter(t => {
    if (!t.dueDate) return false;
    const d = new Date(t.dueDate); d.setHours(0, 0, 0, 0);
    return d.getTime() === midnight.getTime();
  });

  if (!overdue.length && !dueToday.length) return;

  const parts = [];
  if (overdue.length)  parts.push(`${overdue.length} overdue`);
  if (dueToday.length) parts.push(`${dueToday.length} due today`);

  await _showNotification(
    'NOVA',
    parts.join(', ') + '. Open NOVA to review.',
    'nova-daily-tasks'
  );

  localStorage.setItem(LS_LAST_NOTIF, today);
}

/** Schedule a one-shot reminder for a specific task (session-lifetime only). */
export function scheduleTaskReminder(task, delayMs) {
  if (!notificationsGranted() || delayMs <= 0) return;
  setTimeout(async () => {
    if (document.visibilityState === 'visible') return; // user is already in NOVA
    await _showNotification(
      'NOVA — Task due',
      `"${task.title}" is due now.`,
      `nova-task-${task.id}`
    );
  }, delayMs);
}

async function _showNotification(title, body, tag = 'nova') {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon:      './assets/icons/icon-192.png',
        badge:     './assets/icons/icon-192.png',
        tag,
        renotify:  false,
        silent:    false,
      });
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: './assets/icons/icon-192.png', tag });
    }
  } catch (e) {
    console.warn('[Notifications] Show failed:', e.message);
  }
}
