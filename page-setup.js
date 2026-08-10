/**
 * Connection and installation diagnostics.
 *
 * Each check is a small async function returning
 *   { ok, detail, fix? }
 * so a failure tells you what to do rather than just that something broke.
 */
import { mountShell } from './ui-shell.js';
import { h, render, $ } from './core-dom.js';
import { CONFIG, ENV_STATUS } from './config.js';
import { supabase } from './core-supabase.js';
import { store } from './core-store.js';

await mountShell({ skipAuth: !ENV_STATUS.configured });

/* ---- environment panel ---------------------------------------------------- */
const maskedKey = CONFIG.SUPABASE_ANON_KEY
  ? `${CONFIG.SUPABASE_ANON_KEY.slice(0, 8)}…${CONFIG.SUPABASE_ANON_KEY.slice(-4)}`
  : '(not set)';

render($('#env-info'), [
  ['Config source', ENV_STATUS.source],
  ['Supabase URL', CONFIG.SUPABASE_URL || '(not set)'],
  ['Publishable key', maskedKey],
  ['Base path', CONFIG.BASE_PATH || '(root)'],
  ['Page origin', location.origin]
].flatMap(([term, value]) =>
  h('div.row-between', {},
    h('dt.muted', {}, term),
    h('dd.mono.text-xs', { style: { wordBreak: 'break-all' } }, value))));

/* ---- the checks ------------------------------------------------------------ */
const CHECKS = [
  {
    name: 'Environment is configured',
    async run() {
      if (!ENV_STATUS.configured) {
        return {
          ok: false,
          detail: `No usable credentials found (source: ${ENV_STATUS.source}).`,
          fix: 'Copy env.example.js to env.js and fill in ' +
               'your project URL and publishable key from Supabase → Settings → API.'
        };
      }
      return { ok: true, detail: `Loaded from ${ENV_STATUS.source}.` };
    }
  },
  {
    name: 'Supabase is reachable',
    async run() {
      const started = performance.now();
      const { error } = await supabase.from('grammar_domains').select('id').limit(1);
      const ms = Math.round(performance.now() - started);
      if (error) {
        return {
          ok: false,
          detail: `${error.message} (${error.code || 'no code'})`,
          fix: 'Check the URL and key are from the same project, and that the ' +
               'project is not paused in the Supabase dashboard.'
        };
      }
      return { ok: true, detail: `Round trip ${ms} ms.` };
    }
  },
  {
    name: 'Schema is installed',
    async run() {
      const tables = ['profiles', 'grammar_rules', 'questions', 'answer_choices',
                      'attempts', 'user_stats', 'achievements'];
      const missing = [];
      for (const table of tables) {
        const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(0);
        // 42P01 is "relation does not exist". A permission error means the
        // table exists, which is all this check cares about.
        if (error && error.code === '42P01') missing.push(table);
      }
      return missing.length
        ? { ok: false, detail: `Missing: ${missing.join(', ')}.`,
            fix: 'Run supabase/migrations/0001–0009 in order in the SQL Editor.' }
        : { ok: true, detail: `All ${tables.length} core tables present.` };
    }
  },
  {
    name: 'Taxonomy is seeded',
    async run() {
      const { count: domains } = await supabase
        .from('grammar_domains').select('*', { head: true, count: 'exact' });
      const { count: rules } = await supabase
        .from('grammar_rules').select('*', { head: true, count: 'exact' });

      if (!domains || !rules) {
        return { ok: false, detail: 'No domains or rules found.',
                 fix: 'Run supabase/seed/0001_domains_and_rules.sql.' };
      }
      return { ok: true, detail: `${domains} domains, ${rules} grammar rules.` };
    }
  },
  {
    name: 'Achievements are seeded',
    async run() {
      const { count } = await supabase
        .from('achievements').select('*', { head: true, count: 'exact' });
      return count
        ? { ok: true, detail: `${count} achievements defined.` }
        : { ok: false, detail: 'No achievements found.',
            fix: 'Run supabase/seed/0002_achievements.sql.' };
    }
  },
  {
    name: 'Questions are available',
    async run() {
      const { data, error } = await supabase.from('site_stats').select('*').single();
      if (error) {
        return { ok: false, detail: error.message,
                 fix: 'Run supabase/migrations/0008_views.sql.' };
      }
      if (!data.question_count) {
        return { ok: false, detail: 'The bank is empty.',
                 fix: 'Run supabase/seed/0003_sample_questions.sql, or ' +
                      'supabase/seed/0004_placeholder_questions.sql for a fuller test set.' };
      }
      return { ok: true, detail: `${data.question_count} published questions.` };
    }
  },
  {
    name: 'Answer key is NOT readable by the browser',
    critical: true,
    async run() {
      // The single most important check on this page. If it fails, every
      // student can read the answers out of the network tab.
      const { data, error } = await supabase
        .from('answer_choices').select('id, is_correct').limit(1);

      if (error) {
        return { ok: true, detail: `Blocked by the database (${error.code || 'RLS'}). Correct.` };
      }
      if (Array.isArray(data) && data.length === 0) {
        return { ok: true, detail: 'Returns no rows to this role. Correct.' };
      }
      return {
        ok: false,
        detail: 'answer_choices returned rows including is_correct.',
        fix: 'Run supabase/migrations/0007_rls.sql. It enables RLS on the ' +
             'table and revokes the default grants that Supabase applies.'
      };
    }
  },
  {
    name: 'Public choice view works (without the key)',
    async run() {
      const { data, error } = await supabase
        .from('public_choices').select('*').limit(1);
      if (error) {
        return { ok: false, detail: error.message,
                 fix: 'Run supabase/migrations/0007_rls.sql, which creates public_choices.' };
      }
      if (!data.length) return { ok: true, detail: 'View exists but the bank is empty.' };
      if ('is_correct' in data[0]) {
        return { ok: false, detail: 'The view is leaking is_correct.',
                 fix: 'Re-create public_choices from 0007_rls.sql.' };
      }
      return { ok: true, detail: `Returns ${Object.keys(data[0]).join(', ')}.` };
    }
  },
  {
    name: 'Rule catalog view works',
    async run() {
      const { data, error } = await supabase
        .from('rule_catalog').select('slug, question_count').limit(5);
      return error
        ? { ok: false, detail: error.message, fix: 'Run supabase/migrations/0008_views.sql.' }
        : { ok: true, detail: `${data.length} rules readable with live counts.` };
    }
  },
  {
    name: 'Practice RPCs are callable',
    needsAuth: true,
    async run() {
      const { error } = await supabase.rpc('start_session', {
        p_mode: 'mixed', p_config: { length: 1 }
      });
      if (error && error.code === '42883') {
        return { ok: false, detail: 'start_session does not exist.',
                 fix: 'Run supabase/migrations/0006_functions.sql.' };
      }
      if (error && error.code === '42501') {
        return { ok: false, detail: 'Permission denied on start_session.',
                 fix: 'Run the grants at the end of supabase/migrations/0007_rls.sql.' };
      }
      if (error && error.code === 'P0002') {
        return { ok: true, detail: 'Callable. (No questions matched, which is fine here.)' };
      }
      if (error) return { ok: false, detail: `${error.message} (${error.code})` };
      return { ok: true, detail: 'A session was created successfully.' };
    }
  },
  {
    name: 'Your profile row exists',
    needsAuth: true,
    async run() {
      const userId = store.get('user')?.id;
      const { data, error } = await supabase
        .from('profiles').select('username, role').eq('id', userId).maybeSingle();
      if (error) return { ok: false, detail: error.message };
      if (!data) {
        return { ok: false, detail: 'No profile row for your account.',
                 fix: 'The handle_new_user trigger did not fire. Re-run ' +
                      'supabase/migrations/0006_functions.sql, then register again.' };
      }
      return { ok: true, detail: `@${data.username}, role: ${data.role}.` };
    }
  },
  {
    name: 'Your stats row exists',
    needsAuth: true,
    async run() {
      const userId = store.get('user')?.id;
      const { data } = await supabase
        .from('user_stats').select('total_answered, current_streak')
        .eq('user_id', userId).maybeSingle();
      return data
        ? { ok: true, detail: `${data.total_answered} answered, ${data.current_streak} day streak.` }
        : { ok: false, detail: 'No user_stats row.',
            fix: 'Same cause as the profile check — the signup trigger did not run.' };
    }
  },
  {
    name: 'Role escalation is blocked',
    needsAuth: true,
    critical: true,
    async run() {
      const userId = store.get('user')?.id;
      const { error } = await supabase
        .from('profiles').update({ role: 'admin' }).eq('id', userId).select();

      if (error) return { ok: true, detail: `Rejected: ${error.message}` };

      // If it succeeded, undo it immediately and shout.
      await supabase.from('profiles').update({ role: 'student' }).eq('id', userId);
      return {
        ok: false,
        detail: 'A client-side role change SUCCEEDED. Anyone can make themselves admin.',
        fix: 'Run the tg_guard_profile_role trigger from supabase/migrations/0002_identity.sql.'
      };
    }
  },
  {
    name: 'Phase 3 schema is installed',
    async run() {
      const { data, error } = await supabase
        .from('rule_catalog')
        .select('slug, typical_difficulty, question_target, bank_completeness')
        .limit(1);
      if (error) {
        return { ok: false, detail: error.message,
                 fix: 'Run supabase/migrations/0010_question_bank.sql and 0011_scale.sql.' };
      }
      if (!data.length) return { ok: true, detail: 'View exists but no rules are seeded.' };
      if (!('typical_difficulty' in data[0]) || !('bank_completeness' in data[0])) {
        return { ok: false, detail: 'rule_catalog is missing the Phase 3 columns.',
                 fix: 'Run supabase/migrations/0011_scale.sql, which rebuilds the view.' };
      }
      return { ok: true, detail: 'Rule metadata and bank completeness present.' };
    }
  },
  {
    name: 'Materialized rule counts are populated',
    async run() {
      const { data, error } = await supabase
        .from('rule_question_counts').select('rule_id, question_count').limit(200);
      if (error) {
        return { ok: false, detail: error.message,
                 fix: 'Run supabase/migrations/0011_scale.sql.' };
      }
      const total = data.reduce((sum, row) => sum + (row.question_count || 0), 0);
      if (!data.length) {
        return { ok: false, detail: 'The materialized view is empty.',
                 fix: 'Run: select public.refresh_rule_counts();' };
      }
      return { ok: true, detail: `${data.length} rules, ${total} published questions counted.` };
    }
  },
  {
    name: 'Admin search RPC works',
    needsAuth: true,
    async run() {
      const { data, error } = await supabase.rpc('search_questions', { p_limit: 1 });
      if (error && error.code === '42883') {
        return { ok: false, detail: 'search_questions does not exist.',
                 fix: 'Run supabase/migrations/0011_scale.sql.' };
      }
      if (error && error.code === '42501') {
        return { ok: true, detail: 'Correctly refused — you are not editorial staff.' };
      }
      if (error) return { ok: false, detail: `${error.message} (${error.code})` };
      return { ok: true, detail: `Returned ${data.rows?.length ?? 0} row(s), total ${data.total}.` };
    }
  },
  {
    name: 'Topic completion RPC works',
    needsAuth: true,
    async run() {
      const { data, error } = await supabase.rpc('get_rule_completion');
      if (error) {
        return { ok: false, detail: `${error.message} (${error.code})`,
                 fix: 'Run supabase/migrations/0011_scale.sql.' };
      }
      const withBank = data.filter((row) => row.available > 0).length;
      return { ok: true, detail: `${data.length} rules, ${withBank} with questions available.` };
    }
  },
  {
    name: 'Deleted questions are hidden from students',
    critical: true,
    async run() {
      // A soft-deleted question must not be reachable through any
      // student-facing path. If one leaks, a retired item keeps being
      // served after an editor pulled it.
      const { data, error } = await supabase
        .from('questions').select('id, deleted_at').not('deleted_at', 'is', null).limit(1);
      if (error) return { ok: true, detail: `Blocked by the database (${error.code}). Correct.` };
      if (data.length) {
        return { ok: false, detail: 'A soft-deleted question was readable.',
                 fix: 'Run supabase/migrations/0010_question_bank.sql, which replaces the ' +
                      'questions_read_published policy with one that excludes deleted rows.' };
      }
      return { ok: true, detail: 'No deleted questions are visible to this role.' };
    }
  },
  {
    name: 'Phase 4-8 schema is installed',
    needsAuth: true,
    async run() {
      const results = await Promise.all([
        supabase.rpc('get_recommendations', { p_limit: 1 }),
        supabase.rpc('get_mistake_analysis'),
        supabase.rpc('get_goals')
      ]);
      const missing = ['get_recommendations', 'get_mistake_analysis', 'get_goals']
        .filter((_, i) => results[i].error?.code === '42883');
      if (missing.length) {
        return { ok: false, detail: `Missing: ${missing.join(', ')}.`,
                 fix: 'Run supabase/migrations/0012_platform.sql.' };
      }
      const failed = results.find((r) => r.error);
      if (failed) return { ok: false, detail: `${failed.error.message} (${failed.error.code})` };
      return { ok: true, detail: 'Recommendations, mistake analysis, and goals all respond.' };
    }
  },
  {
    name: 'Feedback can be filed',
    async run() {
      const { error } = await supabase.from('feedback')
        .select('id', { head: true, count: 'exact' }).limit(0);
      if (error?.code === '42P01') {
        return { ok: false, detail: 'The feedback table does not exist.',
                 fix: 'Run supabase/migrations/0012_platform.sql.' };
      }
      return { ok: true, detail: 'Feedback table reachable.' };
    }
  },
  {
    name: 'Empty answer choices are permitted',
    async run() {
      // "No added punctuation" is a legitimate and often correct option.
      // The original CHECK required at least one character, which would
      // reject 24 of the authored questions.
      const { data, error } = await supabase
        .from('public_choices').select('body').eq('body', '').limit(1);
      if (error) return { ok: false, detail: error.message };
      return data.length
        ? { ok: true, detail: 'Empty-body choices exist and are readable.' }
        : { ok: true, detail: 'No empty-body choices yet — fine if the bank is small.' };
    }
  },
  {
    name: 'Leaderboard rebuilds itself',
    needsAuth: true,
    async run() {
      // This one exists because the leaderboard failed silently for real.
      // It is a precomputed snapshot, and the refresh was scheduled only
      // through pg_cron — which this tier does not have. The table stayed
      // empty and qualifying students were invisible, with no error
      // anywhere to say so.
      const { data, error } = await supabase.rpc('get_leaderboard',
        { p_period: 'weekly', p_limit: 1 });
      if (error?.code === '42883') {
        return { ok: false, detail: 'get_leaderboard does not exist.',
                 fix: 'Run supabase/migrations/0019_leaderboard_refreshes_without_cron.sql.' };
      }
      if (error) return { ok: false, detail: `${error.message} (${error.code})` };
      const n = data.rows?.length ?? 0;
      return { ok: true,
               detail: n
                 ? `${n} ranked this week; snapshot refreshed ${data.refreshed_at ? 'just now or recently' : 'never'}.`
                 : 'Callable, and nobody has answered ten questions this week yet.' };
    }
  },
  {
    name: 'Avatar storage bucket exists',
    async run() {
      const { data, error } = await supabase.storage.from('avatars').list('', { limit: 1 });
      if (error) {
        return { ok: false, detail: error.message,
                 fix: 'Run supabase/migrations/0009_storage_and_cron.sql.' };
      }
      return { ok: true, detail: 'Bucket reachable.' };
    }
  }
];

/* ---- runner ---------------------------------------------------------------- */
$('#run-btn').addEventListener('click', runAll);

async function runAll() {
  const button = $('#run-btn');
  button.dataset.loading = 'true';
  render($('#results'));
  $('#summary').hidden = true;

  const signedIn = Boolean(store.get('session'));
  let passed = 0, failed = 0, skipped = 0, criticalFailed = 0;

  for (const check of CHECKS) {
    if (check.needsAuth && !signedIn) {
      skipped++;
      $('#results').append(row(check.name, 'skip',
        'Sign in to run this check.',
        'Register an account, then come back to this page.'));
      continue;
    }

    let result;
    try {
      result = await check.run();
    } catch (err) {
      result = { ok: false, detail: err.message || String(err) };
    }

    if (result.ok) passed++;
    else { failed++; if (check.critical) criticalFailed++; }

    $('#results').append(row(check.name, result.ok ? 'pass' : 'fail', result.detail, result.fix));
  }

  const summary = $('#summary');
  summary.hidden = false;
  render(summary,
    h(`div.alert.alert-${criticalFailed ? 'error' : failed ? 'warning' : 'success'}`, {},
      h('div', {},
        h('strong', {}, criticalFailed
          ? `${criticalFailed} SECURITY CHECK FAILED — do not launch.`
          : failed
            ? `${failed} check${failed === 1 ? '' : 's'} failed.`
            : 'Everything passed.'),
        h('p.mt-1', {}, `${passed} passed · ${failed} failed · ${skipped} skipped`),
        !signedIn
          ? h('p.mt-2', {}, 'Four checks need a signed-in account. ',
              h('a', { href: 'register.html' }, 'Create one'), ' and run this again.')
          : null)));

  delete button.dataset.loading;
}

function row(name, state, detail, fix) {
  const glyph = { pass: '✓', fail: '✕', skip: '–' }[state];
  const colour = { pass: 'var(--success)', fail: 'var(--danger)', skip: 'var(--text-subtle)' }[state];

  return h('div.card.card-pad-sm', {},
    h('div.row', {},
      h('span', {
        style: { color: colour, fontWeight: '700', fontSize: 'var(--text-lg)', width: '1.5em' },
        'aria-hidden': 'true'
      }, glyph),
      h('div', { style: { flex: '1' } },
        h('div', { style: { fontWeight: '600' } }, name,
          h('span.visually-hidden', {}, `: ${state}`)),
        h('div.text-sm.muted.mt-1', {}, detail),
        fix && state === 'fail'
          ? h('div.alert.alert-warning.mt-3.text-sm', {}, h('div', {}, h('strong', {}, 'Fix: '), fix))
          : null)));
}

// Run once on load so the page is useful without a click.
await runAll();
