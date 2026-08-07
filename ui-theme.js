/**
 * Theme, font size, and motion preferences.
 *
 * Applied to <html> before first paint by an inline snippet in each
 * page's <head>, so there is no flash of the wrong theme. This module
 * handles changes made after load.
 */
import { local, store } from './core-store.js';
import { emit, EVENTS } from './core-events.js';

const root = document.documentElement;
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(theme = local.get('theme', 'system')) {
  const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
  root.dataset.theme = resolved;
  local.set('theme', theme);
  emit(EVENTS.THEME_CHANGED, { preference: theme, resolved });
  return resolved;
}

export function applyFontSize(size = local.get('fontSize', 'md')) {
  root.dataset.fontSize = size;
  local.set('fontSize', size);
}

export function applyMotion(reduced = local.get('reducedMotion', false)) {
  root.dataset.motion = reduced ? 'reduced' : 'full';
  local.set('reducedMotion', reduced);
}

export function initTheme() {
  applyTheme();
  applyFontSize();
  applyMotion();

  media.addEventListener('change', () => {
    if (local.get('theme', 'system') === 'system') applyTheme('system');
  });

  // Once the profile loads, server-side preferences win over local ones.
  store.subscribe((state, changed) => {
    if (!changed.includes('profile') || !state.profile?.preferences) return;
    const prefs = state.profile.preferences;
    if (prefs.theme) applyTheme(prefs.theme);
    if (prefs.font_size) applyFontSize(prefs.font_size);
    if (typeof prefs.reduced_motion === 'boolean') applyMotion(prefs.reduced_motion);
  });
}

/** Inline this in <head> to prevent a theme flash on first paint. */
export const NO_FLASH_SNIPPET = `
(function(){try{
  var t=JSON.parse(localStorage.getItem('satgl.theme')||'"system"');
  var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme=d?'dark':'light';
  var f=JSON.parse(localStorage.getItem('satgl.fontSize')||'"md"');
  document.documentElement.dataset.fontSize=f;
}catch(e){}})();`;
