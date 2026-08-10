/**
 * Error normalisation.
 *
 * Postgres and GoTrue speak in codes; students should never see one.
 * Everything user-facing funnels through `friendlyMessage`.
 */

const AUTH_MESSAGES = {
  'invalid_credentials': 'That email and password don’t match an account.',
  'email_not_confirmed': 'Please confirm your email address first — check your inbox for the link.',
  'user_already_exists': 'An account already exists with that email. Try signing in instead.',
  'weak_password': 'Choose a longer password — at least 8 characters.',
  'over_email_send_rate_limit': 'Too many emails requested. Wait a few minutes and try again.',
  'same_password': 'Your new password must be different from your current one.',
  'session_expired': 'Your session expired. Please sign in again.',
  'over_request_rate_limit': 'Too many attempts. Please wait a moment.'
};

const PG_MESSAGES = {
  '23505': 'That value is already taken.',
  '23503': 'That item no longer exists.',
  '23514': 'Something in that form is missing or invalid.',
  '42501': 'You don’t have permission to do that.',
  'P0002': 'We could’nt find what you were looking for.',
  'PGRST116': 'No matching record was found.',
  'PGRST301': 'Your session expired. Please sign in again.'
};

export class AppError extends Error {
  constructor(message, { code = null, cause = null, retryable = false } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
    this.retryable = retryable;
  }
}

export function friendlyMessage(error) {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'string') return error;

  const code = error.code || error.error_code || error.status;

  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (PG_MESSAGES[code]) return PG_MESSAGES[code];

  // Postgres RAISE EXCEPTION text is authored to be readable; pass it through.
  if (error.message && /^[A-Z].*[.?!]$/.test(error.message) && error.message.length < 160) {
    return error.message;
  }

  if (error.message?.includes('Failed to fetch')) {
    return 'Could’nt reach the server. Check your connection and try again.';
  }

  return 'Something went wrong. Please try again.';
}

/** Wrap a Supabase `{ data, error }` result and throw a normalised error. */
export function unwrap({ data, error }) {
  if (error) throw new AppError(friendlyMessage(error), { code: error.code, cause: error });
  return data;
}

/** Retry a transient failure with exponential backoff. */
export async function withRetry(fn, { attempts = 3, baseMs = 300 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const transient = err?.message?.includes('fetch') || err?.status >= 500;
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastError;
}
