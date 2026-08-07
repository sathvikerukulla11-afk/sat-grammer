/**
 * Recommendation cards.
 *
 * Every card states the action AND the evidence behind it. A
 * recommendation a student does not believe is a recommendation they
 * will ignore, so the reason is not optional decoration — it is the
 * point.
 */
import { h, render } from './core-dom.js';

const TONE = {
  weak_rule:  { icon: '◎', colour: 'var(--danger)'  },
  review:     { icon: '↺', colour: 'var(--warning)' },
  pacing:     { icon: '⏱', colour: 'var(--brand)'   },
  goal:       { icon: '◆', colour: 'var(--brand)'   },
  level_up:   { icon: '▲', colour: 'var(--success)' },
  onboarding: { icon: '→', colour: 'var(--brand)'   }
};

export function recommendationCard(rec, { compact = false } = {}) {
  const tone = TONE[rec.kind] || TONE.goal;

  return h('article.card', {
    style: { borderLeft: `3px solid ${tone.colour}` }
  },
    h('div.row', { style: { alignItems: 'flex-start', gap: 'var(--space-4)' } },
      h('span', {
        'aria-hidden': 'true',
        style: { color: tone.colour, fontSize: 'var(--text-xl)', lineHeight: '1' }
      }, tone.icon),
      h('div', { style: { flex: '1', minWidth: '0' } },
        h('h3.card__title', {}, rec.title),
        !compact ? h('p.text-sm.muted.mt-2', {}, rec.reason) : null,
        h('a.btn.btn-sm.btn-secondary.mt-4', { href: rec.action_href }, rec.action_label))));
}

export function renderRecommendations(container, recs, options = {}) {
  if (!recs?.length) {
    render(container, h('p.muted.text-sm', {},
      'Nothing to suggest yet — answer a few questions and this fills in.'));
    return;
  }
  render(container, h('div.stack', {}, recs.map((r) => recommendationCard(r, options))));
}
