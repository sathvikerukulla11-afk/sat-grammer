/** One cheat sheet: the two-minute read before practising a rule. */
import { mountShell } from './ui-shell.js';
import { h, render, $ } from './core-dom.js';
import { pct, titleCase } from './core-format.js';
import { getCheatSheet, setRuleProgress } from './svc-cheatsheets.js';
import { isSignedIn } from './core-auth.js';
import { submitAnswer } from './svc-practice.js';
import { toastSuccess, toastError } from './ui-toast.js';
import { section, exampleCard, bindReadingProgress, FREQUENCY_LABEL } from './ui-cheatsheet.js';
import { UPGRADE_URL } from './svc-premium.js';
import { lockedScreen, premiumSections } from './ui-premium.js';

await mountShell();

const slug = new URLSearchParams(location.search).get('rule');
if (!slug) location.replace('cheatsheets.html');

let data;
try {
  data = await getCheatSheet(slug);
} catch {
  render($('#cs-body'), h('div.empty.mt-8', {},
    h('p.empty__title', {}, 'We could not find that rule'),
    h('a.btn.btn-primary.mt-4', { href: 'cheatsheets.html' }, 'Back to all cheat sheets')));
  throw new Error('not found');
}

// A locked premium sheet arrives as a cover only. There is no body
// content in the payload to hide — the server never sent any.
if (data.locked) {
  const cover = data.cover || {};
  document.title = `${cover.title || 'Premium'} — SAT Grammar Lab`;
  document.documentElement.dataset.accent = 'gold';
  render($('#cs-body'), lockedScreen(cover, data.upgrade_url || UPGRADE_URL));
  bindReadingProgress($('#cs-read-progress'));
  throw new Error('locked');
}

const { rule, sheet, practice, progress, mastery, related, prev, next } = data;
document.title = `${(sheet && sheet.title) || rule.name} — SAT Grammar Lab`;

/* Some rules have no FREE sheet, only a premium deep-dive. Guard on a real
   field rather than on `sheet` alone: the server used to send an object of
   nulls here, which is truthy, and this page rendered a hollow sheet — "null
   min" read time, empty sections — instead of taking this branch. The RPC
   now sends null, and `!sheet.the_rule` keeps the page correct either way. */
if (!sheet || !sheet.the_rule) {
  const alt = data.premium_alternative;

  render($('#cs-body'),
    h('div.cs-hero.mt-6', { dataset: { accent: alt ? 'gold' : 'blue' } },
      h('div.cs-hero__icon', { 'aria-hidden': 'true' }, alt?.icon || '📄'),
      h('h1.cs-hero__title', {}, rule.name),
      h('p.cs-hero__sub', {}, rule.summary)),

    alt
      // Honest about what exists: there IS a sheet for this rule, it is the
      // premium one. Cover-level detail only — the lesson stays gated.
      ? h('div.cs-locked.mt-6', {},
          h('div.cs-locked__icon', { 'aria-hidden': 'true' }, '🔒'),
          h('h2.cs-locked__title', {}, 'This rule has a premium cheat sheet'),
          h('p.cs-locked__body', {},
            alt.teaser || alt.subtitle ||
            'A full deep-dive on this rule is part of Premium.'),
          h('div.row-wrap.mt-6', { style: { justifyContent: 'center' } },
            h('a.btn.btn-premium.btn-lg', { href: UPGRADE_URL }, 'See what Premium adds'),
            h('a.btn.btn-lg', {
              href: `practice.html?rule=${rule.slug}&difficulty=any&start=1`
            }, 'Practice this rule for free')))
      : h('div.alert.alert-info.mt-6', {}, h('div', {},
          h('strong', {}, 'The cheat sheet for this rule has not been written yet. '),
          'The practice questions for it are ready, and the rule summary above is accurate.')),

    h('div.row-wrap.mt-6', { style: { justifyContent: 'center' } },
      alt ? null : h('a.btn.btn-primary', {
        href: `practice.html?rule=${rule.slug}&difficulty=any&start=1`
      }, 'Practice this rule'),
      h('a.btn', { href: 'cheatsheets.html' }, 'All cheat sheets')));
  throw new Error('no free sheet');
}

document.documentElement.dataset.accent = sheet.accent;

/* ---- header ------------------------------------------------------------- */
const favBtn = h('button.btn.btn-icon', {
  type: 'button',
  'aria-pressed': String(Boolean(progress?.favorited_at)),
  'aria-label': 'Save this cheat sheet',
  'data-tooltip': 'Save for later',
  style: { fontSize: 'var(--text-lg)' },
  async onclick() {
    if (!isSignedIn()) return toastError('Sign in to save cheat sheets.');
    const on = this.getAttribute('aria-pressed') !== 'true';
    this.setAttribute('aria-pressed', String(on));
    this.textContent = on ? '★' : '☆';
    try { await setRuleProgress(rule.id, { favorited: on }); }
    catch { this.setAttribute('aria-pressed', String(!on)); this.textContent = on ? '☆' : '★'; }
  }
}, progress?.favorited_at ? '★' : '☆');

const hero = h('div.cs-hero.mt-6', {},
  h('div.row-between', {},
    h('div.cs-hero__icon', { 'aria-hidden': 'true' }, sheet.icon),
    favBtn),
  h('h1.cs-hero__title', {}, rule.name),
  h('p.cs-hero__sub', {}, rule.summary),
  h('div.cs-stats', {},
    stat('⏱', `${sheet.reading_minutes} min`, 'read'),
    stat('📊', titleCase(rule.typical_difficulty), 'difficulty'),
    stat('🎯', titleCase(sheet.frequency_band),
         FREQUENCY_LABEL[sheet.frequency_band] || 'on the test'),
    isSignedIn() && mastery
      ? stat('📈', pct(mastery.mastery || 0), `mastery · ${mastery.attempted} answered`)
      : null));

function stat(icon, value, label) {
  return h('div.cs-stat', {},
    h('span', { 'aria-hidden': 'true' }, icon),
    h('strong', {}, value),
    h('span.cs-stat__label', {}, label));
}

/* ---- mini practice ------------------------------------------------------ */
function practiceCard() {
  if (!practice) return null;

  let picked = null;
  const slot = h('div.cs-practice__body');

  const draw = (grade) => render(slot,
    h('p', { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-md)',
                      lineHeight: 'var(--leading-loose)' } }, practice.passage),
    h('p.text-sm.muted.mt-3', {}, practice.stem),
    h('div.choices.mt-4', { role: 'radiogroup', 'aria-label': 'Answer choices' },
      practice.choices.map((c) => {
        let state = null, glyph = null;
        if (grade) {
          if (c.label === grade.correct_label) { state = 'correct'; glyph = '✓'; }
          else if (c.id === picked) { state = 'incorrect'; glyph = '✕'; }
          else state = 'dimmed';
        }
        return h('button.choice', {
          type: 'button', role: 'radio',
          'aria-checked': String(picked === c.id),
          disabled: Boolean(grade),
          dataset: state ? { state } : {},
          onclick() { picked = c.id; draw(null); }
        },
          h('span.choice__key', { 'aria-hidden': 'true' }, c.label),
          h('span.choice__body', {}, c.body || h('em.subtle', {}, '(no added punctuation)')),
          glyph ? h('span.choice__mark', { 'aria-hidden': 'true' }, glyph) : null);
      })),

    grade
      ? h('div.explanation.mt-5', { dataset: { result: grade.is_correct ? 'correct' : 'incorrect' } },
          h('div.explanation__head', {},
            h('span', { 'aria-hidden': 'true' }, grade.is_correct ? '✓' : '✕'),
            h('span', {}, grade.is_correct ? 'Correct' : `The answer was ${grade.correct_label}`)),
          h('div.explanation__body', {},
            h('p', {}, grade.explanation),
            h('div.rationales', {}, Object.entries(grade.rationales || {})
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([label, why]) =>
                h('div.rationale', { dataset: { correct: String(label === grade.correct_label) } },
                  h('span.rationale__key', {}, label),
                  h('span', {}, why))))))
      : h('button.btn.btn-primary.mt-5', {
          type: 'button', disabled: !picked,
          async onclick() {
            if (!isSignedIn()) return toastError('Sign in to check your answer and record it.');
            this.dataset.loading = 'true';
            try {
              draw(await submitAnswer({
                questionId: practice.id, choiceId: picked, timeMs: 0, mode: 'mixed'
              }));
            } catch (err) { toastError(err.message); delete this.dataset.loading; }
          }
        }, 'Check answer'));

  draw(null);

  return h('div.cs-practice.mt-6', {},
    h('div.cs-practice__head', {},
      h('span', { 'aria-hidden': 'true' }, '🎮'),
      h('span', {}, 'Try one'),
      h('span.badge', { style: { marginLeft: 'auto' } }, titleCase(practice.difficulty))),
    slot);
}

/* ---- footer ------------------------------------------------------------- */
const understand = h('button.cs-understand.mt-8', {
  type: 'button',
  'aria-pressed': String(Boolean(progress?.completed_at)),
  async onclick() {
    if (!isSignedIn()) return toastError('Sign in to track which rules you have covered.');
    const on = this.getAttribute('aria-pressed') !== 'true';
    this.setAttribute('aria-pressed', String(on));
    this.replaceChildren(document.createTextNode(on ? '✓ You understand this rule' : "I understand this rule"));
    try {
      await setRuleProgress(rule.id, { completed: on });
      if (on) toastSuccess('Marked as understood. Practice it to turn that into mastery.');
    } catch { this.setAttribute('aria-pressed', String(!on)); }
  }
}, progress?.completed_at ? '✓ You understand this rule' : 'I understand this rule');

/* ---- assemble ----------------------------------------------------------- */
render($('#cs-body'),
  hero,

  h('div.stack-lg.mt-8', {},
    section('🧠', 'The rule', h('p', {}, sheet.the_rule)),

    h('div.cs-trick', {},
      h('div.row', {},
        h('span', { 'aria-hidden': 'true', style: { fontSize: '24px' } }, '💡'),
        h('span.cs-trick__line', {}, sheet.memory_trick)),
      sheet.trick_detail ? h('p.cs-trick__detail', {}, sheet.trick_detail) : null),

    /* Knowing the rule and recognising the question that tests it are two
       different skills. This section is the second one: what the item looks
       like on the page. The server omits it from a locked payload along with
       every other lesson field, so the guard is `sheet.how_to_spot` being
       absent rather than any check here. */
    sheet.how_to_spot
      ? section('🔍', 'How to spot it on the SAT', h('p', {}, sheet.how_to_spot))
      : null,

    section('✅', 'Correct examples',
      h('p.text-sm.muted', { style: { marginBottom: 'var(--space-4)' } },
        'Tap any line to see why it works.'),
      (sheet.examples || []).map((e) => exampleCard(e, 'good'))),

    section('❌', 'Common SAT mistakes',
      h('p.text-sm.muted', { style: { marginBottom: 'var(--space-4)' } },
        'Tap any line to see exactly what went wrong.'),
      (sheet.mistakes || []).map((m) => exampleCard(m, 'bad'))),

    section('🚨', 'SAT traps',
      (sheet.traps || []).map((t, i) =>
        h('div.cs-trap', {},
          h('span.cs-trap__n', { 'aria-hidden': 'true' }, String(i + 1)),
          h('span', {}, t)))),

    h('div.cs-tip', {},
      h('div.cs-tip__label', {}, '⭐ Pro tip'),
      h('p.cs-tip__body', {}, sheet.pro_tip)),

    practiceCard(),

    section('⚡', '30-second recap',
      h('ol.cs-recap', {}, (sheet.recap || []).map((r) => h('li', {}, r)))),

    // Premium-only sections. Present only when the server actually sent
    // them, which it does only for an entitled reader.
    ...premiumSections(sheet)),

  understand,

  h('div.row-wrap.mt-6', { style: { justifyContent: 'center' } },
    h('a.btn.btn-primary.btn-lg', {
      href: `practice.html?rule=${rule.slug}&difficulty=any&start=1`
    }, `Practice this rule (${data.question_count} questions)`),
    h('a.btn.btn-lg', { href: 'cheatsheets.html' }, 'All cheat sheets')),

  (related || []).length
    ? h('section.mt-10', {},
        h('h2.h4.mb-4', {}, 'Related rules'),
        h('div.row-wrap', {}, related.map((r) =>
          h('a.chip', { href: `cheatsheet.html?rule=${r.slug}` },
            h('span', { 'aria-hidden': 'true' }, r.icon || '📄'),
            h('span', {}, r.name)))))
    : null,

  h('nav.cs-nav.mt-10', { 'aria-label': 'Cheat sheet navigation' },
    prev
      ? h('a.cs-nav__link', { href: `cheatsheet.html?rule=${prev.slug}`, rel: 'prev' },
          h('span.cs-nav__dir', {}, '← Previous'),
          h('span.cs-nav__name', {}, prev.name))
      : h('span'),
    next
      ? h('a.cs-nav__link.cs-nav__link--next', { href: `cheatsheet.html?rule=${next.slug}`, rel: 'next' },
          h('span.cs-nav__dir', {}, 'Next →'),
          h('span.cs-nav__name', {}, next.name))
      : h('span')));

bindReadingProgress($('#cs-read-progress'));
