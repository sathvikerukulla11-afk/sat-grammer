/**
 * DOM helpers.
 *
 * `h()` builds elements without innerHTML, which means user-supplied
 * strings (usernames, bookmark notes, report text) can never become
 * markup. This is the project's primary XSS defence.
 */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * h('button.btn.btn-primary', { onclick, 'aria-label': 'x' }, 'Label')
 * Children may be strings, nodes, arrays, or null/false (skipped).
 */
export function h(spec, props = {}, ...children) {
  const [tagPart, ...classes] = String(spec).split('.');
  const [tag, id] = tagPart.split('#');
  const el = document.createElement(tag || 'div');

  if (id) el.id = id;
  if (classes.length) el.classList.add(...classes);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      el.classList.add(...String(value).split(/\s+/).filter(Boolean));
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      // Explicit opt-in, used only for markup this codebase authored.
      el.innerHTML = value;
    } else if (key in el && key !== 'list' && typeof value !== 'object') {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  }

  appendAll(el, children);
  return el;
}

function appendAll(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace an element's contents in one paint. */
export function render(target, ...children) {
  const el = typeof target === 'string' ? $(target) : target;
  if (!el) return null;
  el.replaceChildren();
  appendAll(el, children);
  return el;
}

export function show(el, visible = true) {
  if (el) el.hidden = !visible;
}

/** Escape for the rare place where a string must enter an attribute. */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function delegate(root, eventName, selector, handler) {
  root.addEventListener(eventName, (event) => {
    const match = event.target.closest(selector);
    if (match && root.contains(match)) handler(event, match);
  });
}

/** Trap Tab inside a container (modals, drawers). Returns a cleanup fn. */
export function trapFocus(container) {
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
                    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const onKey = (event) => {
    if (event.key !== 'Tab') return;
    const items = $$(FOCUSABLE, container).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}
