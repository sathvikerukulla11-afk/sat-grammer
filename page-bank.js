/**
 * Question Bank — a browse layer over the existing practice system.
 *
 * It adds NO answering logic. Opening a question creates a real one-question
 * session and hands it to the same PracticeRunner and renderQuestionCard the
 * practice page uses, so attempts, mastery, streaks, flagging, bookmarking
 * and explanations all behave exactly as they do in Practice. If the answer
 * flow ever changes, this page changes with it for free.
 *
 * The list itself is metadata only. browse_questions() returns bank number,
 * skill, difficulty and the caller's own status — never a passage, a stem or
 * a choice — so browsing cannot reveal an answer.
 */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $, $$ } from './core-dom.js';
import { num, titleCase } from './core-format.js';
import { getRules } from './svc-questions.js';
import { browseQuestions, startSessionFromQuestions } from './svc-practice.js';
import { PracticeRunner } from './engine-session.js';
import { renderQuestionCard, bindShortcuts } from './ui-question-card.js';
import { toastError } from './ui-toast.js';

await mountShell();
if (!await requireAuth()) throw new Error('redirecting');

const view = { browse: $('#browse-view'), question: $('#question-view') };

const filters = {
  ruleIds: new Set(),
  difficulties: new Set(),   // empty === all
  status: ''                 // '' === everything
};

let cursor = null;
let rows = [];               // everything loaded so far, in display order
let loading = false;

/* ---- skill picker, grouped by domain ----------------------------------- */
const rules = await getRules();

const byDomain = new Map();
for (const rule of rules) {
  const key = rule.domain_name || 'Other';
  if (!byDomain.has(key)) byDomain.set(key, []);
  byDomain.get(key).push(rule);
}

render($('#skill-picker'), [...byDomain.entries()].map(([domain, items]) =>
  h('div.mt-4', {},
    h('div.row-between', {},
      h('h3.text-sm.muted', {}, domain),
      // Per-domain toggle: picking "all the comma rules" is the common case
      // and doing it one chip at a time is tedious.
      h('button.btn.btn-sm.btn-ghost', {
        type: 'button',
        onclick() {
          const ids = items.map((r) => r.id);
          const allOn = ids.every((id) => filters.ruleIds.has(id));
          ids.forEach((id) => allOn ? filters.ruleIds.delete(id) : filters.ruleIds.add(id));
          syncChips();
          reload();
        }
      }, 'Toggle')),
    h('div.row-wrap.mt-2', {}, items.map((rule) =>
      h('button.chip', {
        type: 'button',
        'aria-pressed': 'false',
        dataset: { ruleId: String(rule.id) },
        title: rule.summary || rule.name,
        onclick() {
          const id = rule.id;
          filters.ruleIds.has(id) ? filters.ruleIds.delete(id) : filters.ruleIds.add(id);
          syncChips();
          reload();
        }
      },
        h('span', {}, rule.name),
        rule.question_count
          ? h('span.text-xs', { style: { opacity: '0.7' } }, String(rule.question_count))
          : null))))));

function syncChips() {
  $$('#skill-picker .chip').forEach((chip) => {
    chip.setAttribute('aria-pressed',
      String(filters.ruleIds.has(Number(chip.dataset.ruleId))));
  });
}

$('#select-all').addEventListener('click', () => {
  rules.forEach((r) => filters.ruleIds.add(r.id));
  syncChips();
  reload();
});

$('#clear-all').addEventListener('click', () => {
  filters.ruleIds.clear();
  syncChips();
  reload();
});

/* ---- difficulty --------------------------------------------------------- */
$$('#difficulty-picker .chip').forEach((chip) => chip.addEventListener('click', () => {
  const value = chip.dataset.diff;

  if (value === 'all') {
    filters.difficulties.clear();
  } else {
    filters.difficulties.has(value)
      ? filters.difficulties.delete(value)
      : filters.difficulties.add(value);
  }

  $$('#difficulty-picker .chip').forEach((c) => {
    const v = c.dataset.diff;
    c.setAttribute('aria-pressed', String(
      v === 'all' ? filters.difficulties.size === 0 : filters.difficulties.has(v)));
  });
  reload();
}));

/* ---- status ------------------------------------------------------------- */
$$('#status-picker .chip').forEach((chip) => chip.addEventListener('click', () => {
  filters.status = chip.dataset.status;
  $$('#status-picker .chip').forEach((c) =>
    c.setAttribute('aria-pressed', String(c === chip)));
  reload();
}));

/* ---- loading ------------------------------------------------------------ */
async function reload() {
  cursor = null;
  rows = [];
  await loadPage({ replace: true });
}

async function loadPage({ replace = false } = {}) {
  if (loading) return;
  loading = true;

  if (replace) {
    render($('#results'), h('p.muted', {}, 'Loading…'));
  }

  try {
    const data = await browseQuestions({
      ruleIds: [...filters.ruleIds],
      difficulties: [...filters.difficulties],
      status: filters.status || null,
      limit: 50,
      afterNo: cursor
    });

    rows = replace ? data.questions : rows.concat(data.questions);
    cursor = data.next_cursor;

    drawProgress(data);
    drawResults();

    $('#load-more').hidden = cursor === null;
  } catch (err) {
    render($('#results'), h('div.empty', {},
      h('p.empty__title', {}, 'We could’nt load the bank'),
      h('p', {}, err.message)));
  } finally {
    loading = false;
  }
}

$('#load-more').addEventListener('click', () => loadPage());

/* ---- progress line ------------------------------------------------------ */
function drawProgress(data) {
  const { total, completed, incorrect, unattempted } = data;

  if (!total) {
    $('#progress-line').textContent = '';
    return;
  }

  // "23 of 75 questions completed" for the current filter, plus the breakdown
  // so a student can see at a glance where the work is.
  $('#progress-line').textContent =
    `${num(completed)} of ${num(total)} completed`
    + (incorrect ? ` · ${num(incorrect)} to redo` : '')
    + (unattempted ? ` · ${num(unattempted)} new` : '');
}

/* ---- the list ----------------------------------------------------------- */
const STATUS = {
  correct:     { glyph: '✓', label: 'Completed',     cls: 'text-success' },
  incorrect:   { glyph: '✗', label: 'Incorrect',     cls: 'text-error' },
  unattempted: { glyph: '○', label: 'Not attempted', cls: 'muted' }
};

function drawResults() {
  if (!rows.length) {
    render($('#results'), h('div.empty', {},
      h('p.empty__title', {}, 'Nothing matches those filters'),
      h('p', {}, 'Try picking another skill, adding a difficulty, or switching Show back to Everything.'),
      h('button.btn.btn-primary.mt-4', {
        type: 'button',
        onclick() {
          filters.ruleIds.clear();
          filters.difficulties.clear();
          filters.status = '';
          syncChips();
          $$('#difficulty-picker .chip').forEach((c) =>
            c.setAttribute('aria-pressed', String(c.dataset.diff === 'all')));
          $$('#status-picker .chip').forEach((c) =>
            c.setAttribute('aria-pressed', String(c.dataset.status === '')));
          reload();
        }
      }, 'Clear all filters')));
    return;
  }

  render($('#results'),
    h('div.table-wrap', {},
      h('table.table', {},
        h('caption.visually-hidden', {}, 'Questions matching your filters'),
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, 'Question'),
          h('th', { scope: 'col' }, 'Grammar skill'),
          h('th', { scope: 'col' }, 'Difficulty'),
          h('th', { scope: 'col' }, 'Status'),
          h('th', { scope: 'col' }, ''))),
        h('tbody', {}, rows.map((q) => {
          const s = STATUS[q.status] || STATUS.unattempted;
          return h('tr', {},
            h('th', { scope: 'row' },
              h('span', { style: { fontVariantNumeric: 'tabular-nums' } },
                `#${q.bank_no}`)),
            h('td', {},
              h('div', {}, q.rule_name),
              h('div.text-xs.muted', {}, q.domain_name)),
            h('td', {},
              h('span.badge', { dataset: { difficulty: q.difficulty } },
                titleCase(q.difficulty))),
            h('td', {},
              h(`span.${s.cls}`, {},
                h('span', { 'aria-hidden': 'true' }, `${s.glyph} `),
                h('span', {}, s.label))),
            h('td', {},
              h('button.btn.btn-sm', {
                type: 'button',
                onclick: () => openQuestion(q)
              }, q.status === 'unattempted' ? 'Open' : 'Try again')));
        })))));
}

/* ---- opening a question -------------------------------------------------
 * Everything below this line is the existing engine. The bank's only job is
 * to decide WHICH question, then get out of the way.
 * ------------------------------------------------------------------------ */
let runner = null;
let unbind = null;

async function openQuestion(q) {
  try {
    const session = await startSessionFromQuestions([q.id]);

    runner = new PracticeRunner({ session, mode: 'mixed', instantFeedback: true });
    await runner.load();

    $('#question-crumb').textContent =
      `Question #${q.bank_no} · ${q.rule_name} · ${titleCase(q.difficulty)}`;

    const draw = () => renderQuestionCard($('#question-container'), runner);
    runner.onChange(draw);
    draw();
    unbind = bindShortcuts(runner);

    // When the single question is answered, refresh that row's status so
    // going back shows the new state without a full reload.
    runner.onGraded((result) => {
      const row = rows.find((r) => r.id === q.id);
      if (row) row.status = result?.is_correct ? 'correct' : 'incorrect';
    });

    view.browse.hidden = true;
    view.question.hidden = false;
    $('#main').focus();
    window.scrollTo({ top: 0 });
  } catch (err) {
    toastError(err.message);
  }
}

function backToBank() {
  if (typeof unbind === 'function') unbind();
  unbind = null;
  runner = null;

  view.question.hidden = true;
  view.browse.hidden = false;
  render($('#question-container'));

  // Re-read from the server so the counts and statuses are authoritative
  // rather than patched locally.
  reload();
  window.scrollTo({ top: 0 });
}

$('#back-to-bank').addEventListener('click', backToBank);

/* ---- go ------------------------------------------------------------------ */
await reload();
