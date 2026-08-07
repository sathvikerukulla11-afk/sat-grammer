/** Progress page — one RPC, then everything renders from it. */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $ } from './core-dom.js';
import { num, pct, duration, relativeTime, titleCase, masteryBand } from './core-format.js';
import { getOverview, getRuleCompletion, getMistakeAnalysis,
         getRecommendations } from './svc-progress.js';
import { renderRecommendations } from './ui-recommendations.js';
import { exportMyData } from './svc-profile.js';
import { barChart, heatmap } from './ui-charts.js';
import { toastSuccess, toastError } from './ui-toast.js';

await mountShell();
if (!await requireAuth()) throw new Error('redirecting');

const [overview, completion] = await Promise.all([
  getOverview(),
  getRuleCompletion().catch(() => [])
]);
const stats = overview.stats || {};
const rules = overview.rules || [];
const completionByRule = new Map(completion.map((row) => [row.rule_id, row]));

/* ---- headline ------------------------------------------------------------ */
render($('#headline-stats'), [
  ['Answered', num(stats.total_answered ?? 0)],
  ['Accuracy', stats.total_answered ? pct(stats.accuracy) : '—'],
  ['Average time', stats.total_answered ? duration(stats.avg_time_ms, 'short') : '—'],
  ['Total study time', duration(stats.total_time_ms ?? 0, 'long')]
].map(([label, value]) =>
  h('div.stat', {}, h('span.stat__label', {}, label), h('span.stat__value', {}, value))));

/* ---- calendar ------------------------------------------------------------ */
$('#streak-summary').textContent =
  `Current streak ${stats.current_streak ?? 0} · longest ${stats.longest_streak ?? 0}`;
heatmap($('#calendar'), overview.calendar || [], { weeks: 26 });

/* ---- weakest / strongest ------------------------------------------------- */
const practiced = rules.filter((r) => r.attempted >= 5);
const sorted = [...practiced].sort((a, b) => a.mastery - b.mastery);

drawExtreme($('#weakest'), sorted.slice(0, 6),
  'Answer at least five questions in a rule and it shows up here.');
drawExtreme($('#strongest'), sorted.slice(-6).reverse(),
  'Nothing has reached a reliable level yet — that is normal early on.');

function drawExtreme(container, rows, emptyMessage) {
  if (!rows.length) {
    render(container, h('p.muted.text-sm', {}, emptyMessage));
    return;
  }
  barChart(container,
    rows.map((row) => ({ label: row.name, value: row.mastery, slug: row.slug })),
    { tone: (v) => (v >= 0.85 ? 'success' : v >= 0.6 ? null : v >= 0.35 ? 'warning' : 'danger') });
}

/* ---- mastery table -------------------------------------------------------- */
render($('#mastery-table'), rules.map((row) => {
  const band = masteryBand(row.mastery);
  return h('tr', {},
    h('th', { scope: 'row', style: { fontWeight: '500' } },
      h('a', { href: `rule.html?slug=${row.slug}` }, row.name)),
    h('td.muted', {}, row.domain),
    h('td.num', {}, num(row.attempted)),
    h('td.num', {}, row.attempted ? pct(row.accuracy) : '—'),
    h('td.num', {}, row.attempted ? duration(row.avg_time_ms, 'short') : '—'),
    h('td', {},
      h('div.row', {},
        h('div.progress.progress--thin', { style: { width: '80px' } },
          h('div.progress__fill', {
            style: { width: `${Math.round(row.mastery * 100)}%` },
            dataset: { tone: row.mastery >= 0.85 ? 'success' : row.mastery >= 0.5 ? null : 'danger' }
          })),
        h('span.mastery-label', { dataset: { band: band.band } }, band.label))),
    h('td', {}, completionCell(completionByRule.get(row.rule_id))),
    h('td', {},
      h('a.btn.btn-sm.btn-ghost', { href: `practice.html?rule=${row.slug}&difficulty=any&start=1` }, 'Drill')));
}));

function completionCell(progress) {
  if (!progress || !progress.available) {
    return h('span.subtle.text-xs', {}, 'No questions yet');
  }
  const ratio = progress.completion;
  return h('div.row', {},
    h('div.progress.progress--thin', { style: { width: '70px' } },
      h('div.progress__fill', {
        style: { width: `${Math.round(ratio * 100)}%` },
        dataset: { tone: ratio >= 1 ? 'success' : null }
      })),
    h('span.text-xs.tabular', {
      'aria-label': `${progress.seen} of ${progress.available} questions seen`
    }, `${progress.seen}/${progress.available}`));
}

/* ---- sessions table -------------------------------------------------------- */
const sessions = overview.recent_sessions || [];
render($('#sessions-table'),
  sessions.length
    ? sessions.map((session) =>
        h('tr', {},
          h('td', {}, relativeTime(session.started_at)),
          h('td', {}, titleCase(session.mode)),
          h('td.num', {}, `${session.correct}/${session.answered}`),
          h('td.num', {}, session.answered ? pct(session.correct / session.answered) : '—'),
          h('td.num', {}, duration(session.duration_ms, 'long'))))
    : h('tr', {}, h('td', { colspan: '5', class: 'muted' }, 'No completed sessions yet.')));

/* ---- export ---------------------------------------------------------------- */
$('#export-btn').addEventListener('click', async (event) => {
  event.currentTarget.dataset.loading = 'true';
  try {
    const payload = await exportMyData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = h('a', {
      href: URL.createObjectURL(blob),
      download: `sat-grammar-lab-export-${new Date().toISOString().slice(0, 10)}.json`
    });
    link.click();
    URL.revokeObjectURL(link.href);
    toastSuccess('Your data has been downloaded.');
  } catch (err) {
    toastError(err.message);
  } finally {
    delete event.currentTarget.dataset.loading;
  }
});


/* ================================================================== */
/* Mistake patterns                                                   */
/* ================================================================== */

getRecommendations(4)
  .then((recs) => renderRecommendations($('#recommendations'), recs))
  .catch(() => render($('#recommendations'),
    h('p.muted.text-sm', {}, 'Recommendations are unavailable right now.')));

getMistakeAnalysis().then(drawInsights).catch(() =>
  render($('#insights-body'), h('p.muted', {}, 'The analysis is unavailable right now.')));

function drawInsights(analysis) {
  if (!analysis.ready) {
    render($('#insights-body'), h('div.empty', {},
      h('p.empty__title', {}, 'Not enough data yet'),
      h('p', {}, `You have answered ${analysis.attempts} question` +
                 `${analysis.attempts === 1 ? '' : 's'}. ` +
                 'Around ten is where this starts telling you something you could not ' +
                 'have guessed.'),
      h('a.btn.btn-primary.mt-4', { href: 'practice.html?mode=mixed&difficulty=any&start=1' },
        'Answer a few more')));
    return;
  }

  render($('#insights-body'),
    h('div.grid.grid-2', {},
      costlyRulesCard(analysis.costly_rules),
      pacingCard(analysis.pacing)),
    h('div.grid.grid-2.mt-6', {},
      fatigueCard(analysis.fatigue),
      difficultyCard(analysis.by_difficulty)),
    analysis.repeat_offenders?.length ? repeatCard(analysis.repeat_offenders) : null);
}

/* Ranked by points lost, not by accuracy. A 40% rule you have answered
   twice is noise; a 70% rule you have answered ninety times is where
   the score actually is. */
function costlyRulesCard(rules) {
  return h('section.card', {},
    h('h3.h4', {}, 'Where you actually lose points'),
    h('p.text-sm.muted', {}, 'Ranked by questions missed, not by accuracy — a bad ' +
      'percentage over three questions is not worth your afternoon.'),
    rules?.length
      ? h('div.stack-sm.mt-5', {}, rules.map((rule) =>
          h('a.row-between', {
            href: `practice.html?rule=${rule.slug}&difficulty=any&start=1`,
            style: { textDecoration: 'none', color: 'inherit',
                     padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border)' }
          },
            h('div', {},
              h('div', { style: { fontWeight: '500' } }, rule.name),
              h('div.text-xs.muted', {},
                `${rule.missed} missed of ${rule.attempted} · ${pct(rule.accuracy)} accurate`)),
            h('span.badge.badge-danger', {}, `−${rule.missed}`))))
      : h('p.muted.mt-4', {}, 'No rule stands out yet.'));
}

/* The gap between time-on-correct and time-on-incorrect is the single
   most diagnostic number here. Negative means guessing; positive means
   the student knows something is wrong but cannot find it. */
function pacingCard(pacing) {
  const ok = Number(pacing?.avg_correct_ms) || 0;
  const bad = Number(pacing?.avg_incorrect_ms) || 0;
  const gap = bad - ok;

  let verdict, tone;
  if (!ok || !bad) {
    verdict = 'Not enough timing data yet.'; tone = null;
  } else if (gap < -5000) {
    verdict = 'You answer the ones you get wrong faster than the ones you get right. ' +
              'That is the signature of a distractor that looked obviously correct — ' +
              'slow down on the ones that feel easy.';
    tone = 'danger';
  } else if (gap > 20000) {
    verdict = 'You spend much longer on the ones you miss. You are recognising that ' +
              'something is wrong but not what — which is a knowledge gap, not a pacing one.';
    tone = 'warning';
  } else {
    verdict = 'Your timing on right and wrong answers is close, which is what you want.';
    tone = 'success';
  }

  return h('section.card', {},
    h('h3.h4', {}, 'Rushing or labouring?'),
    h('div.grid.grid-2.mt-5', {},
      h('div.stat', {},
        h('span.stat__label', {}, 'When correct'),
        h('span.stat__value', { style: { fontSize: 'var(--text-2xl)' } }, duration(ok, 'short'))),
      h('div.stat', {},
        h('span.stat__label', {}, 'When wrong'),
        h('span.stat__value', { style: { fontSize: 'var(--text-2xl)' } }, duration(bad, 'short')))),
    h(`p.text-sm.mt-4${tone ? '' : '.muted'}`, {
      style: tone ? { color: `var(--${tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'success'})` } : {}
    }, verdict),
    pacing?.fast_wrong
      ? h('p.text-xs.subtle.mt-2', {},
          `${pacing.fast_wrong} misses took under 15 seconds. ` +
          `${pacing.slow_wrong || 0} took over 90.`)
      : null);
}

function fatigueCard(fatigue) {
  const early = Number(fatigue?.early_accuracy) || 0;
  const late = Number(fatigue?.late_accuracy) || 0;
  const drop = early - late;

  return h('section.card', {},
    h('h3.h4', {}, 'Do you fade?'),
    h('p.text-sm.muted', {}, 'Accuracy in the first half of a set against the second.'),
    h('div.grid.grid-2.mt-5', {},
      h('div.stat', {},
        h('span.stat__label', {}, 'First half'),
        h('span.stat__value', { style: { fontSize: 'var(--text-2xl)' } },
          early ? pct(early) : '—')),
      h('div.stat', {},
        h('span.stat__label', {}, 'Second half'),
        h('span.stat__value', { style: { fontSize: 'var(--text-2xl)' } },
          late ? pct(late) : '—'))),
    h('p.text-sm.mt-4', {
      style: { color: drop > 0.1 ? 'var(--warning)' : 'var(--text-muted)' }
    }, !early || !late
        ? 'Finish a few more full sets and this becomes meaningful.'
        : drop > 0.1
          ? `You lose ${pct(drop)} of your accuracy in the back half of a set. ` +
            'Shorter sets, more often, will score better than long ones.'
          : 'You hold your accuracy through a full set.'));
}

function difficultyCard(byDifficulty) {
  const rows = ['easy', 'medium', 'hard', 'expert']
    .filter((d) => byDifficulty?.[d])
    .map((d) => ({ label: titleCase(d), value: byDifficulty[d].accuracy,
                   n: byDifficulty[d].attempted }));

  return h('section.card', {},
    h('h3.h4', {}, 'Accuracy by difficulty'),
    h('p.text-sm.muted', {}, 'Where the wheels come off.'),
    rows.length
      ? h('div.bars.mt-5', {}, rows.map((row) =>
          h('div.bar-row', {},
            h('span.bar-row__label', {}, `${row.label} (${row.n})`),
            h('div.progress', { role: 'img',
              'aria-label': `${row.label}: ${pct(row.value)} over ${row.n} questions` },
              h('div.progress__fill', {
                style: { width: `${row.value * 100}%` },
                dataset: { tone: row.value >= 0.8 ? 'success'
                                 : row.value >= 0.5 ? 'warning' : 'danger' }
              })),
            h('span.bar-row__value', {}, pct(row.value)))))
      : h('p.muted.mt-4', {}, 'No data yet.'));
}

function repeatCard(offenders) {
  return h('section.card.mt-6', {},
    h('h3.h4', {}, 'Questions that keep catching you'),
    h('p.text-sm.muted', {}, 'You have missed each of these more than once.'),
    h('div.stack-sm.mt-5', {}, offenders.map((row) =>
      h('div', { style: { paddingBottom: 'var(--space-3)',
                          borderBottom: '1px solid var(--border)' } },
        h('div.row-between', {},
          h('span.text-xs.muted', {}, row.rule),
          h('span.badge.badge-danger', {}, `missed ${row.times_missed}×`)),
        h('p.text-sm.mt-1', { style: { fontFamily: 'var(--font-serif)' } },
          row.passage + '…')))),
    h('a.btn.btn-sm.btn-primary.mt-4', { href: 'review.html' }, 'Review these'));
}
