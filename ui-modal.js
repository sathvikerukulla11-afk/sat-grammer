/**
 * Modals built on the native <dialog> element, which gives us the
 * focus trap, Escape handling, and inert background for free.
 */
import { h, $, trapFocus } from './core-dom.js';

export function openModal({ title, body, actions = [], size = null, onClose } = {}) {
  const dialog = h('dialog.modal', {
    'aria-labelledby': 'modal-title',
    style: size ? { width: size } : null
  },
    h('div.modal__header', {},
      h('h2#modal-title.modal__title', {}, title),
      h('button.btn.btn-ghost.btn-icon', {
        type: 'button', 'aria-label': 'Close', onclick: () => close(null)
      }, '×')
    ),
    h('div.modal__body', {}, body),
    actions.length ? h('div.modal__footer', {}, actions.map(makeAction)) : null
  );

  let result = null;
  function makeAction(action) {
    return h(`button.btn.${action.variant || 'btn-ghost'}`, {
      type: 'button',
      onclick: async () => {
        if (action.onClick) {
          const outcome = await action.onClick();
          if (outcome === false) return;    // action vetoed the close
          result = outcome ?? action.value ?? true;
        } else {
          result = action.value ?? true;
        }
        close(result);
      }
    }, action.label);
  }

  function close(value) {
    dialog.close();
    dialog.remove();
    releaseTrap();
    onClose?.(value);
  }

  document.body.append(dialog);
  const releaseTrap = trapFocus(dialog);
  dialog.showModal();
  dialog.addEventListener('cancel', () => { dialog.remove(); releaseTrap(); onClose?.(null); });

  return { dialog, close };
}

/** Promise-based confirm. Replaces window.confirm, which cannot be styled. */
export function confirmDialog({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false
} = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: h('p', {}, message),
      actions: [
        { label: cancelLabel, value: false },
        { label: confirmLabel, value: true, variant: danger ? 'btn-danger' : 'btn-primary' }
      ],
      onClose: (value) => resolve(Boolean(value))
    });
  });
}
