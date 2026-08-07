/**
 * Authentication.
 *
 * Flow:
 *   register → Supabase sends a confirmation email → user clicks link →
 *   detectSessionInUrl exchanges the PKCE code → onAuthStateChange fires →
 *   the profile row already exists (created by the handle_new_user trigger).
 *
 * The client never decides who someone is; it only reflects the session
 * the server issued. Every authorisation check that matters is a policy.
 */
import { supabase } from './core-supabase.js';
import { store } from './core-store.js';
import { emit, EVENTS } from './core-events.js';
import { AppError, friendlyMessage, unwrap } from './core-errors.js';
import { CONFIG } from './config.js';

const url = (page) => new URL(CONFIG.BASE_PATH + '/' + page, location.origin).href;

/* ------------------------------------------------------------------ */
/* Validation — mirrored server-side by CHECK constraints and policies */
/* ------------------------------------------------------------------ */

export function validateEmail(email) {
  if (!email) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(password) {
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 72) return 'Passwords are limited to 72 characters.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Include at least one letter and one number.';
  }
  return null;
}

export function validateUsername(username) {
  if (!username) return 'Username is required.';
  if (username.length < 3 || username.length > 24) return 'Use between 3 and 24 characters.';
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return 'Letters, numbers, and underscores only.';
  return null;
}

/** 0–4, for the strength meter. Deliberately advisory, never blocking. */
export function passwordScore(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(4, score);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export async function register({ email, password, username, displayName }) {
  const problem = validateEmail(email) || validatePassword(password) || validateUsername(username);
  if (problem) throw new AppError(problem);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: url(CONFIG.ROUTES.DASHBOARD),
      data: { username, display_name: displayName || username }
    }
  });
  if (error) throw new AppError(friendlyMessage(error), { code: error.code, cause: error });

  return {
    user: data.user,
    needsConfirmation: !data.session
  };
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new AppError(friendlyMessage(error), { code: error.code, cause: error });
  return data;
}

export async function signInWithProvider(provider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: url(CONFIG.ROUTES.DASHBOARD) }
  });
  if (error) throw new AppError(friendlyMessage(error), { code: error.code });
}

export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: url(CONFIG.ROUTES.DASHBOARD) }
  });
  if (error) throw new AppError(friendlyMessage(error), { code: error.code });
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: url(CONFIG.ROUTES.SETTINGS) + '#reset'
  });
  if (error) throw new AppError(friendlyMessage(error), { code: error.code });
}

export async function updatePassword(newPassword) {
  const problem = validatePassword(newPassword);
  if (problem) throw new AppError(problem);
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new AppError(friendlyMessage(error), { code: error.code });
}

export async function signOut() {
  await supabase.auth.signOut();
  store.reset();
  location.assign(url(CONFIG.ROUTES.HOME));
}

/* ------------------------------------------------------------------ */
/* Session bootstrap                                                   */
/* ------------------------------------------------------------------ */

/** Loads the profile + stats that every signed-in page needs. */
async function hydrate(session) {
  if (!session?.user) {
    store.set({ session: null, user: null, profile: null, stats: null, ready: true });
    return null;
  }

  const [profileRes, statsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
    supabase.from('user_stats').select('*').eq('user_id', session.user.id).maybeSingle()
  ]);

  const profile = profileRes.data;
  const stats = statsRes.data;

  store.set({ session, user: session.user, profile, stats, ready: true });
  return profile;
}

let initPromise = null;

/** Idempotent. Every page calls this once, at the top of its controller. */
export function initAuth() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await hydrate(session);

    supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (event === 'SIGNED_OUT') {
        store.reset();
        store.set({ ready: true });
      } else if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
        await hydrate(nextSession);
      }
      emit(EVENTS.AUTH_CHANGED, { event, session: nextSession });
    });

    return store.get('session');
  })();

  return initPromise;
}

export const currentUser    = () => store.get('user');
export const currentProfile = () => store.get('profile');
export const isSignedIn     = () => Boolean(store.get('session'));
export const isStaff        = () => ['author', 'moderator', 'admin'].includes(store.get('profile')?.role);
export const isAdmin        = () => store.get('profile')?.role === 'admin';

/* ------------------------------------------------------------------ */
/* Route guards                                                        */
/* ------------------------------------------------------------------ */

/**
 * Call at the top of a protected page. Redirects to login with a `next`
 * parameter so the user lands where they were headed.
 *
 * This is a convenience, not a security boundary — a determined visitor
 * can always load the HTML. The data behind it is protected by RLS.
 */
export async function requireAuth({ staffOnly = false } = {}) {
  await initAuth();

  if (!isSignedIn()) {
    const next = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    location.replace(`${url(CONFIG.ROUTES.LOGIN)}?next=${next}`);
    return null;
  }

  const profile = currentProfile();

  if (profile?.banned_until && new Date(profile.banned_until) > new Date()) {
    location.replace(url(CONFIG.ROUTES.HOME) + '?suspended=1');
    return null;
  }

  if (staffOnly && !isStaff()) {
    location.replace(url(CONFIG.ROUTES.DASHBOARD) + '?denied=1');
    return null;
  }

  return profile;
}

/** For login/register: send an already-signed-in user onward. */
export async function redirectIfSignedIn() {
  await initAuth();
  if (isSignedIn()) {
    const next = new URLSearchParams(location.search).get('next');
    const safe = next && /^[a-z0-9_-]+\.html(\?.*)?$/i.test(next) ? next : CONFIG.ROUTES.DASHBOARD;
    location.replace(url(safe));
  }
}
