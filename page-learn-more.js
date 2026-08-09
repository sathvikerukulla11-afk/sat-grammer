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
import { getRules } from './svc-questions.js';

await mountShell();

/* Same retargeting as the home page: send signed-in visitors straight to
   practice, and everyone else to registration with practice queued up. */
if (isSignedIn()) {
  $$('#cta-practice, #cta-practice-2').forEach((a) => { a.href = 'practice.html'; });
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
