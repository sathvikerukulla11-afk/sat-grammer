/**
 * Learn more: the detail that used to bloat the landing page.
 *
 * Almost all of it is static markup. The only dynamic part is the topic
 * list, which is built from the live rule catalogue so it cannot drift out
 * of date the way a hand-written list would.
 */
import { mountShell } from './ui-shell.js';
import { h, render, $, $$ } from './core-dom.js';
import { isSignedIn } from './core-auth.js';
import { num } from './core-format.js';
import { getRules, getSiteStats } from './svc-questions.js';

await mountShell();

/* Same retargeting as the home page: send signed-in visitors straight to
   practice, and everyone else to registration with practice queued up. */
if (isSignedIn()) {
  $$('#cta-practice, #cta-practice-2').forEach((a) => { a.href = 'practice.html'; });
}

/* ---- what's in here -----------------------------------------------------
 * Exact numbers, not rounded marketing ones. "151 questions" is a claim
 * somebody counted; "150+ and growing" is a claim nobody can check, and
 * students can tell the difference.
 *
 * question_count includes premium items a logged-out visitor cannot reach,
 * so the headline quotes free_question_count and names it as free.
 * ------------------------------------------------------------------------ */
try {
  const s = await getSiteStats();

  const questions = Number(s?.free_question_count) || 0;
  const total     = Number(s?.question_count) || 0;
  const rules     = Number(s?.rule_count) || 0;
  const domains   = Number(s?.domain_count) || 0;
  const sheets    = Number(s?.free_cheat_sheet_count) || 0;

  const tiles = [
    questions && [num(questions), 'free practice questions'],
    rules     && [num(rules), 'grammar rules covered'],
    sheets    && [num(sheets), 'free cheat sheets'],
    domains   && [num(domains), 'skill categories']
  ].filter(Boolean);

  if (tiles.length) {
    const grid = $('#stat-grid');
    render(grid, tiles.map(([value, label]) =>
      h('div.card.text-center', {},
        h('div.stat__value', {}, value),
        h('div.stat__label.mt-2', {}, label))));
    grid.hidden = false;
  }

  const facts = [
    questions && `${num(questions)} questions you can practice without paying, every one written by hand for this site`,
    total > questions
      && `${num(total - questions)} harder questions on top of that for Premium members`,
    rules && `All ${num(rules)} grammar rules the Writing section actually tests, each with its own cheat sheet`,
    'An explanation for all four choices, not just the right one'
  ].filter(Boolean);

  if (facts.length > 1) {
    const list = $('#bank-facts');
    render(list, facts.map((text) => h('li', {}, text)));
    list.hidden = false;
  }
} catch {
  // Say nothing rather than guess. A wrong count on the page that exists to
  // be checked is worse than no count, so point at the pages that list the
  // real thing instead.
  $('#stat-fallback').hidden = false;
}

/* ---- grammar topics, grouped by domain --------------------------------- */
try {
  const rules = await getRules();

  const byDomain = new Map();
  for (const rule of rules) {
    const key = rule.domain_name || rule.domain || 'Other';
    if (!byDomain.has(key)) byDomain.set(key, []);
    byDomain.get(key).push(rule);
  }

  $('#topic-count').textContent = `All ${rules.length} rules`;

  render($('#domain-grid'), [...byDomain.entries()].map(([domain, items]) =>
    h('div.card', {},
      h('div.row-between', {},
        h('h3.card__title', {}, domain),
        h('span.badge', {}, String(items.length))),
      h('ul.stack-sm.mt-3', { role: 'list' }, items.map((rule) =>
        h('li', {},
          h('a', { href: `rule.html?rule=${rule.slug}` }, rule.name)))))));
} catch {
  // The rules page is the canonical list; if this fetch fails, point at it
  // rather than leaving a loading skeleton on screen forever.
  render($('#domain-grid'),
    h('div.empty', {},
      h('p.empty__title', {}, 'Topic list unavailable right now'),
      h('a.btn.btn-primary.mt-4', { href: 'rules.html' }, 'Browse the rules page')));
}
