/**
 * Timed practice. Same runner as untimed, plus a per-question countdown
 * and feedback deferred to the end.
 */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $, $$ } from './core-dom.js';
import { pct, duration, num } from './core-format.js';
import { startSession, findResumableSession } from './svc-practice.js';
import { PracticeRunner } from './engine-session.js';
import { Countdown, formatClock } from './engine-timer.js';
import { renderQuestionCard, bindShortcuts } from './ui-question-card.js';
import { toastError, toastSuccess } from './ui-toast.js';
import { confirmDialog } from './ui-modal.js';
import { barChart } from './ui-charts.js';
import { getRecommendations } from './svc-progress.js';
import { renderRecommendations } from './ui-recommendations.js';
import { CONFIG } from './config.js';

await mountShell();
const profile = await requireAuth();
if (!profile) throw new Error('redirecting');

const views = { setup: $('#setup-view'), session: $('#session-view'), results: $('#results-view') };
const showView = (name) => {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
};

const config = {
  seconds: CONFIG.PRACTICE.DEFAULT_TIMED_SECONDS,
  length: 20,
  difficulties: new Set()
};

function bindGroup(selector, handler, { multi = false } = {}) {
  $$(selector).forEach((button) => button.addEventListener('click', () => {
    if (multi) {
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    } else {
      $$(selector).forEach((b) => b.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
    }
    handler(button);
  }));
}

bindGroup('#seconds-picker .btn', (b) => { config.seconds = Number(b.dataset.seconds); });
bindGroup('#length-picker .btn', (b) => { config.length = Number(b.dataset.length); });
bindGroup('#difficulty-picker .chip', (b) => {
  const value = b.dataset.difficulty;
  config.difficulties.has(value) ? config.difficulties.delete(value) : config.difficulties.add(value);
}, { multi: true });

let runner = null;
let countdown = null;
let unbindShortcuts = null;
let runStartedAt = 0;
let totalTimer = null;

async function begin(session) {
    runner = new PracticeRunner({ session, mode: 'timed', instantFeedback: false });
    runner.onChange(paint);
    runner.onDone(showResults);

    showView('session');
    await runner.load();

    unbindShortcuts = bindShortcuts(runner);
    // Carry forward the time already banked, so a resumed run reports the
    // true total rather than restarting the clock at zero.
    runStartedAt = Date.now() - (runner.resumedMs || 0);
    totalTimer = setInterval(() => {
      $('#total-elapsed').textContent = formatClock((Date.now() - runStartedAt) / 1000);
    }, 1000);

    startCountdown();

    if (runner.restored > 0) {
      toastSuccess(
        `${runner.restored} answer${runner.restored === 1 ? '' : 's'} restored. `
        + `Continuing on question ${runner.index + 1}.`,
        { title: 'Run resumed' });
    }
}

$('#start-btn').addEventListener('click', async () => {
  const button = $('#start-btn');
  button.dataset.loading = 'true';
  try {
    await begin(await startSession('timed', {
      difficulties: [...config.difficulties],
      length: config.length,
      seconds_per_question: config.seconds,
      exclude_seen: true
    }));
  } catch (err) {
    toastError(err.message, { title: 'Could not start' });
  } finally {
    delete button.dataset.loading;
  }
});

/*
 * Resuming a timed run.
 *
 * The per-question countdown restarts at full time rather than resuming
 * mid-question. Freezing a countdown across hours and handing back four
 * seconds would be worse than useless, and the honest alternative — a
 * fresh clock on the question they never answered — is what a proctor
 * would do.
 */
const resumableTimed = await findResumableSession().catch(() => null);
if (resumableTimed && resumableTimed.mode === 'timed') {
  config.seconds = Number(resumableTimed.config?.seconds_per_question) || config.seconds;
  const banner = h('div.alert.alert-info.mb-6', {},
    h('div', {},
      h('strong', {}, 'You have an unfinished timed run. '),
      `${resumableTimed.answered} of ${resumableTimed.total_questions} answered. `,
      h('div.text-sm.mt-1', {},
        'Your answers are saved. The clock restarts on the question you '
        + 'never reached.')),
    h('div.spacer'),
    h('button.btn.btn-sm.btn-primary', {
      type: 'button',
      async onclick() {
        showView('session');
        await begin(resumableTimed);
      }
    }, 'Resume run'));
  $('#setup-view').prepend(banner);
}

function startCountdown() {
  countdown?.stop();
  countdown = new Countdown(config.seconds, {
    onTick(remaining) {
      const el = $('#timer');
      el.textContent = formatClock(remaining);
      el.dataset.state = countdown.state;
      // Announce only at the threshold, so the region is not chatty.
      el.setAttribute('aria-live', remaining === 10 ? 'assertive' : 'off');
    },
    async onExpire() {
      // Time up counts as a skip: not marked wrong, but queued for review.
      if (!runner.isGraded) await runner.skip();
      else await runner.next();
    }
  });
  countdown.start();
}

function paint() {
  renderQuestionCard($('#question-container'), runner);

  $('#progress-count').textContent = `${runner.answered} / ${runner.total}`;
  $('#progress-fill').style.width = `${(runner.answered / runner.total) * 100}%`;

  render($('#session-dots'), runner.dotStates().map((state, i) =>
    h('span.session-dot', {
      role: 'listitem', dataset: { state }, 'aria-label': `Question ${i + 1}: ${state}`
    }, String(i + 1))));

  // In timed mode the runner advances itself; reset the clock each time.
  if (!runner.finished && countdown && countdown.remaining !== config.seconds) {
    const currentIndex = runner.index;
    if (currentIndex !== paint._lastIndex) {
      paint._lastIndex = currentIndex;
      countdown.reset(config.seconds);
      countdown.start();
    }
  }
}
paint._lastIndex = 0;

$('#end-session-btn').addEventListener('click', async () => {
  const confirmed = await confirmDialog({
    title: 'End the run?',
    message: 'Your answers so far are saved. You will see the results screen.',
    confirmLabel: 'End run'
  });
  if (confirmed) runner.finish();
});

function showResults(summary) {
  countdown?.stop();
  clearInterval(totalTimer);
  unbindShortcuts?.();
  showView('results');

  const perQuestion = summary.durationMs / Math.max(summary.answered, 1);
  const paceNote = perQuestion <= config.seconds * 0.7
    ? 'Comfortably inside the clock.'
    : perQuestion <= config.seconds
      ? 'Right at pace.'
      : 'Running over — worth practicing the same rules untimed first.';

  render($('#results-container'),
    h('div.results-hero', {},
      h('p.eyebrow', {}, 'Timed run complete'),
      h('div.results-hero__score', {}, `${summary.correct}/${summary.answered}`),
      h('p.lead', {}, `${pct(summary.accuracy)} accuracy · ${duration(summary.durationMs, 'long')} total`),
      h('p', {}, paceNote)),

    h('div.grid.grid-4.mt-8', {},
      tile('Answered', num(summary.answered)),
      tile('Correct', num(summary.correct)),
      tile('Avg. per question', duration(perQuestion, 'short')),
      tile('Clock allowed', `${config.seconds}s`)),

    summary.byRule.length
      ? h('section.card.mt-8', {},
          h('h2.h4', {}, 'Accuracy by rule'),
          h('div.mt-5#rule-breakdown'))
      : null,

    h('section.card.mt-6', {},
      h('h2.h4', {}, 'What to do next'),
      h('div.mt-5#next-steps', {},
        h('div.skeleton.skeleton-text', { style: { height: '80px' } }))),

    h('div.row-wrap.mt-8', { style: { justifyContent: 'center' } },
      h('a.btn.btn-primary.btn-lg', { href: 'timed.html' }, 'Run it again'),
      h('a.btn.btn-lg', { href: 'review.html' }, 'Review the misses'),
      h('a.btn.btn-ghost.btn-lg', { href: 'progress.html' }, 'See my progress')));

  if (summary.byRule.length) {
    barChart($('#rule-breakdown'),
      summary.byRule.map((r) => ({ label: r.name, value: r.correct / r.total })),
      { tone: (v) => (v >= 0.8 ? 'success' : v >= 0.5 ? 'warning' : 'danger') });
  }

  getRecommendations(3)
    .then((recs) => renderRecommendations($('#next-steps'), recs))
    .catch(() => render($('#next-steps'),
      h('p.muted.text-sm', {}, 'Recommendations are unavailable right now.')));
}

const tile = (label, value) =>
  h('div.stat', {}, h('span.stat__label', {}, label), h('span.stat__value', {}, value));
