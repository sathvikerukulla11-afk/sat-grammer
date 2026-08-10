/** Dashboard: at-a-glance state plus the fastest route back into practice. */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $ } from './core-dom.js';
import { store } from './core-store.js';
import { num, pct, duration, relativeTime, titleCase, masteryBand } from './core-format.js';
import { getStats, getRuleExtremes, getRecentSessions, getRecentAttempts,
         getRecommendations, getGoals, createGoal, deleteGoal } from './svc-progress.js';
import { renderRecommendations } from './ui-recommendations.js';
import { openModal, confirmDialog } from './ui-modal.js';
import { toastSuccess, toastError } from './ui-toast.js';
import { getRules } from './svc-questions.js';
import { getDailyChallenge, getDailyResult, findResumableSession } from './svc-practice.js';
import { dial } from './ui-charts.js';

await mountShell();
const profile = await requireAuth();
if (!profile) throw new Error('redirecting');

const stats = await getStats({ force: true });
const goal = profile.preferences?.daily_goal ?? 20;
const doneToday = stats?.questions_today ?? 0;

/* ---- banner ------------------------------------------------------------ */
const hour = new Date().getHours();
const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
$('#greeting').textContent = `${greeting}, ${profile.display_name || profile.username}`;

$('#goal-line').textContent = doneToday >= goal
  ? `Daily goal met — ${doneToday} questions today. Anything else is a bonus.`
  : `${doneToday} of ${goal} questions today. ${goal - doneToday} to go.`;

const resumable = await findResumableSession();
if (resumable) {
  const btn = $('#continue-btn');
  btn.textContent = 'Resume your session →';
  btn.href = `practice.html?session=${resumable.id}`;
}

/* ---- stat tiles -------------------------------------------------------- */
render($('#stat-tiles'), [
  ['Questions answered', num(stats?.total_answered ?? 0)],
  ['Accuracy', stats?.total_answered ? pct(stats.accuracy) : '—'],
  ['Current streak', `${stats?.current_streak ?? 0} day${stats?.current_streak === 1 ? '' : 's'}`],
  ['Study time', duration(stats?.total_time_ms ?? 0, 'long')]
].map(([label, value]) =>
  h('div.stat', {}, h('span.stat__label', {}, label), h('span.stat__value', {}, value))));

/* ---- recommendations --------------------------------------------------- */
getRecommendations(4)
  .then((recs) => renderRecommendations($('#recommendations'), recs))
  .catch(() => render($('#recommendations'),
    h('p.muted.text-sm', {}, 'We could’nt load your suggestions right now.')));

/* ---- quick actions ----------------------------------------------------- */
render($('#quick-actions'), [
  { href: 'practice.html?mode=adaptive', title: 'Adaptive practice',
    desc: 'It picks your weakest rules — you pick the level.' },
  { href: 'practice.html?mode=review', title: 'Review what you missed',
    desc: 'Questions you got wrong and have’nt fixed yet.' },
  { href: 'timed.html', title: 'Timed run',
    desc: 'Practice at real section pacing.' },
  { href: 'cheatsheets.html', title: 'Read a cheat sheet',
    desc: 'Two minutes on one rule, then practice it.' }
].map((action) =>
  h('a.quick-action', { href: action.href },
    h('span.quick-action__title', {}, action.title),
    h('span.quick-action__desc', {}, action.desc))));

/* ---- daily challenge ---------------------------------------------------- */
try {
  const [challenge, result] = await Promise.all([getDailyChallenge(), getDailyResult()]);
  render($('#daily-challenge'),
    result
      ? h('div.stack', {},
          h('div.row', {},
            dial(result.total ? result.correct / result.total : 0, { size: 72, label: 'Today' }),
            h('div', {},
              h('p', {}, h('strong', {}, `${result.correct} of ${result.total} correct`)),
              h('p.text-sm.muted', {}, `Finished ${relativeTime(result.completed_at)}.`))),
          h('a.btn.btn-ghost.btn-sm', { href: 'leaderboard.html?period=daily' }, 'See today’s board'))
      : h('div.stack', {},
          h('p.muted', {}, `${challenge.question_ids.length} questions, the same set for everyone, ` +
                           'until midnight in your timezone.'),
          h('a.btn.btn-primary', { href: 'practice.html?mode=daily&start=1' }, 'Take the challenge')));
} catch {
  render($('#daily-challenge'), h('p.muted', {}, 'The daily challenge is’nt loading right now.'));
}

/* ---- weakest rules ------------------------------------------------------ */
const { weakest, untouched } = await getRuleExtremes(3);
const focusRules = weakest.length ? weakest : untouched.slice(0, 4);

render($('#weak-rules'),
  focusRules.length
    ? h('div.stack-sm', {}, focusRules.slice(0, 4).map((row) => {
        const band = masteryBand(row.mastery);
        return h('a.row-between', {
          href: `rule.html?slug=${row.rule.slug}`,
          style: { textDecoration: 'none', color: 'inherit', padding: 'var(--space-2) 0' }
        },
          h('div', {},
            h('div', { style: { fontWeight: '500' } }, row.rule.name),
            h('div.text-xs.muted', {}, row.attempted
              ? `${row.correct}/${row.attempted} correct`
              : 'Not started')),
          h('span.mastery-label', { dataset: { band: band.band } }, band.label));
      }))
    : h('p.muted', {}, 'Answer a few questions and this fills in.'));

/* ---- recent sessions ---------------------------------------------------- */
const sessions = await getRecentSessions(5);
render($('#recent-sessions'),
  sessions.length
    ? h('div.stack-sm', {}, sessions.map((session) =>
        h('div.row-between', { style: { padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border)' } },
          h('div', {},
            h('div', { style: { fontWeight: '500' } }, titleCase(session.mode)),
            h('div.text-xs.muted', {}, relativeTime(session.started_at))),
          h('div', { style: { textAlign: 'right' } },
            h('div.tabular', {}, `${session.correct}/${session.answered}`),
            h('div.text-xs.muted', {}, duration(session.duration_ms, 'long'))))))
    : h('div.empty', {},
        h('p.empty__title', {}, 'No sessions yet'),
        h('p', {}, 'Your first practice set will show up here.'),
        h('a.btn.btn-primary.mt-4', { href: 'practice.html' }, 'Start one')));

/* ---- recent activity: one row per attempt ------------------------------- */
const attempts = await getRecentAttempts(8);
render($('#recent-activity'),
  attempts.length
    ? h('div.stack-sm', {}, attempts.map((attempt) =>
        h('div.row', {
          style: { padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border)' }
        },
          h('span', {
            'aria-hidden': 'true',
            style: {
              color: attempt.is_correct ? 'var(--success)' : 'var(--danger)',
              fontWeight: '700', width: '1.25em', flexShrink: '0'
            }
          }, attempt.is_correct ? '✓' : '✕'),
          h('div', { style: { flex: '1', minWidth: '0' } },
            h('div.truncate.text-sm', {}, attempt.question?.passage || 'Question removed'),
            h('div.text-xs.muted', {},
              `${attempt.rule?.name || 'Unknown rule'} · ${relativeTime(attempt.created_at)}`)),
          h('span.text-xs.subtle.tabular', { style: { flexShrink: '0' } },
            duration(attempt.time_ms, 'short')),
          h('span.visually-hidden', {}, attempt.is_correct ? 'Correct' : 'Incorrect')))) 
    : h('div.empty', {},
        h('p.empty__title', {}, 'Nothing yet'),
        h('p', {}, 'Answer a question and it appears here.')));

/* ---- goals -------------------------------------------------------------- */

const GOAL_LABELS = {
  daily_questions:  (g) => `${g.target} questions a day`,
  weekly_questions: (g) => `${g.target} questions a week`,
  streak:           (g) => `${g.target}-day streak`,
  accuracy:         (g) => `${g.target}% overall accuracy`,
  rule_mastery:     (g) => `Master ${g.rule?.name || 'a rule'} (${g.target}%)`
};

async function drawGoals() {
  let goals = [];
  try {
    goals = await getGoals();
  } catch {
    render($('#goals-list'), h('p.muted.text-sm', {}, 'We could’nt load your goals right now.'));
    return;
  }

  if (!goals.length) {
    render($('#goals-list'), h('p.muted.text-sm', {},
      'No goals set. A goal you can actually see is one you’re more likely to hit.'));
    return;
  }

  render($('#goals-list'), h('div.stack', {}, goals.map((goal) => {
    const current = Number(goal.current) || 0;
    const target = Number(goal.target) || 1;
    const ratio = Math.min(1, current / target);
    const done = Boolean(goal.achieved_at) || ratio >= 1;

    return h('div', { style: { paddingBottom: 'var(--space-3)' } },
      h('div.row-between', {},
        h('span', { style: { fontWeight: '500' } },
          done ? '✓ ' : '', (GOAL_LABELS[goal.kind] || (() => goal.kind))(goal)),
        h('div.row', {},
          h('span.text-sm.tabular.muted', {}, `${Math.round(current)} / ${target}`),
          h('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            'aria-label': 'Remove this goal',
            async onclick() {
              if (await confirmDialog({
                title: 'Remove this goal?',
                message: 'You can set it again at any time.',
                confirmLabel: 'Remove'
              })) {
                await deleteGoal(goal.id);
                drawGoals();
              }
            }
          }, '×'))),
      h('div.progress.progress--thin.mt-2', {
        role: 'progressbar',
        'aria-valuenow': String(Math.round(current)),
        'aria-valuemin': '0', 'aria-valuemax': String(target)
      },
        h('div.progress__fill', {
          style: { width: `${ratio * 100}%` },
          dataset: { tone: done ? 'success' : null }
        })));
  })));
}

$('#add-goal-btn').addEventListener('click', async () => {
  const rules = await getRules().catch(() => []);

  const kindSelect = h('select.select', { id: 'goal-kind' },
    h('option', { value: 'daily_questions' }, 'Questions per day'),
    h('option', { value: 'weekly_questions' }, 'Questions per week'),
    h('option', { value: 'streak' }, 'Consecutive days'),
    h('option', { value: 'accuracy' }, 'Overall accuracy (%)'),
    h('option', { value: 'rule_mastery' }, 'Mastery of one rule (%)'));

  const ruleSelect = h('select.select', { id: 'goal-rule' },
    rules.map((r) => h('option', { value: String(r.id) }, r.name)));
  const ruleField = h('div.field', { hidden: true },
    h('label.label', { for: 'goal-rule' }, 'Which rule?'), ruleSelect);

  const targetInput = h('input.input', {
    type: 'number', id: 'goal-target', min: '1', value: '20'
  });

  kindSelect.addEventListener('change', () => {
    ruleField.hidden = kindSelect.value !== 'rule_mastery';
    targetInput.value = { daily_questions: 20, weekly_questions: 100,
                          streak: 7, accuracy: 85, rule_mastery: 85 }[kindSelect.value];
  });

  openModal({
    title: 'Set a goal',
    body: h('div.stack', {},
      h('div.field', {}, h('label.label', { for: 'goal-kind' }, 'Goal type'), kindSelect),
      ruleField,
      h('div.field', {}, h('label.label', { for: 'goal-target' }, 'Target'), targetInput)),
    actions: [
      { label: 'Cancel', value: false },
      { label: 'Set goal', variant: 'btn-primary', async onClick() {
          try {
            await createGoal({
              kind: kindSelect.value,
              target: Number(targetInput.value),
              ruleId: kindSelect.value === 'rule_mastery' ? Number(ruleSelect.value) : null
            });
            toastSuccess('Goal set.');
            drawGoals();
          } catch (err) {
            toastError(err.message || 'Could not save that goal.');
          }
          return true;
        } }
    ]
  });
});

await drawGoals();

/* Keep the streak pill in the header honest if stats change mid-session. */
store.subscribe(() => {});
