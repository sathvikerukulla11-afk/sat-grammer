/** Progress, statistics, achievements, leaderboard reads. */
import { supabase } from './core-supabase.js';
import { unwrap } from './core-errors.js';
import { store } from './core-store.js';

/** Everything the Progress page needs, in one RPC call. */
export async function getOverview() {
  return unwrap(await supabase.rpc('get_progress_overview'));
}

/**
 * Per-rule *completion* — how much of the available bank a student has
 * worked through. This is deliberately not mastery: you can have seen
 * every question for a rule and mastered none of them, and you can have
 * mastered a rule after twelve of its four hundred questions.
 *
 * Returns { rule_id, slug, name, domain, available, seen, correct_once,
 *           completion, mastery, attempted }.
 */
export async function getRuleCompletion() {
  return unwrap(await supabase.rpc('get_rule_completion'));
}

export async function getStats({ force = false } = {}) {
  const cached = store.get('stats');
  if (cached && !force) return cached;
  const userId = store.get('user')?.id;
  if (!userId) return null;

  const stats = unwrap(
    await supabase.from('user_stats').select('*').eq('user_id', userId).maybeSingle()
  );
  store.set({ stats });
  return stats;
}

export async function getRuleStats() {
  return unwrap(
    await supabase
      .from('user_rule_stats')
      .select('*, rule:grammar_rules(id, slug, name, domain_id)')
      .order('mastery', { ascending: true })
  );
}

/** Weakest / strongest rules, filtered to ones with enough evidence. */
export async function getRuleExtremes(minAttempts = 5) {
  const rows = await getRuleStats();
  const meaningful = rows.filter((r) => r.attempted >= minAttempts);
  const sorted = [...meaningful].sort((a, b) => a.mastery - b.mastery);
  return {
    weakest: sorted.slice(0, 5),
    strongest: sorted.slice(-5).reverse(),
    untouched: rows.filter((r) => r.attempted === 0)
  };
}

export async function getRecentSessions(limit = 10) {
  return unwrap(
    await supabase
      .from('practice_sessions')
      .select('*')
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(limit)
  );
}

export async function getActivityCalendar(days = 365) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return unwrap(
    await supabase
      .from('daily_activity')
      .select('*')
      .gte('day', since)
      .order('day')
  );
}

export async function getRecentAttempts(limit = 25) {
  return unwrap(
    await supabase
      .from('attempts')
      .select(`
        id, is_correct, time_ms, difficulty, created_at, choice_label,
        question:questions(id, public_id, passage),
        rule:grammar_rules(slug, name)
      `)
      .order('created_at', { ascending: false })
      .limit(limit)
  );
}

/**
 * Recommendations: what this student should do next, and why.
 *
 * The reasoning is rule-based rather than statistical, deliberately. A
 * student needs to understand why they are being told to do something,
 * and "you have missed 14 of 40 comma questions" is an argument they can
 * act on. A model score is not.
 */
export async function getRecommendations(limit = 4) {
  return unwrap(await supabase.rpc('get_recommendations', { p_limit: limit }));
}

/**
 * Mistake patterns: which rules actually cost points, whether the
 * student is rushing or labouring, whether accuracy falls off late in a
 * session, and which individual questions keep catching them out.
 */
export async function getMistakeAnalysis() {
  return unwrap(await supabase.rpc('get_mistake_analysis'));
}

/* ---- Goals ------------------------------------------------------------ */

export async function getGoals() {
  return unwrap(await supabase.rpc('get_goals'));
}

export async function createGoal({ kind, target, ruleId = null, dueDate = null }) {
  const userId = store.get('user')?.id;
  return unwrap(
    await supabase.from('goals').insert({
      user_id: userId, kind, target, rule_id: ruleId, due_date: dueDate
    }).select().single()
  );
}

export async function deleteGoal(id) {
  const { error } = await supabase.from('goals').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/* ---- Achievements ---------------------------------------------------- */

export async function getAchievements() {
  const [catalogue, mine] = await Promise.all([
    supabase.from('achievements').select('*').order('sort_order'),
    supabase.from('user_achievements').select('*')
  ]);

  const progress = new Map((mine.data || []).map((row) => [row.achievement_code, row]));
  return (catalogue.data || []).map((achievement) => ({
    ...achievement,
    progress: progress.get(achievement.code)?.progress ?? 0,
    unlocked_at: progress.get(achievement.code)?.unlocked_at ?? null,
    unlocked: Boolean(progress.get(achievement.code)?.unlocked_at)
  }));
}

/* ---- Leaderboard ------------------------------------------------------ */

/**
 * The leaderboard for one period.
 *
 * This calls an RPC rather than reading `leaderboard_view` directly.
 * The board is a precomputed snapshot, and something has to rebuild it —
 * that used to be pg_cron, which is not available on every Supabase tier.
 * On this project the refresh therefore never ran once and the table
 * stayed empty, so qualifying students were simply invisible.
 *
 * The RPC rebuilds lazily when the snapshot goes stale, so the board
 * works with no scheduler at all. It also computes the period boundary
 * server-side, which removes a whole class of client timezone bug, and
 * returns the caller's own row plus a reason when they are not ranked.
 */
export async function getLeaderboard(period = 'weekly', limit = 100) {
  return unwrap(await supabase.rpc('get_leaderboard', {
    p_period: period, p_limit: limit
  }));
}
