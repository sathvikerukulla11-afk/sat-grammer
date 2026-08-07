/** Cheat sheet index: every rule as a card, with the student's own state. */
import { mountShell } from './ui-shell.js';
import { h, render, $, $$ } from './core-dom.js';
import { pct, titleCase } from './core-format.js';
import { listCheatSheets } from './svc-cheatsheets.js';
import { isSignedIn } from './core-auth.js';
import { FREQUENCY_LABEL } from './ui-cheatsheet.js';

await mountShell();

let sheets = [];
let filter = 'all';
let query = '';

try {
  sheets = await listCheatSheets();
} catch {
  render($('#cs-index'), h('div.empty', {},
    h('p.empty__title', {}, 'Cheat sheets are unavailable right now'),
    h('p', {}, 'Try again in a moment.')));
}

/* ---- overall progress -------------------------------------------------- */
function drawOverall() {
  const withSheet = sheets.filter((s) => s.has_sheet);
  const done = withSheet.filter((s) => s.completed).length;
  if (!withSheet.length || !isSignedIn()) return render($('#cs-overall'));

  render($('#cs-overall'),
    h('div', { style: { textAlign: 'right' } },
      h('div.text-sm.muted', {}, `${done} of ${withSheet.length} understood`),
      h('div.progress.progress--thin.mt-2', {
        style: { width: '160px' },
        role: 'progressbar',
        'aria-valuenow': String(done), 'aria-valuemin': '0',
        'aria-valuemax': String(withSheet.length),
        'aria-label': 'Cheat sheets understood'
      },
        h('div.progress__fill', {
          style: { width: `${(done / withSheet.length) * 100}%` },
          dataset: { tone: done === withSheet.length ? 'success' : null }
        }))));
}

/* ---- filters ------------------------------------------------------------ */
$$('[data-filter]').forEach((chip) => chip.addEventListener('click', () => {
  filter = chip.dataset.filter;
  $$('[data-filter]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
  draw();
}));

$('#cs-search').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase();
  draw();
});

/* ---- the grid ----------------------------------------------------------- */
function visible() {
  return sheets.filter((s) => {
    if (query && !`${s.name} ${s.summary} ${s.memory_trick || ''}`.toLowerCase().includes(query)) return false;
    if (filter === 'done') return s.completed;
    if (filter === 'fav') return s.favorited;
    if (filter === 'todo') return s.has_sheet && !s.completed;
    return true;
  });
}

function card(s) {
  // Rules without a written sheet still appear, but say so plainly rather
  // than pretending to be finished.
  if (!s.has_sheet) {
    return h('div.cs-card', {
      dataset: { accent: 'blue' },
      style: { opacity: '0.55', cursor: 'default' }
    },
      h('div.cs-card__icon', { 'aria-hidden': 'true' }, '📄'),
      h('div.cs-card__name', {}, s.name),
      h('div.cs-card__summary', {}, s.summary),
      h('div.cs-card__meta', {},
        h('span.badge', {}, 'Cheat sheet not written yet'),
        s.question_count
          ? h('a.badge.badge-brand', { href: `practice.html?rule=${s.slug}&difficulty=any&start=1` },
              `${s.question_count} questions →`)
          : null));
  }

  return h('a.cs-card', {
    href: `cheatsheet.html?rule=${s.slug}`,
    dataset: { accent: s.accent, state: s.completed ? 'done' : 'todo' }
  },
    s.completed ? h('span.cs-card__done', { title: 'You marked this understood' }, '✓') : null,
    h('div.cs-card__icon', { 'aria-hidden': 'true' }, s.icon),
    h('div.cs-card__name', {}, s.name),
    s.memory_trick ? h('div.cs-card__trick', {}, `💡 ${s.memory_trick}`) : null,
    h('div.cs-card__summary', {}, s.summary),
    h('div.cs-card__meta', {},
      h('span', {}, `⏱ ${s.reading_minutes || 2} min`),
      h('span', {}, '·'),
      h('span', { title: FREQUENCY_LABEL[s.frequency_band] || '' }, titleCase(s.frequency_band || '')),
      s.favorited ? h('span', { title: 'Saved' }, '· ★') : null,
      s.mastery > 0 ? h('span', {}, `· ${pct(s.mastery)} mastery`) : null));
}

function draw() {
  const rows = visible();
  if (!rows.length) {
    render($('#cs-index'), h('div.empty', {},
      h('p.empty__title', {}, 'Nothing matches'),
      h('p', {}, 'Try a different search or clear the filter.')));
    return;
  }

  // Group by domain so the index reads as a syllabus, not a pile.
  const byDomain = new Map();
  for (const s of rows) {
    if (!byDomain.has(s.domain)) byDomain.set(s.domain, []);
    byDomain.get(s.domain).push(s);
  }

  render($('#cs-index'), [...byDomain.entries()].map(([domain, items]) =>
    h('section.mb-8', {},
      h('div.row-between.mb-4', {},
        h('h2.h3', {}, domain),
        h('span.badge', {}, `${items.filter((i) => i.has_sheet).length} of ${items.length} written`)),
      h('div.cs-grid', {}, items.map(card)))));
}

drawOverall();
draw();
