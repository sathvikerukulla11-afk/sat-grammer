/**
 * Grammar Coach: the premium study plan and advanced analytics.
 *
 * Both RPCs refuse outright without entitlement, so this page does not try
 * to render a degraded version — it shows the upgrade screen instead. The
 * client-side isPremium() check only decides which screen to draw first;
 * the server decides what data exists.
 */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $ } from './core-dom.js';
import { pct, num, dateShort, titleCase } from './core-format.js';
import { getStudyPlan, getAdvancedAnalytics, isPremium, UPGRADE_URL } from './svc-premium.js';
import { toastError } from './ui-toast.js';

await mountShell();
if (!await requireAuth()) throw new Error('redirecting');

const body = $('#coach-body');

if (!isPremium()) {
  render(body, lockedScreen());
  throw new Error('locked');
}

render($('#coach-controls'),
  h('a.btn', { href: 'progress.html' }, 'Basic progress'),
  h('a.btn.btn-premium', { href: 'practice.html?mode=adaptive&start=1' }, 'Practice now'));

render(body, h('p.muted.mt-6', {}, 'Loading your plan…'));

let plan, stats;
try {
  [plan, stats] = await Promise.all([getStudyPlan(4), getAdvancedAnalytics(60)]);
} catch (err) {
  // The most likely cause is premium lapsing between page load and now.
  render(body, lockedScreen(err.message));
  throw err;
}

render(body,
  planSection(plan),
  h('hr.mt-10'),
  analyticsSection(stats));

/* ---- the plan ----------------------------------------------------------- */
function planSection(p) {
  const weeks = p?.plan || [];

  return h('section.mt-8', {},
    h('div.row-between', {},
      h('h2.h3', {}, 'Your four-week plan'),
      h('span.text-sm.muted', {},
        p.overall_mastery != null
          ? `Overall mastery ${pct(p.overall_mastery)}`
          : 'No mastery data yet')),

    p.rules_untouched
      ? h('p.text-sm.muted.mt-2', {},
          `${p.rules_untouched} rule${p.rules_untouched === 1 ? '' : 's'} you have’nt tried yet — `
          + 'those are ranked first, because an untried rule is unknown rather than mastered.')
      : null,

    !weeks.length
      ? h('div.empty.mt-6', {},
          h('p.empty__title', {}, 'Nothing to plan yet'),
          h('p', {}, 'Answer a few questions and the plan will build itself from your results.'),
          h('a.btn.btn-primary.mt-4', { href: 'practice.html' }, 'Start practicing'))
      : h('div.stack-lg.mt-6', {}, weeks.map(weekCard))
  );
}

function weekCard(w) {
  return h('div.card', {},
    h('div.row-between', {},
      h('h3.card__title', {}, `Week ${w.week}`),
      h('span.badge', {}, `${w.focus.length} rule${w.focus.length === 1 ? '' : 's'}`)),

    h('div.stack-sm.mt-4', {}, w.focus.map((f) =>
      h('div', { style: {
          padding: 'var(--space-4)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-sunken)'
        } },
        h('div.row-between', {},
          h('strong', {}, f.rule),
          h('span.text-xs.muted', {}, f.domain)),

        h('div.progress.progress--thin.mt-2', {
          role: 'progressbar',
          'aria-valuenow': String(Math.round((f.mastery || 0) * 100)),
          'aria-valuemin': '0', 'aria-valuemax': '100',
          'aria-label': `Mastery of ${f.rule}`
        }, h('div.progress__fill', { style: { width: `${(f.mastery || 0) * 100}%` } })),

        h('p.text-sm.muted.mt-2', {}, f.why),

        h('div.row-wrap.mt-3', {},
          f.cheat_sheet
            ? h('a.btn.btn-sm', { href: `cheatsheet.html?rule=${f.cheat_sheet}` }, 'Read the sheet')
            : null,
          h('a.btn.btn-sm.btn-primary', {
            href: `practice.html?rule=${f.rule_slug}&difficulty=any&start=1`
          }, `Practice (${f.available_questions})`),
          h('span.text-xs.muted', { style: { alignSelf: 'center' } },
            f.attempted ? `${num(f.attempted)} answered · ${pct(f.mastery)} mastery` : 'not started')))))
  );
}

/* ---- analytics ---------------------------------------------------------- */
function analyticsSection(s) {
  if (!s || !s.attempts) {
    return h('section.mt-10', {},
      h('h2.h3', {}, 'Your numbers'),
      h('div.empty.mt-6', {},
        h('p.empty__title', {}, 'Not enough history yet'),
        h('p', {}, 'These need a few sessions before they can tell you anything useful.')));
  }

  return h('section.mt-10', {},
    h('div.row-between', {},
      h('h2.h3', {}, 'Your numbers'),
      h('span.text-sm.muted', {}, `Last ${s.window_days} days · ${num(s.attempts)} answered`)),

    projectionCard(s.projection),

    h('h3.h5.mt-8', {}, 'Week by week'),
    table(['Week starting', 'Answered', 'Accuracy', 'Median time'],
      (s.weekly || []).map((w) => [
        dateShort(w.week_starting), num(w.attempts), pct(w.accuracy), `${w.median_seconds}s`
      ]), 'No weekly data in this window.'),

    h('h3.h5.mt-8', {}, 'Pacing by difficulty'),
    h('p.text-sm.muted', {},
      'Fast and wrong on hard items usually means guessing. Slow and right means the method '
      + 'works and needs repetition, not rethinking.'),
    table(['Difficulty', 'Answered', 'Accuracy', 'Median time'],
      (s.pacing || []).map((p) => [
        titleCase(p.difficulty), num(p.attempts), pct(p.accuracy), `${p.median_seconds}s`
      ]), 'No pacing data in this window.'),

    h('h3.h5.mt-8', {}, 'Which rules moved'),
    h('p.text-sm.muted', {},
      'The first half of the window against the second. Only rules with at least four '
      + 'attempts on both sides appear, since anything less is noise.'),
    trendTable(s.rule_trends || []));
}

function projectionCard(p) {
  if (!p) return null;

  if (!p.available) {
    return h('div.alert.alert-info.mt-6', {}, h('div', {},
      h('strong', {}, 'Projection not available yet. '), p.note));
  }

  return h('div.card.mt-6', { dataset: { accent: 'gold' } },
    h('div.text-sm.muted', {}, 'Indicative grammar band'),
    h('div', { style: {
        fontSize: 'var(--text-4xl)',
        fontWeight: 'var(--weight-bold)',
        letterSpacing: '-0.03em',
        color: 'var(--cs-text, var(--text))'
      } }, `${p.grammar_band_low}–${p.grammar_band_high}`),
    // Saying this plainly matters more than the number does.
    h('p.text-sm.muted.mt-2', {}, p.note),
    h('p.text-xs.subtle.mt-1', {}, `Based on ${num(p.basis_attempts)} answers on this site.`));
}

function table(headers, rows, emptyText) {
  if (!rows.length) return h('p.muted.text-sm.mt-3', {}, emptyText);

  return h('div.table-wrap.mt-3', {},
    h('table.table', {},
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, rows.map((r) =>
        h('tr', {}, r.map((cell, i) =>
          i === 0 ? h('th', { scope: 'row' }, cell) : h('td', {}, cell)))))));
}

function trendTable(rows) {
  if (!rows.length) {
    return h('p.muted.text-sm.mt-3', {},
      'Not enough repeat practice on any single rule yet to show movement.');
  }

  return h('div.table-wrap.mt-3', {},
    h('table.table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Rule'),
        h('th', { scope: 'col' }, 'Answered'),
        h('th', { scope: 'col' }, 'Earlier'),
        h('th', { scope: 'col' }, 'Recent'),
        h('th', { scope: 'col' }, 'Change'))),
      h('tbody', {}, rows.map((t) =>
        h('tr', {},
          h('th', { scope: 'row' },
            h('a', { href: `cheatsheet.html?rule=${t.rule_slug}` }, t.rule)),
          h('td', {}, num(t.attempts)),
          h('td', {}, pct(t.earlier)),
          h('td', {}, pct(t.recent)),
          h('td', {},
            h(`span.${t.change > 0 ? 'text-success' : t.change < 0 ? 'text-error' : 'muted'}`, {},
              `${t.change > 0 ? '+' : ''}${Math.round(t.change * 100)} pts`)))))));
}

/* ---- locked ------------------------------------------------------------- */
function lockedScreen(message) {
  return h('div.cs-locked.mt-8', {},
    h('div.cs-locked__preview', { 'aria-hidden': 'true', inert: true },
      h('div.stack-sm', {}, Array.from({ length: 8 }, (_, i) =>
        h('div', { style: {
          height: i % 3 === 0 ? '1.4em' : '1em',
          width: ['100%', '88%', '72%', '94%'][i % 4],
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-sunken)'
        } })))),

    h('div.cs-locked__veil', { role: 'region', 'aria-label': 'Premium feature locked' },
      h('div.cs-locked__icon', { 'aria-hidden': 'true' }, '🔒'),
      h('h2.cs-locked__title', {}, 'Premium Feature'),
      h('p.cs-locked__body', {},
        message
        || 'Your study plan and advanced analytics are part of Premium. Your practice, '
           + 'progress page, streaks and every free cheat sheet stay exactly as they are.'),
      h('ul.cs-locked__list', { role: 'list' }, [
        'A week-by-week plan built from your weakest rules',
        'Accuracy and pacing trends over time',
        'Which rules improved and which slipped',
        'An indicative grammar band'
      ].map((x) => h('li', {}, x))),
      h('div.row-wrap', { style: { justifyContent: 'center' } },
        h('a.btn.btn-premium.btn-lg', { href: UPGRADE_URL }, 'Upgrade'),
        h('a.btn.btn-lg', { href: 'progress.html' }, 'See free progress'))));
}
