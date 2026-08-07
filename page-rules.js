/** Grammar rules index: searchable, grouped by domain. */
import { mountShell } from './ui-shell.js';
import { h, render, $, $$ } from './core-dom.js';
import { num, pct, titleCase } from './core-format.js';
import { getRules, getDomains } from './svc-questions.js';
import { isSignedIn } from './core-auth.js';

await mountShell();

const [rules, domains] = await Promise.all([getRules(), getDomains()]);

let activeDomain = null;
let query = '';

/* ---- domain filter chips ------------------------------------------------ */
render($('#domain-filter'), [
  h('button.chip', {
    type: 'button', 'aria-pressed': 'true', dataset: { domain: '' },
    onclick: (e) => pickDomain(null, e.currentTarget)
  }, `All (${rules.length})`),
  ...domains.map((domain) => {
    const count = rules.filter((r) => r.domain_id === domain.id).length;
    return h('button.chip', {
      type: 'button', 'aria-pressed': 'false', dataset: { domain: String(domain.id) },
      title: domain.description,
      onclick: (e) => pickDomain(domain.id, e.currentTarget)
    }, `${domain.name} (${count})`);
  })
]);

function pickDomain(id, button) {
  activeDomain = id;
  $$('#domain-filter .chip').forEach((chip) => chip.setAttribute('aria-pressed', 'false'));
  button.setAttribute('aria-pressed', 'true');
  draw();
}

$('#rule-search').addEventListener('input', (event) => {
  query = event.target.value.trim().toLowerCase();
  draw();
});

/* ---- the grid ----------------------------------------------------------- */
function draw() {
  const filtered = rules.filter((rule) => {
    if (activeDomain && rule.domain_id !== activeDomain) return false;
    if (!query) return true;
    return `${rule.name} ${rule.summary}`.toLowerCase().includes(query);
  });

  if (!filtered.length) {
    render($('#rules-grid'), h('div.empty', {},
      h('p.empty__title', {}, 'No rules match that search'),
      h('p', {}, 'Try a different word, or clear the filter.')));
    return;
  }

  const grouped = domains
    .map((domain) => ({ domain, items: filtered.filter((r) => r.domain_id === domain.id) }))
    .filter((group) => group.items.length);

  render($('#rules-grid'), grouped.map(({ domain, items }) =>
    h('section', {},
      h('div.row-between', {},
        h('h2.h3', {}, domain.name),
        h('span.badge', {}, `${items.length} rule${items.length === 1 ? '' : 's'}`)),
      h('p.muted.mt-2', { style: { maxWidth: '70ch' } }, domain.description),
      h('div.grid.grid-auto.mt-6', {}, items.map(ruleCard)))));
}

function ruleCard(rule) {
  return h('a.card.rule-card', { href: `rule.html?slug=${rule.slug}` },
    h('div.rule-card__top', {},
      h('span.rule-card__name', {}, rule.name),
      h('span.badge', {
        dataset: { difficulty: rule.typical_difficulty },
        title: 'How hard the concept is to learn'
      }, titleCase(rule.typical_difficulty || 'medium'))),
    h('p.rule-card__summary', {}, rule.summary),
    h('div.row-wrap.mt-2', {},
      ['easy', 'medium', 'hard', 'expert'].map((level) => {
        const count = rule[`${level}_count`];
        return count
          ? h('span.badge', { dataset: { difficulty: level } }, `${level} ${count}`)
          : null;
      })),
    h('div.row-between.mt-3', {},
      h('span.text-xs.muted', {}, `${num(rule.question_count)} question${rule.question_count === 1 ? '' : 's'}`),
      rule.avg_quality
        ? h('span.text-xs.subtle', { title: 'Mean editorial quality' }, `${rule.avg_quality} \u2605`)
        : null));
}

draw();

if (!isSignedIn()) {
  $('#rules-grid').insertAdjacentElement('beforebegin',
    h('div.alert.alert-info.mb-6', {},
      h('div', {},
        h('strong', {}, 'Reading is free. '),
        'Create an account to practise the questions and track mastery per rule. ',
        h('a', { href: 'register.html' }, 'Sign up →'))));
}
