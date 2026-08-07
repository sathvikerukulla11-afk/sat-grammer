/**
 * Toasts. The live region is polite by default and assertive for errors,
 * so a screen reader announces failures without waiting for a pause.
 */
import { h, $ } from './core-dom.js';

let region;

function ensureRegion() {
  if (region) return region;
  region = $('.toast-region') || h('div.toast-region', {
    role: 'region', 'aria-label': 'Notifications'
  });
  if (!region.isConnected) document.body.append(region);
  return region;
}

export function toast(message, { title = null, tone = 'info', duration = 4500 } = {}) {
  const node = h('div.toast', {
    dataset: { tone },
    role: tone === 'error' ? 'alert' : 'status',
    'aria-live': tone === 'error' ? 'assertive' : 'polite'
  },
    h('div', {},
      title && h('div.toast__title', {}, title),
      h('div', {}, message)
    ),
    h('button.toast__close', {
      type: 'button', 'aria-label': 'Dismiss', onclick: () => dismiss(node)
    }, '×')
  );

  ensureRegion().append(node);
  if (duration) setTimeout(() => dismiss(node), duration);
  return node;
}

function dismiss(node) {
  if (!node.isConnected) return;
  node.dataset.leaving = 'true';
  setTimeout(() => node.remove(), 200);
}

export const toastSuccess = (msg, opts) => toast(msg, { ...opts, tone: 'success' });
export const toastError   = (msg, opts) => toast(msg, { ...opts, tone: 'error' });
export const toastWarning = (msg, opts) => toast(msg, { ...opts, tone: 'warning' });

/** Celebration toast for a newly unlocked achievement. */
export function toastAchievement(badge) {
  return toast(badge.description, {
    title: `Unlocked: ${badge.name}  (+${badge.xp} XP)`,
    tone: 'success',
    duration: 7000
  });
}
