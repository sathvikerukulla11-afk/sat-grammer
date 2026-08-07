/** Cheat sheet reads and per-student progress. */
import { supabase } from './core-supabase.js';
import { unwrap } from './core-errors.js';

export async function listCheatSheets() {
  return unwrap(await supabase.rpc('list_cheat_sheets'));
}

/**
 * One sheet plus everything the page needs: the rule, the practice
 * question WITHOUT its answer key, the student's progress and mastery,
 * related rules, and the prev/next neighbours — in a single round trip.
 *
 * Calling this also records the visit, which is why it is not cached.
 */
export async function getCheatSheet(slug) {
  return unwrap(await supabase.rpc('get_cheat_sheet', { p_slug: slug }));
}

export async function setRuleProgress(ruleId, { completed = null, favorited = null } = {}) {
  return unwrap(await supabase.rpc('set_rule_progress', {
    p_rule_id: ruleId, p_completed: completed, p_favorited: favorited
  }));
}
