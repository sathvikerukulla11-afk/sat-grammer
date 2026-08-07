/** Login page controller. */
import { mountShell } from './ui-shell.js';
import { $ } from './core-dom.js';
import { signIn, sendMagicLink, requestPasswordReset,
         validateEmail, redirectIfSignedIn } from './core-auth.js';
import { toastSuccess, toastError } from './ui-toast.js';
import { CONFIG } from './config.js';

await mountShell({ skipAuth: false });
await redirectIfSignedIn();

const form = $('#login-form');
const alertBox = $('#form-alert');
const submitBtn = $('#submit-btn');

function showAlert(message, tone = 'error') {
  alertBox.className = `alert alert-${tone}`;
  alertBox.textContent = message;
  alertBox.hidden = false;
}

function fieldError(id, message) {
  const input = $(`#${id}`);
  const error = $(`#${id}-error`);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  error.textContent = message || '';
  error.hidden = !message;
  return !message;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  alertBox.hidden = true;

  const email = $('#email').value.trim();
  const password = $('#password').value;

  const emailOk = fieldError('email', validateEmail(email));
  const passwordOk = fieldError('password', password ? null : 'Password is required.');
  if (!emailOk || !passwordOk) return;

  submitBtn.dataset.loading = 'true';
  try {
    await signIn({ email, password });

    const next = new URLSearchParams(location.search).get('next');
    const safe = next && /^[a-z0-9_-]+\.html(\?.*)?$/i.test(next) ? next : CONFIG.ROUTES.DASHBOARD;
    location.assign(safe);
  } catch (err) {
    showAlert(err.message);
    $('#password').value = '';
    $('#password').focus();
  } finally {
    delete submitBtn.dataset.loading;
  }
});

$('#magic-link-btn').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  if (!fieldError('email', validateEmail(email))) return;

  try {
    await sendMagicLink(email);
    toastSuccess('Check your inbox — we sent you a sign-in link.', { title: 'Link sent' });
  } catch (err) {
    toastError(err.message);
  }
});

$('#forgot-btn').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  if (!fieldError('email', validateEmail(email) || null)) {
    showAlert('Enter your email address first, then press Forgot.');
    return;
  }
  try {
    await requestPasswordReset(email);
    toastSuccess('If that address has an account, a reset link is on its way.');
  } catch (err) {
    toastError(err.message);
  }
});
