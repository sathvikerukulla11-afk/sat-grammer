/** Home page: site stats + one playable sample question, no account needed. */
import { mountShell } from './ui-shell.js';
import { h, render, $, $$ } from './core-dom.js';
import { num } from './core-format.js';
import { getSiteStats, getSampleQuestions } from './svc-questions.js';

await mountShell();

/* ---- headline counters ------------------------------------------------ */
try {
  const stats = await getSiteStats();
  const tiles = [
    [stats.question_count, 'Original questions'],
    [stats.rule_count, 'Grammar rules'],
    [stats.student_count, 'Students practising'],
    [stats.attempt_count, 'Questions answered']
  ];
  render($('#site-stats'), tiles.map(([value, label]) =>
    h('div.stat', {},
      h('span.stat__value', {}, num(value)),
      h('span.stat__label', {}, label))
  ));
} catch {
  $('#site-stats')?.remove();
}

/* ---- the demo question ------------------------------------------------- */
/*
 * Deliberately client-side and ungraded-by-the-server: a logged-out
 * visitor has no session, so record_attempt would reject them. We reveal
 * the answer locally for this one teaser and prompt them to sign up for
 * the real thing, where grading and explanations come from the server.
 */
const [sample] = await getSampleQuestions(1).catch(() => []);
const slot = $('#demo-question');

if (!sample) {
  render(slot, h('div.empty', {},
    h('p.empty__title', {}, 'Sample questions are on the way'),
    h('p', {}, 'The question bank is being populated.')));
} else {
  let picked = null;

  const draw = (revealed = false) => render(slot,
    h('article.question', {},
      h('div.question__bar', {},
        h('span.badge', { dataset: { difficulty: sample.difficulty } }, sample.difficulty),
        h('span.question__rule', {}, sample.rule.name)),
      h('div.question__body', {},
        h('div.passage', {}, sample.passage),
        h('p.question__stem', {}, sample.stem),
        h('div.choices', { role: 'radiogroup', 'aria-label': 'Answer choices' },
          sample.choices.map((choice) =>
            h('button.choice', {
              type: 'button', role: 'radio',
              'aria-checked': String(picked === choice.id),
              disabled: revealed,
              onclick: () => { picked = choice.id; draw(false); }
            },
              h('span.choice__key', { 'aria-hidden': 'true' }, choice.label),
              h('span.choice__body', {}, choice.body)))),
        revealed
          ? h('div.explanation', { dataset: { result: 'correct' } },
              h('div.explanation__head', {}, 'Want the answer and the reasoning?'),
              h('div.explanation__body', {},
                h('p', {}, 'Full explanations — including why each wrong choice is wrong — are ' +
                           'graded on the server and shown to signed-in students.'),
                h('a.btn.btn-primary.mt-4', { href: 'register.html' }, 'Create a free account')))
          : null),
      h('div.question__footer', {},
        h('button.btn.btn-primary', {
          type: 'button', disabled: !picked, onclick: () => draw(true)
        }, 'Check answer'),
        h('div.spacer'),
        h('a.btn.btn-ghost', { href: 'rules.html' }, 'See all rules'))
    ));

  draw(false);
}

/* ---- entrance animation, motion-safe ---------------------------------- */
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.15 });
  $$('.section .card').forEach((card) => observer.observe(card));
}
