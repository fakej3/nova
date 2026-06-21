/**
 * NOVA First-Run Onboarding
 * Shows once on first launch to orient new users.
 * Dismissed by clicking "Get started"; flag stored in DB.settings.
 */

import { DB } from '../core/db.js';

export async function initOnboarding() {
  try {
    const done = await DB.settings.get('firstRun');
    if (done) return;
  } catch {
    return; // DB not ready — skip rather than block boot
  }

  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;

  overlay.hidden = false;
  // Prevent body scroll while overlay is open
  document.body.style.overflow = 'hidden';

  const startBtn = document.getElementById('onboarding-start');
  startBtn?.addEventListener('click', async () => {
    overlay.classList.add('onboarding-out');
    document.body.style.overflow = '';
    try { await DB.settings.set('firstRun', 'done'); } catch {}
    setTimeout(() => {
      overlay.hidden = true;
      overlay.classList.remove('onboarding-out');
    }, 350);
  }, { once: true });
}
