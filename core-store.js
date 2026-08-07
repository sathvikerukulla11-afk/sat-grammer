/**
 * A minimal reactive store. Holds the small amount of state that more
 * than one module cares about: session, profile, stats, preferences.
 * Anything scoped to a single page stays in that page's controller.
 */
import { emit } from './core-events.js';

function createStore(initial = {}) {
  let state = { ...initial };
  const subscribers = new Set();

  return {
    get: (key) => (key ? state[key] : state),

    set(patch, { silent = false } = {}) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      const changed = Object.keys(next).filter((k) => state[k] !== next[k]);
      if (!changed.length) return state;
      state = { ...state, ...next };
      if (!silent) subscribers.forEach((fn) => fn(state, changed));
      return state;
    },

    subscribe(fn) {
      subscribers.add(fn);
      fn(state, Object.keys(state));
      return () => subscribers.delete(fn);
    },

    reset() {
      state = { ...initial };
      subscribers.forEach((fn) => fn(state, Object.keys(state)));
    }
  };
}

export const store = createStore({
  session: null,
  user: null,
  profile: null,
  stats: null,
  rules: null,
  ready: false
});

store.subscribe((state, changed) => {
  if (changed.includes('stats')) emit('stats:updated', state.stats);
});

/** localStorage with JSON + failure tolerance (private mode, quota). */
export const local = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`satgl.${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`satgl.${key}`, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(`satgl.${key}`); } catch { /* ignore */ }
  }
};
