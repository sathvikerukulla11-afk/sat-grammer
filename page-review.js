/** Review page: missed questions, bookmarks, recent attempt history. */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $, $$ } from './core-dom.js';
import { relativeTime, duration, titleCase } from './core-format.js';
import { getReviewQueue, getBookmarks, getQuestionWithKey, toggleBookmark, getRules } from './svc-questions.js';
import { getRecentAttempts } from './svc-progress.js';
import { openModal } from './ui-modal.js';
import { toastSuccess, toastError } from './ui-toast.js';

await mountShell();
if (!await requireAuth()) throw new Error('redirecting');

/* ---- tabs --------------------------------------------------------------- */
const tabs = $$('.tab');
tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((t) => {
    const selected = t === tab;
    t.setAttribute('aria-selected', String(selected));
    $(`#${t.getAttribute('aria-controls')}`).hidden = !selected;
  });
}));

/* ---- rule filter -------------------------------------------------------- */
const rules = await getRules();
const filter = $('#rule-filter');
rules.forEach((rule) => filter.append(h('option', { value: String(rule.id) }, rule.name)));
filter.addEventListener('change', drawMissed);

/* ---- missed ------------------------------------------------------------- */
async function drawMissed() {
  render($('#missed-list'), h('div.card', {}, h('div.skeleton.skeleton-text')));
  const rows = await getReviewQueue({ limit: 100 });
  const ruleId = filter.value;
  const filtered = ruleId
    ? rows.filter((row) => String(rules.find((r) => r.slug === row.rule_slug)?.id) === ruleId)
    : rows;

  if (!filtered.length) {
    render($('#missed-list'), h('div.empty', {},
      h('p.empty__title', {}, 'Nothing to review'),
      h('p', {}, 'Every question you have missed, you have since answered correctly.'),
      h('a.btn.btn-primary.mt-4', { href: 'practice.html' }, 'Practice something new')));
    $('#practice-missed-btn').disabled = true;
    return;
  }

  render($('#missed-list'), h('div.stack', {}, filtered.map(missedCard)));
}

function missedCard(row) {
  return h('article.card', {},
    h('div.row-wrap', {},
      h('span.badge', { dataset: { difficulty: row.difficulty } }, titleCase(row.difficulty)),
      h('span.text-sm.muted', {}, row.rule_name),
      h('div.spacer'),
      h('span.text-xs.subtle', {}, `Missed ${row.wrong_count}× · last ${relativeTime(row.last_wrong)}`)),
    h('p.mt-3', { style: { fontFamily: 'var(--font-serif)' } }, row.passage),
    h('div.row-wrap.mt-4', {},
      h('button.btn.btn-sm.btn-primary', {
        type: 'button', onclick: () => showExplanation(row.question_id)
      }, 'Show the answer'),
      h('button.btn.btn-sm', {
        type: 'button',
        'aria-pressed': String(Boolean(row.bookmarked)),
        onclick: async (event) => {
          const saved = await toggleBookmark(row.question_id);
          event.currentTarget.textContent = saved ? '★ Saved' : '☆ Save';
          event.currentTarget.setAttribute('aria-pressed', String(saved));
        }
      }, row.bookmarked ? '★ Saved' : '☆ Save')));
}

async function showExplanation(questionId) {
  try {
    const question = await getQuestionWithKey(questionId);
    const correct = question.choices.find((c) => c.is_correct);

    openModal({
      title: 'Answer and explanation',
      size: '680px',
      body: h('div.stack', {},
        h('p', { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-md)' } }, question.passage),
        h('div.alert.alert-success', {}, h('div', {},
          h('strong', {}, `Answer: ${correct.label} — `), correct.body)),
        h('p', {}, question.explanation),
        h('h3.h5.mt-4', {}, 'Why the others fail'),
        h('div.rationales', {}, question.choices
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((choice) =>
            h('div.rationale', { dataset: { correct: String(choice.is_correct) } },
              h('span.rationale__key', {}, choice.label),
              h('span', {}, choice.rationale))))),
      actions: [{ label: 'Close', value: true }]
    });
  } catch (err) {
    toastError(err.message);
  }
}

/* ---- bookmarks ---------------------------------------------------------- */
async function drawSaved() {
  const rows = await getBookmarks();
  if (!rows.length) {
    render($('#saved-list'), h('div.empty', {},
      h('p.empty__title', {}, 'No bookmarks yet'),
      h('p', {}, 'Press B during practice, or use the Save button on any question.')));
    return;
  }

  render($('#saved-list'), h('div.stack', {}, rows.map((row) =>
    h('article.card', {},
      h('div.row-wrap', {},
        h('span.badge', { dataset: { difficulty: row.question.difficulty } },
          titleCase(row.question.difficulty)),
        h('span.text-sm.muted', {}, row.question.rule.name),
        h('div.spacer'),
        h('span.text-xs.subtle', {}, `Saved ${relativeTime(row.created_at)}`)),
      h('p.mt-3', { style: { fontFamily: 'var(--font-serif)' } }, row.question.passage),
      row.note ? h('p.text-sm.muted.mt-2', {}, `Note: ${row.note}`) : null,
      h('div.row-wrap.mt-4', {},
        h('button.btn.btn-sm.btn-primary', {
          type: 'button', onclick: () => showExplanation(row.question.id)
        }, 'Show the answer'),
        h('button.btn.btn-sm.btn-ghost', {
          type: 'button',
          async onclick(event) {
            await toggleBookmark(row.question.id);
            event.currentTarget.closest('article').remove();
            toastSuccess('Bookmark removed.');
          }
        }, 'Remove'))))));
}

/* ---- history ------------------------------------------------------------ */
async function drawHistory() {
  const rows = await getRecentAttempts(50);
  if (!rows.length) {
    render($('#history-list'), h('div.empty', {}, h('p.empty__title', {}, 'No attempts yet')));
    return;
  }

  render($('#history-list'),
    h('div.table-wrap', {},
      h('table.table', {},
        h('caption.visually-hidden', {}, 'Your fifty most recent attempts'),
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, 'Question'),
          h('th', { scope: 'col' }, 'Rule'),
          h('th', { scope: 'col' }, 'Result'),
          h('th', { scope: 'col', class: 'num' }, 'Time'),
          h('th', { scope: 'col' }, 'When'))),
        h('tbody', {}, rows.map((row) =>
          h('tr', {},
            h('td.wrap', {}, truncate(row.question?.passage || '—', 90)),
            h('td', {}, row.rule?.name || '—'),
            h('td', {}, h('span.badge', { class: row.is_correct ? 'badge-success' : 'badge-danger' },
              row.is_correct ? 'Correct' : 'Missed')),
            h('td.num', {}, duration(row.time_ms, 'short')),
            h('td', {}, relativeTime(row.created_at))))))));
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

$('#practice-missed-btn').addEventListener('click', () => {
  location.assign('practice.html?mode=review&difficulty=any&start=1');
});

await drawMissed();
await drawSaved();
await drawHistory();
