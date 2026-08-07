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

/** An unfinished session from a closed tab, if there is one. */
export async function findResumableSession() {
  const stored = local.get(RESUME_KEY);
  if (!stored?.id) return null;

  const { data } = await supabase
    .from('practice_sessions')
    .select('*')
    .eq('id', stored.id)
    .eq('status', 'active')
    .maybeSingle();

  if (!data) { local.remove(RESUME_KEY); return null; }
  return data;
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

export async function getSessionFlags(sessionId) {
  const rows = unwrap(
    await supabase.from('session_flags').select('question_id').eq('session_id', sessionId)
  );
  return new Set(rows.map((row) => row.question_id));
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
