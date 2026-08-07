/**
 * Renders one question and its graded state.
 *
 * Accessibility notes:
 *  - The choice list is a radiogroup; arrow keys move between options and
 *    Enter or Space selects, matching native radio behaviour.
 *  - Correct/incorrect is never signalled by colour alone: each graded
 *    choice gains a glyph plus a visually-hidden word.
 *  - The explanation lands in an aria-live region so a screen reader
 *    announces the result without the user hunting for it.
 */
import { h, render, $$ } from './core-dom.js';
import { titleCase } from './core-format.js';

const LABELS = ['A', 'B', 'C', 'D'];

export function renderQuestionCard(container, runner) {
  if (runner.reviewing) return renderReviewScreen(container, runner);

  const question = runner.current;
  if (!question) return;

  const grade = runner.grade;
  const graded = Boolean(grade);

  render(container,
    h('article.question', { 'aria-labelledby': 'question-stem' },
      buildBar(runner, question),
      h('div.question__body', {},
        buildPassage(question, runner),
        h('p#question-stem.question__stem', {}, question.stem),
        buildChoices(runner, question, grade),
        h('div#explanation-region', { 'aria-live': 'polite', 'aria-atomic': 'true' },
          graded ? buildExplanation(question, grade) : null)
      ),
      buildFooter(runner, graded)
    )
  );

  if (!graded) {
    const first = container.querySelector('.choice:not(:disabled)');
    if (first && !container.contains(document.activeElement)) first.setAttribute('tabindex', '0');
  }
}

function buildBar(runner, question) {
  return h('div.question__bar', {},
    h('span.question__counter', {}, `Question ${runner.index + 1} of ${runner.total}`),
    h('span.badge', { dataset: { difficulty: question.difficulty } }, titleCase(question.difficulty)),
    h('span.question__rule', {}, question.rule.name),
    h('div.spacer'),
    h('button.btn.btn-ghost.btn-sm', {
      type: 'button',
      'aria-pressed': String(runner.isFlagged),
      'data-tooltip': 'Mark this question to revisit before you submit',
      style: runner.isFlagged ? { color: 'var(--warning)' } : {},
      onclick: () => runner.toggleFlag()
    }, runner.isFlagged ? '⚑ Flagged' : '⚐ Flag'),
    h('button.btn.btn-ghost.btn-sm', {
      type: 'button',
      'aria-pressed': String(Boolean(question.bookmarked)),
      'data-tooltip': question.bookmarked ? 'Remove bookmark' : 'Bookmark this question',
      onclick: () => runner.toggleBookmark()
    }, question.bookmarked ? '★ Saved' : '☆ Save')
  );
}

/**
 * The passage may contain a literal '____' placeholder. We split on it so
 * the blank can be styled and filled with the student's current choice —
 * which makes the sentence readable as they consider each option.
 */
function buildPassage(question, runner) {
  const text = question.passage;
  if (!text.includes('____')) return h('div.passage', {}, text);

  const [before, ...rest] = text.split(/_{3,}/);
  const after = rest.join('____');

  const selectedChoice = question.choices.find((c) => c.id === runner.selected);
  const filled = runner.grade
    ? question.choices.find((c) => c.label === runner.grade.correct_label)
    : selectedChoice;

  return h('div.passage', {},
    before,
    h('span.blank', {
      dataset: { filled: String(Boolean(filled)) },
      'aria-label': filled ? `blank filled with: ${filled.body}` : 'blank'
    }, filled ? filled.body : '    '),
    after
  );
}

function buildChoices(runner, question, grade) {
  const graded = Boolean(grade);

  return h('div.choices', {
    role: 'radiogroup',
    'aria-labelledby': 'question-stem',
    onkeydown: (event) => handleArrowKeys(event, runner, question)
  },
    question.choices.map((choice, i) => {
      const selected = runner.selected === choice.id;
      let state = null;
      let mark = null;
      let srLabel = null;

      if (graded) {
        const isCorrect = choice.label === grade.correct_label;
        const wasChosen = choice.id === grade.selected_choice_id;
        if (isCorrect) { state = 'correct'; mark = '✓'; srLabel = 'Correct answer'; }
        else if (wasChosen) { state = 'incorrect'; mark = '✕'; srLabel = 'Your answer, incorrect'; }
        else { state = 'dimmed'; }
      }

      return h('button.choice', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(selected),
        'aria-describedby': graded ? 'explanation-region' : null,
        tabindex: selected || (!runner.selected && i === 0) ? '0' : '-1',
        disabled: graded,
        dataset: state ? { state } : {},
        onclick: () => runner.select(choice.id)
      },
        h('span.choice__key', { 'aria-hidden': 'true' }, LABELS[i]),
        h('span.choice__body', {},
          choice.body || h('em.subtle', {}, '(no added punctuation)')),
        srLabel ? h('span.visually-hidden', {}, srLabel) : null,
        mark ? h('span.choice__mark', { 'aria-hidden': 'true' }, mark) : null
      );
    })
  );
}

function handleArrowKeys(event, runner, question) {
  const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();

  const options = $$('.choice', event.currentTarget);
  const currentIndex = options.findIndex((el) => el === document.activeElement);
  const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
  const nextIndex = (currentIndex + step + options.length) % options.length;

  options[nextIndex]?.focus();
  runner.select(question.choices[nextIndex].id);
}

function buildExplanation(question, grade) {
  const result = grade.is_correct ? 'correct' : 'incorrect';

  return h('div.explanation', { dataset: { result } },
    h('div.explanation__head', {},
      h('span', { 'aria-hidden': 'true' }, grade.is_correct ? '✓' : '✕'),
      h('span', {}, grade.is_correct
        ? 'Correct'
        : grade.skipped
          ? `Skipped — the answer was ${grade.correct_label}`
          : `Not quite — the answer was ${grade.correct_label}`),
      grade.xp_gained ? h('span.badge.badge-brand', {}, `+${grade.xp_gained} XP`) : null
    ),
    h('div.explanation__body', {},
      h('p', {}, grade.explanation),
      h('div.rationales', {},
        Object.entries(grade.rationales || {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([label, rationale]) =>
            h('div.rationale', { dataset: { correct: String(label === grade.correct_label) } },
              h('span.rationale__key', {}, label),
              h('span', {}, rationale)
            )
          )
      )
    )
  );
}

function buildFooter(runner, graded) {
  return h('div.question__footer', {},
    !graded
      ? h('button.btn.btn-primary#submit-btn', {
          type: 'button',
          disabled: !runner.selected,
          onclick: () => runner.submit()
        }, 'Check answer')
      : h('button.btn.btn-primary#next-btn', {
          type: 'button',
          onclick: () => runner.next()
        }, runner.isLast ? 'Finish session' : 'Next question →'),

    !graded
      ? h('button.btn.btn-ghost', { type: 'button', onclick: () => runner.skip() }, 'Skip')
      : null,

    h('button.btn.btn-ghost', {
      type: 'button',
      onclick: () => runner.previous(),
      disabled: runner.index === 0
    }, '← Back'),

    h('button.btn.btn-ghost', {
      type: 'button',
      onclick: () => runner.openReview()
    }, `Review (${runner.answered}/${runner.total})`),

    h('div.spacer'),

    h('div.kbd-hints.hide-mobile', {},
      h('span', {}, h('kbd', {}, 'A'), '–', h('kbd', {}, 'D'), ' select'),
      h('span', {}, h('kbd', {}, 'Enter'), graded ? ' next' : ' check'),
      h('span', {}, h('kbd', {}, 'F'), ' flag'),
      h('span', {}, h('kbd', {}, 'R'), ' review')
    )
  );
}

/**
 * The pre-submit review screen.
 *
 * Nobody should submit a set without seeing which questions they left
 * blank and which they flagged. This is the single most requested
 * feature of any timed test interface, and its absence is the reason
 * students lose points they had already earned.
 */
function renderReviewScreen(container, runner) {
  const summary = runner.reviewSummary();

  render(container,
    h('article.question', {},
      h('div.question__bar', {},
        h('span.question__counter', {}, 'Review your answers'),
        h('div.spacer'),
        h('button.btn.btn-ghost.btn-sm', {
          type: 'button', onclick: () => runner.closeReview()
        }, '← Back to question ' + (runner.index + 1))),

      h('div.question__body', {},
        h('div.grid.grid-3', {},
          reviewTile('Answered', `${summary.answered} / ${summary.total}`, null),
          reviewTile('Unanswered', String(summary.unanswered),
                     summary.unanswered ? 'var(--danger)' : 'var(--success)'),
          reviewTile('Flagged', String(summary.flagged),
                     summary.flagged ? 'var(--warning)' : null)),

        summary.unanswered
          ? h('div.alert.alert-warning.mt-6', {}, h('div', {},
              h('strong', {}, `${summary.unanswered} question`
                + (summary.unanswered === 1 ? '' : 's')
                + ' still unanswered. '),
              'An unanswered question scores nothing. A guess has a one-in-four chance.'))
          : null,

        h('h3.h5.mt-6', {}, 'Every question in this set'),
        h('p.text-sm.muted', {}, 'Select any number to go back to it.'),

        h('div.session-dots.mt-4', { role: 'list' }, summary.rows.map((row) =>
          h('button.session-dot', {
            type: 'button',
            role: 'listitem',
            style: { width: '34px', height: '34px', fontSize: 'var(--text-xs)' },
            dataset: {
              state: row.answered
                ? (row.skipped ? 'skipped' : 'correct')
                : (row.flagged ? 'flagged' : 'pending')
            },
            'aria-label': `Question ${row.index + 1}: `
              + (row.answered ? 'answered' : 'not answered')
              + (row.flagged ? ', flagged' : ''),
            onclick: () => runner.goTo(row.index)
          },
            String(row.index + 1),
            row.flagged ? h('span', { 'aria-hidden': 'true' }, '⚑') : null))),

        h('div.row-wrap.mt-8', {},
          summary.unanswered
            ? h('button.btn', {
                type: 'button', onclick: () => runner.goToNextUnanswered()
              }, 'Go to first unanswered')
            : null,
          summary.flagged
            ? h('button.btn', {
                type: 'button', onclick: () => runner.goToNextFlagged()
              }, 'Go to first flagged')
            : null)),

      h('div.question__footer', {},
        h('button.btn.btn-ghost', {
          type: 'button', onclick: () => runner.closeReview()
        }, 'Keep working'),
        h('div.spacer'),
        h('button.btn.btn-primary', {
          type: 'button', onclick: () => runner.finish()
        }, 'Submit this set')))
  );
}

function reviewTile(label, value, colour) {
  return h('div.stat', {},
    h('span.stat__label', {}, label),
    h('span.stat__value', { style: colour ? { color: colour } : {} }, value));
}

/**
 * Global keyboard shortcuts for the practice screen.
 * Returns a cleanup function.
 */
export function bindShortcuts(runner) {
  const onKey = (event) => {
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const key = event.key.toUpperCase();
    const letterIndex = LABELS.indexOf(key);
    const numberIndex = ['1', '2', '3', '4'].indexOf(event.key);
    const choiceIndex = letterIndex >= 0 ? letterIndex : numberIndex;

    if (choiceIndex >= 0 && !runner.isGraded) {
      event.preventDefault();
      const choice = runner.current?.choices[choiceIndex];
      if (choice) runner.select(choice.id);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      runner.isGraded ? runner.next() : runner.submit();
    } else if (key === 'B') {
      event.preventDefault();
      runner.toggleBookmark();
    } else if (key === 'F') {
      event.preventDefault();
      runner.toggleFlag();
    } else if (key === 'R') {
      event.preventDefault();
      runner.reviewing ? runner.closeReview() : runner.openReview();
    } else if (key === 'S' && !runner.isGraded) {
      event.preventDefault();
      runner.skip();
    }
  };

  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
