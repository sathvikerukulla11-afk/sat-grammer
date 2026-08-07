/**
 * Question and taxonomy reads.
 *
 * Note what is NOT here: nothing fetches `is_correct`. Students read the
 * `public_choices` view, which omits the key. Grading happens in the
 * record_attempt() RPC on the server.
 */
import { supabase } from './core-supabase.js';
import { unwrap } from './core-errors.js';
import { store } from './core-store.js';

/** Domains + rules + live question counts. Cached for the session. */
export async function getRules({ force = false } = {}) {
  const cached = store.get('rules');
  if (cached && !force) return cached;

  const rules = unwrap(
    await supabase.from('rule_catalog').select('*').order('sort_order')
  );
  store.set({ rules });
  return rules;
}

export async function getDomains() {
  return unwrap(
    await supabase.from('grammar_domains').select('*').order('sort_order')
  );
}

export async function getRuleBySlug(slug) {
  return unwrap(
    await supabase
      .from('grammar_rules')
      .select('*, domain:grammar_domains(*)')
      .eq('slug', slug)
      .single()
  );
}

export async function getSiteStats() {
  return unwrap(await supabase.from('site_stats').select('*').single());
}

/**
 * The answer key for a question the student has already engaged with.
 *
 * This deliberately does NOT select from `answer_choices` — RLS restricts
 * that table to staff, which is what keeps the key out of the network tab
 * during practice. The RPC checks that the caller has actually attempted
 * or bookmarked the question before handing over the answer.
 */
export async function getQuestionWithKey(questionId) {
  return unwrap(
    await supabase.rpc('get_question_review', { p_question_id: questionId })
  );
}

/** The student's own review queue (missed and not since corrected). */
export async function getReviewQueue({ limit = 50, ruleId = null } = {}) {
  let query = supabase
    .from('my_review_queue')
    .select('*')
    .order('last_wrong', { ascending: false })
    .limit(limit);
  if (ruleId) query = query.eq('rule_id', ruleId);
  return unwrap(await query);
}

export async function getBookmarks({ limit = 100 } = {}) {
  return unwrap(
    await supabase
      .from('bookmarks')
      .select(`
        created_at, note,
        question:questions(id, public_id, passage, difficulty,
                           rule:grammar_rules(slug, name))
      `)
      .order('created_at', { ascending: false })
      .limit(limit)
  );
}

export async function toggleBookmark(questionId, note = null) {
  return unwrap(
    await supabase.rpc('toggle_bookmark', { p_question_id: questionId, p_note: note })
  );
}

export async function reportQuestion(questionId, reason, detail = null) {
  const userId = store.get('user')?.id;
  return unwrap(
    await supabase.from('question_reports').insert({
      question_id: questionId, user_id: userId, reason, detail
    }).select().single()
  );
}

/** Free sample for logged-out visitors on the home page. */
export async function getSampleQuestions(limit = 3) {
  const questions = unwrap(
    await supabase
      .from('questions')
      .select('id, public_id, passage, stem, difficulty, skill, rule:grammar_rules(slug, name)')
      .eq('status', 'published')
      .limit(limit)
  );

  if (!questions?.length) return [];

  const choices = unwrap(
    await supabase
      .from('public_choices')
      .select('id, question_id, label, body')
      .in('question_id', questions.map((q) => q.id))
      .order('label')
  );

  const byQuestion = new Map();
  for (const choice of choices) {
    if (!byQuestion.has(choice.question_id)) byQuestion.set(choice.question_id, []);
    byQuestion.get(choice.question_id).push(choice);
  }
  return questions.map((q) => ({ ...q, choices: byQuestion.get(q.id) || [] }));
}
