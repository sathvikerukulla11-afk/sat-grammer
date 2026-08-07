/**
 * Cheat sheet rendering.
 *
 * Everything is built with h(), so a highlight span inside an example is
 * assembled from text nodes rather than interpolated markup — the same
 * XSS rule the rest of the site follows, and it applies here because
 * example text is editable content.
 */
import { h, render } from './core-dom.js';

/**
 * Split a sentence around the phrase to highlight and wrap that phrase.
 *
 * `mark` may be a literal substring or a loose form with "..." standing in
 * for words between two parts ("crate ... is"), which lets an example
 * highlight a subject and its verb without highlighting everything
 * between them.
 */
export function markUp(text, mark) {
  if (!mark) return [text];

  const parts = String(mark).split(/\s*\.\.\.\s*/).filter(Boolean);
  const out = [];
  let rest = text;

  for (const part of parts) {
    const at = rest.indexOf(part);
    if (at === -1) continue;             // fall through, leave text plain
    if (at > 0) out.push(rest.slice(0, at));
    out.push(h('span.cs-mark', {}, part));
    rest = rest.slice(at + part.length);
  }
  out.push(rest);
  return out.length ? out : [text];
}

/** A correct example, or a mistake. Click reveals the explanation. */
export function exampleCard(item, kind) {
  const isBad = kind === 'bad';
  const text = isBad ? item.wrong : item.text;

  const note = h('div.cs-example__note', { hidden: true },
    isBad ? item.why : item.note,
    isBad && item.fixed
      ? h('span.cs-example__fix', {}, `✓ ${item.fixed}`)
      : null);

  const line = h('button.cs-example__line', {
    type: 'button',
    'aria-expanded': 'false',
    onclick() {
      const open = note.hidden;
      note.hidden = !open;
      this.setAttribute('aria-expanded', String(open));
      card.dataset.open = String(open);
      hint.textContent = open ? 'hide' : 'why?';
    }
  },
    h('span.cs-example__glyph', { 'aria-hidden': 'true' }, isBad ? '✕' : '✓'),
    h('span', {}, markUp(text, item.mark)),
    h('span.visually-hidden', {}, isBad ? ' — incorrect example' : ' — correct example'));

  const hint = h('span.cs-example__hint', { 'aria-hidden': 'true' }, 'why?');
  line.append(hint);

  const card = h('div.cs-example', { dataset: { kind, open: 'false' } }, line, note);
  return card;
}

export function section(emoji, title, ...body) {
  return h('section.cs-section', {},
    h('div.cs-section__head', {},
      h('span.cs-section__emoji', { 'aria-hidden': 'true' }, emoji),
      h('h2.cs-section__title', {}, title)),
    h('div.cs-section__body', {}, body));
}

/** Reading progress along the top of the page. */
export function bindReadingProgress(fill) {
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    fill.style.width = `${max <= 0 ? 100 : Math.min(100, (window.scrollY / max) * 100)}%`;
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
  return update;
}

export const FREQUENCY_LABEL = {
  'very common': 'Shows up on nearly every test',
  'common': 'Usually one or two per test',
  'occasional': 'Appears now and then',
  'rare': 'Rare, but worth knowing'
};
