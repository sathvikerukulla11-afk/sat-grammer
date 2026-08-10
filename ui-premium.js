/**
 * Premium rendering: the locked screen and the premium-only sections.
 *
 * The locked screen blurs a PLACEHOLDER, not the real sheet. The server
 * withholds every content field from a locked reader, so there is nothing
 * behind the blur to recover — opening devtools shows the same teaser.
 * The blur is honest decoration, not a lock.
 */
import { h, render } from './core-dom.js';
import { section } from './ui-cheatsheet.js';

const SECTION_LABEL = {
  strategies: 'Strategies for the exam room',
  traps: 'The traps, named',
  diagram: 'A decision diagram',
  mnemonics: 'Mnemonics',
  exam_day: 'Exam-day checklist',
  quiz: 'Mini quiz',
  difficulty: 'How it looks at each difficulty',
  checkpoint: 'Mastery checkpoint'
};

/** Lorem-ish filler purely so the blur has a shape. Contains nothing. */
function placeholderLines(n = 7) {
  const widths = ['100%', '92%', '78%', '96%', '64%', '88%', '72%'];
  return h('div.stack-sm', {}, Array.from({ length: n }, (_, i) =>
    h('div', {
      'aria-hidden': 'true',
      style: {
        height: i % 3 === 0 ? '1.4em' : '1em',
        width: widths[i % widths.length],
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-sunken)'
      }
    })));
}

export function lockedScreen(cover, upgradeUrl) {
  const includes = (cover.includes || []).map((k) => SECTION_LABEL[k] || k);

  return [
    h('div.cs-hero.mt-6', {},
      h('div.row-between', {},
        h('div.cs-hero__icon', { 'aria-hidden': 'true' }, cover.icon || '✨'),
        h('span.cs-badge-premium', {}, '✨ PREMIUM')),
      h('h1.cs-hero__title', {}, cover.title || 'Premium cheat sheet'),
      cover.subtitle ? h('p.cs-hero__sub', {}, cover.subtitle) : null,
      cover.teaser ? h('p.lead.mt-4', {}, cover.teaser) : null,
      h('div.cs-stats', {},
        cover.reading_minutes
          ? h('div.cs-stat', {}, h('span', { 'aria-hidden': 'true' }, '⏱'),
              h('strong', {}, `${cover.reading_minutes} min`),
              h('span.cs-stat__label', {}, 'read'))
          : null,
        cover.quiz_count
          ? h('div.cs-stat', {}, h('span', { 'aria-hidden': 'true' }, '🎯'),
              h('strong', {}, String(cover.quiz_count)),
              h('span.cs-stat__label', {}, 'quiz questions'))
          : null)),

    h('div.cs-locked.mt-8', {},
      // Inert placeholder. aria-hidden so a screen reader is not read
      // meaningless filler, and inert so nothing inside is focusable.
      h('div.cs-locked__preview', { 'aria-hidden': 'true', inert: true },
        placeholderLines(9)),

      h('div.cs-locked__veil', { role: 'region', 'aria-label': 'Premium content locked' },
        h('div.cs-locked__icon', { 'aria-hidden': 'true' }, '🔒'),
        h('h2.cs-locked__title', {}, 'Premium Feature'),
        h('p.cs-locked__body', {},
          'This is a premium cheat sheet. The free cheat sheet for this rule ' +
          'stays free — it’s linked below.'),
        includes.length
          ? h('ul.cs-locked__list', { role: 'list' }, includes.map((i) => h('li', {}, i)))
          : null,
        h('div.row-wrap', { style: { justifyContent: 'center' } },
          h('a.btn.btn-premium.btn-lg', { href: upgradeUrl }, 'Upgrade'),
          h('a.btn.btn-lg', { href: upgradeUrl + '#what-you-get' }, 'Learn More')))),

    h('div.row-wrap.mt-8', { style: { justifyContent: 'center' } },
      cover.rule_slug
        ? h('a.btn', { href: `cheatsheet.html?rule=${cover.rule_slug}` },
            'Read the free cheat sheet for this rule')
        : null,
      h('a.btn.btn-ghost', { href: 'cheatsheets.html' }, 'All cheat sheets'))
  ];
}

/** Premium-only sections, rendered only when the server actually sent them. */
export function premiumSections(sheet) {
  const p = sheet?.premium;
  if (!p || !Object.keys(p).length) return [];
  const out = [];

  if (p.strategies?.length) {
    out.push(section('♟️', SECTION_LABEL.strategies,
      h('ol.cs-recap', {}, p.strategies.map((x) => h('li', {}, x)))));
  }

  if (p.traps?.length) {
    out.push(section('🕳️', SECTION_LABEL.traps,
      p.traps.map((t, i) =>
        h('div.cs-trap', {},
          h('span.cs-trap__n', { 'aria-hidden': 'true' }, String(i + 1)),
          h('div', {},
            h('strong', {}, t.name),
            t.tell ? h('div.text-sm.mt-2', {}, `How to spot it: ${t.tell}`) : null,
            t.fix ? h('div.text-sm.mt-2', {}, `What to do: ${t.fix}`) : null)))));
  }

  if (p.diagram?.steps?.length) {
    out.push(section('🗺️', p.diagram.title || SECTION_LABEL.diagram,
      h('ol.cs-recap', {}, p.diagram.steps.map((s) =>
        h('li', {}, h('div', {}, h('strong', {}, s.ask),
          s.yes ? h('div.text-sm.mt-2', {}, `Yes → ${s.yes}`) : null,
          s.no ? h('div.text-sm', {}, `No → ${s.no}`) : null))))));
  }

  if (p.difficulty) {
    out.push(section('📊', SECTION_LABEL.difficulty,
      h('div.stack-sm', {}, ['easy', 'medium', 'hard'].filter((k) => p.difficulty[k]).map((k) =>
        h('div.cs-example', { dataset: { kind: 'good' } },
          h('div', { style: { padding: 'var(--space-4) var(--space-5)' } },
            h('span.badge', { dataset: { difficulty: k } }, k),
            h('p.mt-2', {}, p.difficulty[k])))))));
  }

  if (p.mnemonics?.length) {
    out.push(section('🧩', SECTION_LABEL.mnemonics,
      h('div.stack-sm', {}, p.mnemonics.map((m) =>
        h('div.cs-trick', { style: { padding: 'var(--space-5)' } },
          h('div.cs-trick__line', { style: { fontSize: 'var(--text-lg)' } }, m.line || m),
          m.why ? h('p.cs-trick__detail', {}, m.why) : null)))));
  }

  if (p.quiz?.length) out.push(quizSection(p.quiz));

  if (p.exam_day?.length) {
    out.push(section('📋', SECTION_LABEL.exam_day,
      h('ol.cs-recap', {}, p.exam_day.map((x) => h('li', {}, x)))));
  }

  if (p.checkpoint) {
    out.push(section('🏁', SECTION_LABEL.checkpoint,
      h('p', {}, p.checkpoint.prompt),
      p.checkpoint.criteria?.length
        ? h('ul.cs-locked__list.mt-4', { role: 'list' },
            p.checkpoint.criteria.map((c) => h('li', {}, c)))
        : null));
  }

  return out;
}

/** Self-contained mini quiz: answer, reveal, move on. */
function quizSection(quiz) {
  const slot = h('div');
  let index = 0;
  let picked = null;
  let revealed = false;

  const draw = () => {
    const q = quiz[index];
    render(slot,
      h('div.row-between', { style: { marginBottom: 'var(--space-4)' } },
        h('span.text-sm.muted', {}, `Question ${index + 1} of ${quiz.length}`),
        h('div.progress.progress--thin', { style: { width: '120px' } },
          h('div.progress__fill', { style: { width: `${((index + 1) / quiz.length) * 100}%` } }))),
      h('p', { style: { fontFamily: 'var(--font-serif)', fontSize: 'var(--text-md)' } }, q.q),
      h('div.choices.mt-4', { role: 'radiogroup', 'aria-label': 'Quiz choices' },
        (q.choices || []).map((c, i) => {
          let state = null, glyph = null;
          if (revealed) {
            if (i === q.answer) { state = 'correct'; glyph = '✓'; }
            else if (i === picked) { state = 'incorrect'; glyph = '✕'; }
            else state = 'dimmed';
          }
          return h('button.choice', {
            type: 'button', role: 'radio',
            'aria-checked': String(picked === i),
            disabled: revealed,
            dataset: state ? { state } : {},
            onclick() { picked = i; draw(); }
          },
            h('span.choice__key', { 'aria-hidden': 'true' }, 'ABCD'[i]),
            h('span.choice__body', {}, c),
            glyph ? h('span.choice__mark', { 'aria-hidden': 'true' }, glyph) : null);
        })),
      revealed
        ? h('div.explanation.mt-4', { dataset: { result: picked === q.answer ? 'correct' : 'incorrect' } },
            h('div.explanation__head', {}, picked === q.answer ? '✓ Correct' : '✕ Not quite'),
            h('div.explanation__body', {}, h('p', {}, q.why)))
        : null,
      h('div.row-wrap.mt-6', {},
        !revealed
          ? h('button.btn.btn-primary', {
              type: 'button', disabled: picked === null,
              onclick() { revealed = true; draw(); }
            }, 'Check')
          : index < quiz.length - 1
            ? h('button.btn.btn-primary', {
                type: 'button',
                onclick() { index++; picked = null; revealed = false; draw(); }
              }, 'Next question →')
            : h('span.badge.badge-success', {}, 'Quiz complete')));
  };

  draw();
  return section('🎯', SECTION_LABEL.quiz, slot);
}
