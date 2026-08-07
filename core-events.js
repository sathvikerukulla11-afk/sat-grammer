/**
 * Tiny pub/sub. Modules talk to each other through named events instead
 * of importing one another, which keeps the dependency graph a tree.
 */
const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

export function off(event, handler) {
  listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((handler) => {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[events] handler for "${event}" threw:`, err);
    }
  });
}

export const EVENTS = Object.freeze({
  AUTH_CHANGED: 'auth:changed',
  PROFILE_UPDATED: 'profile:updated',
  STATS_UPDATED: 'stats:updated',
  ANSWER_SUBMITTED: 'practice:answered',
  SESSION_STARTED: 'practice:started',
  SESSION_FINISHED: 'practice:finished',
  ACHIEVEMENT_UNLOCKED: 'achievement:unlocked',
  THEME_CHANGED: 'theme:changed'
});
