/**
 * Admin / authoring service.
 *
 * Every call here is still subject to RLS — a student who loads this
 * module and calls these functions gets a permission error from Postgres,
 * not a leaked row. The admin page's guard is convenience, not security.
 */
import { supabase } from './core-supabase.js';
import { unwrap, AppError } from './core-errors.js';
import { store } from './core-store.js';

/* ---- Question CRUD ---------------------------------------------------- */

/**
 * Keyset-paginated question search.
 *
 * Uses the search_questions RPC rather than a PostgREST range query. Two
 * reasons: OFFSET pagination has to count past every skipped row, which
 * degrades as the bank grows; and an exact COUNT(*) on every keystroke of
 * the search box is the single most expensive thing an admin panel can
 * do. The RPC keysets on (updated_at, id) and switches to a planner
 * estimate for the total once the table is large enough to care.
 *
 * Pass the `next_cursor` from the previous response to page forward.
 */
export async function searchQuestions({
  search = '', status = null, ruleId = null, difficulty = null,
  minQuality = null, includeDeleted = false, limit = 25, cursor = null
} = {}) {
  return unwrap(
    await supabase.rpc('search_questions', {
      p_search: search || null,
      p_status: status || null,
      p_rule_id: ruleId || null,
      p_difficulty: difficulty || null,
      p_min_quality: minQuality || null,
      p_include_deleted: includeDeleted,
      p_limit: limit,
      p_cursor_updated_at: cursor?.updated_at || null,
      p_cursor_id: cursor?.id || null
    })
  );
}

/** Kept for callers that only need a plain page and no cursor. */
export async function listQuestions(options = {}) {
  const result = await searchQuestions(options);
  return { rows: result.rows, total: result.total, estimated: result.estimated,
           cursor: result.next_cursor };
}

export async function getQuestionForEdit(id) {
  return unwrap(
    await supabase
      .from('questions')
      .select('*, choices:answer_choices(*), rule:grammar_rules(id, slug, name)')
      .eq('id', id)
      .single()
  );
}

/**
 * Create or update a question and its four choices atomically enough for
 * an authoring UI: the question row first, then choices replaced wholesale.
 */
export async function saveQuestion(draft) {
  const authorId = store.get('user')?.id;
  const problems = validateDraft(draft);
  if (problems.length) throw new AppError(problems[0]);

  const payload = {
    rule_id: draft.rule_id,
    difficulty: draft.difficulty,
    passage: draft.passage.trim(),
    stem: draft.stem?.trim() || undefined,
    explanation: draft.explanation.trim(),
    skill: draft.skill.trim(),
    source_note: draft.source_note || null,
    status: draft.status || 'draft'
  };

  let question;
  if (draft.id) {
    question = unwrap(
      await supabase.from('questions').update(payload).eq('id', draft.id).select().single()
    );
    await supabase.from('answer_choices').delete().eq('question_id', draft.id);
  } else {
    const { data, error } = await supabase
      .from('questions')
      .insert({ ...payload, status: 'draft', author_id: authorId })
      .select().single();

    if (error?.code === '23505') {
      throw new AppError('A question with this exact passage already exists. Every question must be original.');
    }
    if (error) throw new AppError('Could not save the question.', { cause: error });
    question = data;
  }

  const choices = draft.choices.map((choice, index) => ({
    question_id: question.id,
    label: 'ABCD'[index],
    body: choice.body.trim(),
    rationale: choice.rationale.trim(),
    is_correct: index === draft.correct_index,
    sort_order: index
  }));

  const { error: choiceError } = await supabase.from('answer_choices').insert(choices);
  if (choiceError) throw new AppError('Could not save the answer choices.', { cause: choiceError });

  if (Array.isArray(draft.tags)) {
    await setQuestionTags(question.id, draft.tags);
  }

  // Publishing is a second step so the trigger can validate the choices.
  if (draft.status === 'published' && question.status !== 'published') {
    question = unwrap(
      await supabase.from('questions')
        .update({ status: 'published', reviewed_by: authorId, reviewed_at: new Date().toISOString() })
        .eq('id', question.id).select().single()
    );
  }

  return question;
}

export function validateDraft(draft) {
  const problems = [];
  if (!draft.rule_id) problems.push('Choose a grammar rule.');
  if (!draft.difficulty) problems.push('Choose a difficulty.');
  if (!draft.passage || draft.passage.trim().length < 10) problems.push('The passage is too short.');
  if (!draft.explanation || draft.explanation.trim().length < 20) problems.push('Write a fuller explanation.');
  if (!draft.skill) problems.push('Name the SAT skill this targets.');
  if (!Array.isArray(draft.choices) || draft.choices.length !== 4) {
    problems.push('Exactly four answer choices are required.');
  } else {
    draft.choices.forEach((choice, i) => {
      if (!choice.body?.trim()) problems.push(`Choice ${'ABCD'[i]} is empty.`);
      if (!choice.rationale?.trim()) problems.push(`Choice ${'ABCD'[i]} needs a rationale.`);
    });
    const bodies = draft.choices.map((c) => c.body?.trim().toLowerCase());
    if (new Set(bodies).size !== 4) problems.push('Two answer choices are identical.');
  }
  if (draft.correct_index === null || draft.correct_index === undefined) {
    problems.push('Mark which choice is correct.');
  }
  return problems;
}

export async function setStatus(id, status) {
  const reviewerId = store.get('user')?.id;
  return unwrap(
    await supabase.from('questions')
      .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
      .eq('id', id).select().single()
  );
}

export async function bulkSetStatus(ids, status) {
  return unwrap(
    await supabase.from('questions').update({ status }).in('id', ids).select('id')
  );
}

/* ---- Bulk import ------------------------------------------------------- */

/**
 * Import a JSON array of question drafts. Returns a per-row report so the
 * author can fix the failures rather than guessing. Used by the Phase 2
 * content pipeline.
 */
export async function importQuestions(rows, { onProgress } = {}) {
  const report = { created: 0, failed: [], duplicates: 0 };

  for (let i = 0; i < rows.length; i++) {
    try {
      await saveQuestion(rows[i]);
      report.created++;
    } catch (err) {
      if (err.message.includes('already exists')) report.duplicates++;
      else report.failed.push({ index: i, reason: err.message });
    }
    onProgress?.({ done: i + 1, total: rows.length, ...report });
  }
  return report;
}

/* ---- Reports, coverage, users ------------------------------------------ */

export async function listReports(status = 'open') {
  return unwrap(
    await supabase
      .from('question_reports')
      .select('*, question:questions(id, public_id, passage), reporter:profiles!question_reports_user_id_fkey(username)')
      .eq('status', status)
      .order('created_at', { ascending: false })
  );
}

export async function resolveReport(id, status = 'resolved') {
  return unwrap(
    await supabase.from('question_reports')
      .update({ status, resolved_by: store.get('user')?.id, resolved_at: new Date().toISOString() })
      .eq('id', id).select().single()
  );
}

export async function getCoverage() {
  return unwrap(await supabase.from('content_coverage').select('*'));
}

export async function listUsers({ search = '', limit = 50 } = {}) {
  // Goes through an RPC rather than a table select because email lives in
  // auth.users, which PostgREST does not expose. The function is admin-only
  // and joins the two, so emails never reach a non-admin client.
  const { data, error } = await supabase.rpc('admin_list_users',
    { p_search: search, p_limit: limit });
  if (error) throw error;
  return data || [];
}

/** Grant or revoke premium directly, outside the request queue. */
export async function setUserPremium(userId, isPremium, until = null) {
  const { data, error } = await supabase.rpc('set_premium', {
    p_user_id: userId, p_is_premium: isPremium, p_until: until
  });
  if (error) throw error;
  return data;
}

export async function setUserRole(userId, role) {
  return unwrap(
    await supabase.from('profiles').update({ role }).eq('id', userId).select().single()
  );
}

/** Questions whose observed p-value suggests the difficulty label is wrong. */
export async function getMiscalibrated({ minServed = 30 } = {}) {
  const rows = unwrap(
    await supabase
      .from('questions')
      .select('id, public_id, passage, difficulty, p_value, times_served, rule:grammar_rules(name)')
      .eq('status', 'published')
      .gte('times_served', minServed)
  );

  const expected = { easy: [0.75, 1], medium: [0.55, 0.85], hard: [0.35, 0.65], expert: [0, 0.5] };
  return rows.filter((q) => {
    const [lo, hi] = expected[q.difficulty] || [0, 1];
    return q.p_value < lo || q.p_value > hi;
  });
}

/* ---- Deletion and restoration ------------------------------------------ */

/**
 * Delete a question.
 *
 * The server decides between soft and hard deletion — it is not a caller
 * option, because getting it wrong is destructive. A question that any
 * student has attempted is retired and flagged `deleted_at`, so their
 * history stays explainable. A draft nobody has seen is removed outright.
 *
 * Returns { mode: 'soft' | 'hard', attempts_preserved }.
 */
export async function deleteQuestion(questionId, reason = null) {
  return unwrap(
    await supabase.rpc('delete_question', {
      p_question_id: questionId,
      p_reason: reason
    })
  );
}

export async function restoreQuestion(questionId) {
  return unwrap(
    await supabase.rpc('restore_question', { p_question_id: questionId })
  );
}

/** Bulk delete, reported per row so a partial failure is legible. */
export async function deleteQuestions(ids, reason = null, { onProgress } = {}) {
  const report = { soft: 0, hard: 0, failed: [] };
  for (let i = 0; i < ids.length; i++) {
    try {
      const result = await deleteQuestion(ids[i], reason);
      report[result.mode]++;
    } catch (err) {
      report.failed.push({ id: ids[i], reason: err.message });
    }
    onProgress?.({ done: i + 1, total: ids.length, ...report });
  }
  return report;
}

/* ---- Editorial quality -------------------------------------------------- */

/**
 * Rate how well a question is *written* — which is a different question
 * from how it *behaves*. p_value and discrimination measure behaviour and
 * are computed from attempts; this can only come from a human reading it.
 */
export async function rateQuestion(questionId, rating, notes = null) {
  return unwrap(
    await supabase.rpc('rate_question', {
      p_question_id: questionId,
      p_rating: rating,
      p_notes: notes
    })
  );
}

export async function getQualityReviews(questionId) {
  return unwrap(
    await supabase
      .from('question_quality_reviews')
      .select('rating, notes, created_at, reviewer:profiles(username)')
      .eq('question_id', questionId)
      .order('created_at', { ascending: false })
  );
}

/** Published questions nobody has rated yet — the editorial backlog. */
export async function getUnratedQuestions(limit = 50) {
  return unwrap(
    await supabase
      .from('questions')
      .select('id, public_id, passage, difficulty, created_at, rule:grammar_rules(name)')
      .eq('status', 'published')
      .is('deleted_at', null)
      .is('quality_rating', null)
      .order('created_at', { ascending: true })
      .limit(limit)
  );
}

/* ---- Rule administration ------------------------------------------------ */

export async function updateRule(ruleId, patch) {
  const allowed = ['name', 'summary', 'lesson_md', 'common_traps', 'sort_order',
                   'typical_difficulty', 'question_target', 'mastery_target',
                   'study_minutes', 'is_active'];
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([key]) => allowed.includes(key))
  );
  return unwrap(
    await supabase.from('grammar_rules').update(clean).eq('id', ruleId).select().single()
  );
}

/**
 * The materialised rule counts refresh on a schedule. Call this after a
 * bulk import so the coverage grid reflects the new rows immediately
 * rather than up to ten minutes later.
 */
export async function refreshRuleCounts() {
  const { error } = await supabase.rpc('refresh_rule_counts');
  // Non-fatal: the cron job rebuilds it within ten minutes anyway, so a
  // failure here is a staleness issue, not a correctness one.
  if (error) console.warn('[admin] rule count refresh failed:', error.message);
  return !error;
}

/* ---- Tags ---------------------------------------------------------------- */

export async function listTags() {
  return unwrap(await supabase.from('tags').select('*').order('name'));
}

export async function ensureTag(name) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existing = unwrap(
    await supabase.from('tags').select('*').eq('slug', slug).maybeSingle()
  );
  if (existing) return existing;
  return unwrap(
    await supabase.from('tags').insert({ slug, name: name.trim() }).select().single()
  );
}

export async function setQuestionTags(questionId, tagNames) {
  const tags = [];
  for (const name of tagNames) {
    if (name.trim()) tags.push(await ensureTag(name));
  }
  await supabase.from('question_tags').delete().eq('question_id', questionId);
  if (tags.length) {
    await supabase.from('question_tags').insert(
      tags.map((tag) => ({ question_id: questionId, tag_id: tag.id }))
    );
  }
  return tags;
}

export async function getQuestionTags(questionId) {
  const rows = unwrap(
    await supabase.from('question_tags').select('tag:tags(id, slug, name)')
      .eq('question_id', questionId)
  );
  return rows.map((row) => row.tag);
}

/* ==========================================================================
   Premium access: codes and the approval queue.

   Every one of these is a SECURITY DEFINER RPC that re-checks is_admin()
   server-side. Nothing here is load-bearing for security — it decides what
   the dashboard shows, not what the database will do.
   ========================================================================== */

export async function listPremiumCodes() {
  const { data, error } = await supabase.rpc('admin_list_premium_codes');
  if (error) throw error;
  return data || [];
}

export async function createPremiumCode({
  code = null, maxUses = 1, expiresAt = null, grantDays = null, note = null
} = {}) {
  const { data, error } = await supabase.rpc('admin_create_premium_code', {
    p_code: code || null,
    p_max_uses: Number(maxUses) || 1,
    p_expires_at: expiresAt || null,
    p_grant_days: grantDays ? Number(grantDays) : null,
    p_note: note || null
  });
  if (error) throw error;
  return data;
}

export async function setCodeActive(id, active) {
  const { data, error } = await supabase.rpc('admin_set_code_active',
    { p_id: id, p_active: active });
  if (error) throw error;
  return data;
}

export async function deletePremiumCode(id) {
  const { data, error } = await supabase.rpc('admin_delete_premium_code', { p_id: id });
  if (error) throw error;
  return data;
}

export async function listPremiumRequests(status = null) {
  const { data, error } = await supabase.rpc('admin_list_premium_requests',
    { p_status: status });
  if (error) throw error;
  return data || [];
}

/** The only client-side path that can turn premium on. Admin-gated in SQL. */
export async function reviewPremiumRequest(id, approve, { days = null, note = null } = {}) {
  const { data, error } = await supabase.rpc('review_premium_request', {
    p_request_id: id,
    p_approve: approve,
    p_days: days ? Number(days) : null,
    p_note: note || null
  });
  if (error) throw error;
  return data;
}
