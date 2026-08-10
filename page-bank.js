/**
 * Question Bank — pick what to practice, then start a set.
 *
 * This page chooses questions; it does not run them. Start creates a real
 * practice session on the server and hands off to practice.html?session=<id>,
 * which already knows how to launch an active session. So the question card,
 * keyboard shortcuts, flagging, review-before-submit, grading, the results
 * screen and "what to do next" are the existing practice page, unchanged and
 * unduplicated. There is no second answering system to keep in sync.
 *
 * The count on screen comes from browse_questions(); the set comes from
 * start_bank_session(). Both apply the same WHERE clause server-side, so the
 * number you see and the set you get cannot disagree, and the client is never
 * sent question ids or content.
 */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $, $$ } from './core-dom.js';
import { num } from './core-format.js';
import { getRules } from './svc-questions.js';
import { browseQuestions, startBankSession } from './svc-practice.js';
import { toastError } from './ui-toast.js';

await mountShell();
if (!await requireAuth()) throw new Error('redirecting');

const filters = {
  ruleIds: new Set(),
  difficulties: new Set(),   // empty === all
  status: '',                // '' === everything
  length: 10
};

let matching = 0;
let counting = false;

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
          recount();
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
          recount();
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
  recount();
});

$('#clear-all').addEventListener('click', () => {
  filters.ruleIds.clear();
  syncChips();
  recount();
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
  recount();
}));

/* ---- status ------------------------------------------------------------- */
$$('#status-picker .chip').forEach((chip) => chip.addEventListener('click', () => {
  filters.status = chip.dataset.status;
  $$('#status-picker .chip').forEach((c) =>
    c.setAttribute('aria-pressed', String(c === chip)));
  recount();
}));

/* ---- set length --------------------------------------------------------- */
$$('#length-picker .chip').forEach((chip) => chip.addEventListener('click', () => {
  filters.length = Number(chip.dataset.len);
  $$('#length-picker .chip').forEach((c) =>
    c.setAttribute('aria-pressed', String(c === chip)));
  drawStart();
}));

/* ---- how many match ----------------------------------------------------- */
async function recount() {
  if (counting) return;
  counting = true;
  $('#match-count').textContent = '…';

  try {
    // limit 1: this call is only ever used for its counts. Asking for a page
    // of rows we would throw away is wasted bandwidth on a big bank.
    const data = await browseQuestions({
      ruleIds: [...filters.ruleIds],
      difficulties: [...filters.difficulties],
      status: filters.status || null,
      limit: 1
    });

    // `total` counts the skill+difficulty match; the status chip narrows it
    // further. Quote the number that matches what Start will actually draw.
    matching = filters.status
      ? Number(data[{ correct: 'completed', incorrect: 'incorrect',
                      unattempted: 'unattempted' }[filters.status]]) || 0
      : Number(data.total) || 0;

    $('#match-count').textContent = num(matching);
    $('#match-label').textContent = matching === 1 ? 'question matches' : 'questions match';

    const { total, completed, incorrect, unattempted } = data;
    $('#progress-line').textContent = total
      ? `${num(completed)} of ${num(total)} completed`
        + (incorrect ? ` · ${num(incorrect)} to redo` : '')
        + (unattempted ? ` · ${num(unattempted)} new` : '')
      : '';

    drawStart();
  } catch (err) {
    matching = 0;
    $('#match-count').textContent = '—';
    $('#match-label').textContent = 'could not load the bank';
    $('#progress-line').textContent = err.message;
    drawStart();
  } finally {
    counting = false;
  }
}

/* ---- the button --------------------------------------------------------- */
function drawStart() {
  const btn = $('#start');
  const note = $('#start-note');
  const willDraw = Math.min(filters.length, matching);

  btn.disabled = matching === 0;

  if (!matching) {
    btn.textContent = 'Start practicing';
    note.textContent = 'Nothing matches those filters yet. Try adding a skill, '
      + 'widening the difficulty, or switching Show back to Everything.';
    return;
  }

  btn.textContent = `Start ${num(willDraw)} question${willDraw === 1 ? '' : 's'}`;
  note.textContent = willDraw < filters.length
    ? `Only ${num(matching)} match, so that is all this set will hold.`
    : '';
}

$('#start').addEventListener('click', async function () {
  this.dataset.loading = 'true';
  this.disabled = true;

  try {
    const session = await startBankSession({
      ruleIds: [...filters.ruleIds],
      difficulties: [...filters.difficulties],
      status: filters.status || null,
      limit: filters.length
    });
    // Hand off. practice.html already launches an active session from this
    // parameter, so everything downstream is the practice page as it is.
    location.href = `practice.html?session=${session.id}`;
  } catch (err) {
    toastError(err.message);
    delete this.dataset.loading;
    this.disabled = false;
  }
});

/* ---- go ------------------------------------------------------------------ */
await recount();
