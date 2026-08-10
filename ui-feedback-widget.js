/**
 * The site-wide feedback button and dialog.
 *
 * Mounted by the shell on every page, so a student never has to go
 * looking for where to report something.
 */
import { h, $ } from './core-dom.js';
import { openModal } from './ui-modal.js';
import { toastSuccess, toastError } from './ui-toast.js';
import { submitFeedback, KINDS } from './svc-feedback.js';

export function openFeedbackDialog(preset = {}) {
  const kindSelect = h('select.select', { id: 'fb-kind' },
    KINDS.map((k) => h('option', {
      value: k.value, selected: k.value === preset.kind
    }, k.label)));

  const subjectInput = h('input.input', {
    type: 'text', id: 'fb-subject', maxlength: '140',
    value: preset.subject || '',
    placeholder: 'One line: what happened?'
  });

  const bodyInput = h('textarea.textarea', {
    id: 'fb-body', rows: '6', maxlength: '4000',
    value: preset.body || '',
    placeholder: 'What were you doing, what did you expect, and what happened instead?'
  });

  openModal({
    title: 'Send feedback',
    size: '560px',
    body: h('div.stack', {},
      h('p.text-sm.muted', {},
        'This goes straight to the people who build the site. We record which page ' +
        'you were on and your browser version so we don’t have to ask.'),
      h('div.field', {}, h('label.label', { for: 'fb-kind' }, 'What kind of feedback?'), kindSelect),
      h('div.field', {}, h('label.label', { for: 'fb-subject' }, 'Subject'), subjectInput),
      h('div.field', {}, h('label.label', { for: 'fb-body' }, 'Details'), bodyInput)),
    actions: [
      { label: 'Cancel', value: false },
      { label: 'Send', variant: 'btn-primary', async onClick() {
          try {
            await submitFeedback({
              kind: kindSelect.value,
              subject: subjectInput.value,
              body: bodyInput.value
            });
            toastSuccess('Thank you — this genuinely helps.', { title: 'Feedback sent' });
            return true;
          } catch (err) {
            toastError(err.message);
            return false;   // veto the close so the text is not lost
          }
        } }
    ]
  });
}

/** A small persistent trigger, bottom-left so it never covers a toast. */
export function mountFeedbackButton() {
  if ($('#feedback-fab')) return;

  const button = h('button.btn.btn-sm#feedback-fab', {
    type: 'button',
    'aria-label': 'Send feedback',
    style: {
      position: 'fixed',
      left: 'var(--space-4)',
      bottom: 'var(--space-4)',
      zIndex: 'var(--z-sticky)',
      boxShadow: 'var(--shadow-md)',
      background: 'var(--bg-elevated)'
    },
    onclick: () => openFeedbackDialog()
  }, '✉ Feedback');

  document.body.append(button);
}
