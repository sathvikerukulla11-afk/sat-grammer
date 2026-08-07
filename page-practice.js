/**
 * Practice page: setup → session → results.
 *
 * The three views live in one document and swap by `hidden`, which keeps
 * the URL stable and lets a refresh resume from the session id.
 */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $, $$ } from './core-dom.js';
import { store } from './core-store.js';
import { num, pct, duration, titleCase, relativeTime } from './core-format.js';
import { getRules, reportQuestion } from './svc-questions.js';
import { getRuleCompletion } from './svc-progress.js';
import { startSession, getSession, findResumableSession,
         finishSession } from './svc-practice.js';
import { PracticeRunner } from './engine-session.js';
import { renderQuestionCard, bindShortcuts } from './ui-question-card.js';
import { toastError, toastSuccess } from './ui-toast.js';
import { openModal, confirmDialog } from './ui-modal.js';
import { barChart } from './ui-charts.js';
import { getRecommendations } from './svc-progress.js';
import { renderRecommendations } from './ui-recommendations.js';
import { CONFIG } from './config.js';

await mountShell();
const profile = await requireAuth();
if (!profile) throw new Error('redirecting');

const views = {
  setup: $('#setup-view'),
  session: $('#session-view'),
  results: $('#results-view')
};
const showView = (name) => {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  $('#main').focus();
};

/* ================================================================== */
/* Setup                                                              */
/* ================================================================== */

const params = new URLSearchParams(location.search);

const config = {
  mode: params.get('mode') || 'adaptive',
  ruleIds: new Set(),
  difficulties: new Set(),
  anyDifficulty: false,
  length: CONFIG.PRACTICE.DEFAULT_LENGTH,
  excludeSeen: true,
  instantFeedback: profile.preferences?.instant_feedback ?? true
};

const MODE_HELP = {
  adaptive: 'Adaptive picks your weakest rules and matches the difficulty to your current mastery.',
  mixed: 'A random draw across every rule and difficulty.',
  rule: 'Choose one or more grammar rules to drill.',
  difficulty: 'Draw only from the difficulty bands you pick.',
  review: 'Questions you answered incorrectly and have not since got right.',
  bookmarks: 'Only the questions you saved.',
  daily: 'Today’s challenge — the same ten questions everyone gets.'
};

const rules = await getRules();

// Completion tells the student how much of each rule's bank is left,
// which is the number that actually answers "what should I practice?".
const completion = await getRuleCompletion().catch(() => []);
const completionByRule = new Map(completion.map((row) => [row.rule_id, row]));

/* --- rule picker -------------------------------------------------------- */
render($('#rule-picker'), rules.map((rule) => {
  const progress = completionByRule.get(rule.id);
  const remaining = Math.max(0, (progress?.available ?? rule.question_count) - (progress?.seen ?? 0));
  const doneRatio = progress?.completion ?? 0;

  return h('button.chip', {
    type: 'button',
    'aria-pressed': 'false',
    dataset: { ruleId: String(rule.id) },
    title: `${rule.summary}\n\n${remaining} of ${progress?.available ?? rule.question_count} `
         + `unseen · ${Math.round(doneRatio * 100)}% of this topic completed`,
    onclick(event) {
      const id = Number(event.currentTarget.dataset.ruleId);
      const on = config.ruleIds.has(id);
      on ? config.ruleIds.delete(id) : config.ruleIds.add(id);
      event.currentTarget.setAttribute('aria-pressed', String(!on));
      updateSummary();
    }
  },
    h('span', {}, rule.name),
    h('span.text-xs', {
      style: { opacity: '0.75' },
      'aria-label': `${remaining} questions you have not seen`
    }, `${remaining} new`),
    doneRatio > 0
      ? h('span.text-xs', {
          style: {
            color: doneRatio >= 1 ? 'var(--success)' : 'inherit',
            opacity: doneRatio >= 1 ? '1' : '0.65'
          },
          'aria-label': `${Math.round(doneRatio * 100)} percent completed`
        }, doneRatio >= 1 ? '\u2713' : `${Math.round(doneRatio * 100)}%`)
      : null);
}));

$('#select-all-rules').addEventListener('click', () => {
  rules.forEach((rule) => config.ruleIds.add(rule.id));
  $$('#rule-picker .chip').forEach((chip) => chip.setAttribute('aria-pressed', 'true'));
  updateSummary();
});
$('#clear-rules').addEventListener('click', () => {
  config.ruleIds.clear();
  $$('#rule-picker .chip').forEach((chip) => chip.setAttribute('aria-pressed', 'false'));
  updateSummary();
});

/* --- mode / difficulty / length toggles --------------------------------- */
function bindToggleGroup(selector, onPick, { multi = false } = {}) {
  $$(selector).forEach((button) => {
    button.addEventListener('click', () => {
      if (multi) {
        button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      } else {
        $$(selector).forEach((b) => b.setAttribute('aria-pressed', 'false'));
        button.setAttribute('aria-pressed', 'true');
      }
      onPick(button);
      updateSummary();
    });
  });
}

bindToggleGroup('#mode-picker .chip', (button) => {
  config.mode = button.dataset.mode;
  $('#mode-description').textContent = MODE_HELP[config.mode];
  $('#rule-step').hidden = config.mode !== 'rule';
  // The daily challenge is a fixed set for everyone, so difficulty does not
  // apply. Every other mode now respects the choice, adaptive included.
  $('#difficulty-step').hidden = config.mode === 'daily';
});

/**
 * Difficulty is a required, explicit choice.
 *
 * It used to be optional — an empty selection silently meant "all levels",
 * and the whole step was hidden for adaptive mode, which is the default.
 * So most students never saw it and never chose. "Any level" is now a real
 * option they have to pick, rather than something they get by not looking.
 */
$$('#difficulty-picker .chip').forEach((button) => {
  button.addEventListener('click', () => {
    const value = button.dataset.difficulty;

    if (value === 'any') {
      config.difficulties.clear();
      config.anyDifficulty = !config.anyDifficulty;
    } else {
      config.anyDifficulty = false;
      config.difficulties.has(value)
        ? config.difficulties.delete(value)
        : config.difficulties.add(value);
    }

    $$('#difficulty-picker .chip').forEach((chip) => {
      const v = chip.dataset.difficulty;
      chip.setAttribute('aria-pressed', String(
        v === 'any' ? config.anyDifficulty : config.difficulties.has(v)));
    });

    $('#difficulty-error').hidden = true;
    updateSummary();
  });
});

/** True once the student has actually made a choice either way. */
function difficultyChosen() {
  return config.anyDifficulty || config.difficulties.size > 0;
}

bindToggleGroup('#length-picker .btn', (button) => {
  config.length = Number(button.dataset.length);
});

$('#exclude-seen').addEventListener('change', (e) => { config.excludeSeen = e.target.checked; });
$('#instant-feedback').addEventListener('change', (e) => { config.instantFeedback = e.target.checked; });

function updateSummary() {
  // How many unseen questions the current selection can actually draw from.
  const selected = config.ruleIds.size
    ? completion.filter((row) => config.ruleIds.has(row.rule_id))
    : completion;
  const pool = selected.reduce((sum, row) => sum + Math.max(0, row.available - row.seen), 0);

  render($('#set-summary'), [
    ['Mode', titleCase(config.mode)],
    ['Rules', config.ruleIds.size ? `${config.ruleIds.size} selected` : 'All'],
    ['Difficulty', config.difficulties.size
      ? [...config.difficulties].map(titleCase).join(', ')
      : (config.anyDifficulty ? 'Any level' : 'Not chosen yet')],
    ['Length', `${config.length} questions`],
    ['Unseen available', config.excludeSeen ? num(pool) : 'n/a — repeats allowed']
  ].flatMap(([term, value]) => [
    h('div.row-between', {}, h('dt.muted', {}, term), h('dd', {}, value))
  ]));

  // Warn before the student hits an empty draw rather than after, and do
  // not let them start until they have actually chosen a difficulty.
  const startBtn = $('#start-btn');
  const needsDifficulty = config.mode !== 'daily' && !difficultyChosen();
  const short = config.excludeSeen && pool > 0 && pool < config.length;
  const empty = config.excludeSeen && pool === 0 && ['rule', 'difficulty', 'mixed'].includes(config.mode);

  startBtn.textContent = needsDifficulty
    ? 'Choose a difficulty first'
    : empty
      ? 'No unseen questions left — uncheck "skip seen"'
      : short
        ? `Start practicing (${pool} available)`
        : 'Start practicing';
  startBtn.disabled = needsDifficulty || empty;
}

// Apply mode from the URL, then paint the summary.
$$('#mode-picker .chip').forEach((chip) =>
  chip.setAttribute('aria-pressed', String(chip.dataset.mode === config.mode)));
$('#mode-description').textContent = MODE_HELP[config.mode] || '';
$('#rule-step').hidden = config.mode !== 'rule';
$('#difficulty-step').hidden = config.mode === 'daily';
if (params.get('rule')) {
  const match = rules.find((r) => r.slug === params.get('rule'));
  if (match) {
    config.mode = 'rule';
    config.ruleIds.add(match.id);
    $('#rule-step').hidden = false;
    $(`#rule-picker [data-rule-id="${match.id}"]`)?.setAttribute('aria-pressed', 'true');
    $$('#mode-picker .chip').forEach((c) =>
      c.setAttribute('aria-pressed', String(c.dataset.mode === 'rule')));
  }
}
updateSummary();

/* --- resume banner ------------------------------------------------------- */
const resumable = await findResumableSession();
if (resumable && !params.get('session')) {
  const banner = $('#resume-banner');
  banner.hidden = false;
  render(banner,
    h('div.alert.alert-info', {},
      h('div', {},
        h('strong', {}, 'You have an unfinished session. '),
        `${resumable.answered} of ${resumable.total_questions} answered, `,
        `${resumable.correct} correct. Started ${relativeTime(resumable.started_at)}.`,
        h('div.text-sm.mt-1', {},
          'Your answers are saved — you will pick up on question ',
          String(Math.min(resumable.answered + 1, resumable.total_questions)), '.')),
      h('div.spacer'),
      h('div.row', {},
        h('button.btn.btn-sm.btn-ghost', {
          type: 'button',
          async onclick() {
            if (await confirmDialog({
              title: 'Discard this session?',
              message: `${resumable.answered} answers are already recorded and will `
                     + 'stay in your statistics. Only the unfinished set is closed.',
              confirmLabel: 'Discard', danger: true
            })) {
              await finishSession(resumable.id).catch(() => {});
              banner.hidden = true;
            }
          }
        }, 'Discard'),
        h('button.btn.btn-sm.btn-primary', {
          type: 'button', onclick: () => launch(resumable)
        }, 'Resume'))));
}

/* ================================================================== */
/* Session                                                            */
/* ================================================================== */

let runner = null;
let unbindShortcuts = null;

$('#start-btn').addEventListener('click', async () => {
  if (config.mode !== 'daily' && !difficultyChosen()) {
    $('#difficulty-error').hidden = false;
    $('#difficulty-picker').scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  const button = $('#start-btn');
  button.dataset.loading = 'true';
  try {
    const session = await startSession(config.mode, {
      rule_ids: [...config.ruleIds],
      difficulties: [...config.difficulties],
      length: config.length,
      exclude_seen: config.excludeSeen
    });
    await launch(session);
  } catch (err) {
    toastError(err.message, { title: 'Could not start' });
  } finally {
    delete button.dataset.loading;
  }
});

async function launch(session) {
  runner = new PracticeRunner({
    session,
    mode: session.mode,
    instantFeedback: config.instantFeedback
  });

  runner.onChange(paint);
  runner.onDone(showResults);

  showView('session');
  $('#question-container').setAttribute('aria-busy', 'true');
  await runner.load();
  $('#question-container').setAttribute('aria-busy', 'false');

  if (profile.preferences?.keyboard_shortcuts !== false) {
    unbindShortcuts = bindShortcuts(runner);
  }

  history.replaceState(null, '', `?session=${session.id}`);
  window.addEventListener('beforeunload', warnOnLeave);

  if (runner.restored > 0) {
    toastSuccess(
      `${runner.restored} answer${runner.restored === 1 ? '' : 's'} restored. `
      + `Continuing on question ${runner.index + 1}.`,
      { title: 'Session resumed' });
  }
}

function warnOnLeave(event) {
  if (runner && !runner.finished && runner.answered < runner.total) {
    event.preventDefault();
    event.returnValue = '';
  }
}

function paint() {
  renderQuestionCard($('#question-container'), runner);

  $('#progress-count').textContent = `${runner.answered} / ${runner.total}`;
  $('#progress-fill').style.width = `${(runner.answered / runner.total) * 100}%`;
  $('#live-accuracy').textContent = runner.answered ? pct(runner.accuracy) : '—';

  render($('#session-dots'), runner.dotStates().map((state, i) =>
    h('button.session-dot', {
      type: 'button',
      role: 'listitem',
      dataset: { state },
      'aria-label': `Question ${i + 1}: ${state}`,
      onclick: () => runner.goTo(i)
    }, String(i + 1))));
}

$('#end-session-btn').addEventListener('click', async () => {
  const confirmed = await confirmDialog({
    title: 'End this session?',
    message: `You have answered ${runner.answered} of ${runner.total}. ` +
             'Your answers so far are already saved.',
    confirmLabel: 'End session'
  });
  if (confirmed) runner.finish();
});

$('#report-btn').addEventListener('click', () => {
  const question = runner?.current;
  if (!question) return;

  const select = h('select.select', { id: 'report-reason' },
    [['wrong_answer_key', 'The answer key looks wrong'],
     ['unclear_wording', 'The wording is unclear'],
     ['typo', 'There is a typo'],
     ['explanation_error', 'The explanation is wrong'],
     ['duplicate', 'I have seen this exact question before'],
     ['other', 'Something else']
    ].map(([value, label]) => h('option', { value }, label)));

  const detail = h('textarea.textarea', { id: 'report-detail', placeholder: 'Optional detail…' });

  openModal({
    title: 'Report a problem',
    body: h('div.stack', {},
      h('p.text-sm.muted', {}, `Question ${question.public_id}`),
      h('div.field', {}, h('label.label', { for: 'report-reason' }, 'What is wrong?'), select),
      h('div.field', {}, h('label.label', { for: 'report-detail' }, 'Detail'), detail)),
    actions: [
      { label: 'Cancel', value: false },
      { label: 'Send report', variant: 'btn-primary', async onClick() {
          try {
            await reportQuestion(question.id, select.value, detail.value || null);
            toastSuccess('Thanks — a moderator will look at it.');
          } catch (err) {
            toastError(err.message);
          }
          return true;
        } }
    ]
  });
});

/* ================================================================== */
/* Results                                                            */
/* ================================================================== */

function showResults(summary) {
  window.removeEventListener('beforeunload', warnOnLeave);
  unbindShortcuts?.();
  showView('results');

  const message =
    summary.accuracy >= 0.9 ? 'Excellent run.' :
    summary.accuracy >= 0.75 ? 'Solid work.' :
    summary.accuracy >= 0.5 ? 'Good progress — the misses are the useful part.' :
    'Rough set. Those are exactly the ones worth reviewing.';

  render($('#results-container'),
    h('div.results-hero', {},
      h('p.eyebrow', {}, 'Session complete'),
      h('div.results-hero__score', {}, `${summary.correct}/${summary.answered}`),
      h('p.lead', {}, `${pct(summary.accuracy)} accuracy · ${duration(summary.durationMs, 'long')}`),
      h('p', {}, message)),

    h('div.grid.grid-3.mt-8', {},
      statTile('Answered', num(summary.answered)),
      statTile('Average time', duration(summary.durationMs / Math.max(summary.answered, 1), 'short')),
      statTile('Missed', num(summary.answered - summary.correct))),

    summary.byRule.length
      ? h('section.card.mt-8', {},
          h('h2.h4', {}, 'Accuracy by rule'),
          h('div.mt-5#rule-breakdown'))
      : null,

    summary.missed.length
      ? h('section.card.mt-6', {},
          h('h2.h4', {}, `${summary.missed.length} to review`),
          h('p.text-sm.muted', {}, 'These are already queued in your review list.'),
          h('div.stack-sm.mt-4', {}, summary.missed.slice(0, 10).map((question) =>
            h('div', { style: { paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--border)' } },
              h('div.text-xs.muted', {}, question.rule.name),
              h('div.text-sm', {}, truncate(question.passage, 140))))))
      : null,

    h('section.card.mt-6', {},
      h('h2.h4', {}, 'What to do next'),
      h('p.text-sm.muted', {}, 'Based on everything you have answered, not just this set.'),
      h('div.mt-5#next-steps', {},
        h('div.skeleton.skeleton-text', { style: { height: '80px' } }))),

    h('div.row-wrap.mt-8', { style: { justifyContent: 'center' } },
      h('a.btn.btn-primary.btn-lg', { href: 'practice.html' }, 'Practice again'),
      summary.missed.length
        ? h('a.btn.btn-lg', { href: 'practice.html?mode=review&difficulty=any&start=1' }, 'Drill what I missed')
        : null,
      h('a.btn.btn-ghost.btn-lg', { href: 'progress.html' }, 'See my progress')));

  if (summary.byRule.length) {
    barChart($('#rule-breakdown'),
      summary.byRule.map((row) => ({ label: row.name, value: row.correct / row.total })),
      { tone: (v) => (v >= 0.8 ? 'success' : v >= 0.5 ? 'warning' : 'danger') });
  }

  // Recommendations are computed server-side from the student's whole
  // history, so they arrive after the results are already on screen.
  getRecommendations(3)
    .then((recs) => renderRecommendations($('#next-steps'), recs))
    .catch(() => render($('#next-steps'),
      h('p.muted.text-sm', {}, 'Recommendations are unavailable right now.')));
}

function statTile(label, value) {
  return h('div.stat', {}, h('span.stat__label', {}, label), h('span.stat__value', {}, value));
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

/* ---- auto-start from a URL parameter ----------------------------------- */
if (params.get('session')) {
  const existing = await getSession(params.get('session')).catch(() => null);
  if (existing?.status === 'active') await launch(existing);
} else if (params.get('start') === '1') {
  // A link may carry the difficulty, e.g. ?mode=rule&difficulty=hard&start=1.
  const fromUrl = (params.get('difficulty') || '').split(',').filter(Boolean);
  for (const level of fromUrl) {
    if (level === 'any') config.anyDifficulty = true;
    else if (CONFIG.DIFFICULTIES.includes(level)) config.difficulties.add(level);
  }
  $$('#difficulty-picker .chip').forEach((chip) => {
    const v = chip.dataset.difficulty;
    chip.setAttribute('aria-pressed', String(
      v === 'any' ? config.anyDifficulty : config.difficulties.has(v)));
  });
  updateSummary();

  // Only skip the setup screen when the link actually said which level to
  // practise. Otherwise land on setup with the mode preselected, so the
  // student makes the choice instead of having one made for them.
  if (config.mode === 'daily' || difficultyChosen()) {
    $('#start-btn').click();
  } else {
    $('#difficulty-picker').scrollIntoView({ block: 'center' });
  }
}
