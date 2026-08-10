/**
 * Practice session lifecycle. Thin wrappers over the RPCs — all the
 * selection and grading logic lives in Postgres.
 */
import { supabase } from './core-supabase.js';
import { unwrap } from './core-errors.js';
import { emit, EVENTS } from './core-events.js';
import { local } from './core-store.js';

const RESUME_KEY = 'active-session';

export async function startSession(mode, config = {}) {
  const session = unwrap(
    await supabase.rpc('start_session', { p_mode: mode, p_config: config })
  );
  local.set(RESUME_KEY, { id: session.id, mode, startedAt: Date.now() });
  emit(EVENTS.SESSION_STARTED, session);
  return session;
}

/** Questions without the answer key, in the order the session fixed. */
export async function getSessionQuestions(sessionId) {
  return unwrap(await supabase.rpc('get_session_questions', { p_session_id: sessionId }));
}

/**
 * Submit one answer. Returns the grade plus every rationale, so the
 * explanation panel can render without a second round trip.
 */
export async function submitAnswer({
  questionId, choiceId, timeMs, sessionId = null,
  mode = 'mixed', skipped = false, usedHint = false
}) {
  const result = unwrap(
    await supabase.rpc('record_attempt', {
      p_question_id: questionId,
      p_choice_id: choiceId,
      p_time_ms: Math.round(timeMs),
      p_session_id: sessionId,
      p_mode: mode,
      p_skipped: skipped,
      p_used_hint: usedHint
    })
  );

  emit(EVENTS.ANSWER_SUBMITTED, result);
  for (const badge of result.new_achievements || []) {
    emit(EVENTS.ACHIEVEMENT_UNLOCKED, badge);
  }
  return result;
}

export async function finishSession(sessionId) {
  const session = unwrap(await supabase.rpc('finish_session', { p_session_id: sessionId }));
  local.remove(RESUME_KEY);
  emit(EVENTS.SESSION_FINISHED, session);
  return session;
}

export async function getSession(sessionId) {
  return unwrap(
    await supabase.from('practice_sessions').select('*').eq('id', sessionId).single()
  );
}

/**
 * Flag a question for a second look before submitting.
 *
 * Distinct from a bookmark: a bookmark is durable and survives the
 * session, a flag is scoped to this run and clears when it ends.
 */
export async function toggleFlag(sessionId, questionId) {
  return unwrap(
    await supabase.rpc('toggle_flag', {
      p_session_id: sessionId,
      p_question_id: questionId
    })
  );
}

/**
 * Full state of a session: the frozen question order plus the grade for
 * every question already answered in it.
 *
 * This is what makes resume actually resume. Answers were always durable
 * — `record_attempt` writes a row the instant one is submitted — but
 * nothing read them back, so a resumed session rendered blank.
 */
export async function getSessionState(sessionId) {
  return unwrap(await supabase.rpc('get_session_state', { p_session_id: sessionId }));
}

/**
 * Persist the current position. Called on every answer and every
 * navigation, so closing the tab mid-session loses at most the question
 * the student was looking at, never an answer.
 */
export async function saveCursor(sessionId, cursor) {
  const { error } = await supabase.rpc('save_session_cursor', {
    p_session_id: sessionId, p_cursor: cursor
  });
  // Non-fatal: the resume path falls back to the first unanswered
  // question, so a failed cursor write costs position, not progress.
  if (error) console.warn('[practice] cursor save failed:', error.message);
  return !error;
}

/**
 * An unfinished session, from the database rather than localStorage.
 *
 * localStorage does not survive clearing site data, a different browser,
 * or a different machine. The session row does, which is what makes
 * "close the browser and come back tomorrow" work.
 */
export async function findResumableSession() {
  const session = await unwrap(await supabase.rpc('find_active_session'));
  if (session) local.set(RESUME_KEY, { id: session.id, mode: session.mode });
  else local.remove(RESUME_KEY);
  return session;
}

export async function getDailyChallenge() {
  return unwrap(await supabase.rpc('ensure_daily_challenge', {}));
}

export async function getDailyResult(day = null) {
  const target = day || new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('daily_challenge_results')
    .select('*')
    .eq('day', target)
    .maybeSingle();
  return data;
}

/* ==========================================================================
   Question Bank
   ==========================================================================
   Browsing is metadata only — the server never sends passage, stem or
   choices to the list view, so a student cannot read ahead. Opening a
   question builds an ordinary one-question session and hands it to the
   SAME PracticeRunner the practice page uses, which is why there is no
   second answering path to keep in sync.
   ========================================================================== */

export async function browseQuestions({
  ruleIds = [], difficulties = [], status = null, limit = 50, afterNo = null
} = {}) {
  const { data, error } = await supabase.rpc('browse_questions', {
    p_rule_ids: ruleIds.length ? ruleIds : null,
    p_difficulties: difficulties.length ? difficulties : null,
    p_status: status,
    p_limit: limit,
    p_after_no: afterNo
  });
  if (error) throw error;
  return data;
}

/** Start a session from an explicit question list. Tier-gated server-side. */
export async function startSessionFromQuestions(questionIds) {
  const { data, error } = await supabase.rpc('start_session_from_questions', {
    p_question_ids: questionIds
  });
  if (error) throw error;
  return data;
}

/**
 * Start a session from the Question Bank's filters.
 *
 * Selection happens entirely on the server — the browser never receives the
 * question ids, and the same WHERE clause backs both this and the count shown
 * by browseQuestions(), so the two cannot drift apart.
 */
export async function startBankSession({
  ruleIds = [], difficulties = [], status = null, limit = 10
} = {}) {
  const { data, error } = await supabase.rpc('start_bank_session', {
    p_rule_ids: ruleIds.length ? ruleIds : null,
    p_difficulties: difficulties.length ? difficulties : null,
    p_status: status,
    p_limit: limit
  });
  if (error) throw error;
  return data;
}
