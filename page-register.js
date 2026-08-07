/** Registration page controller. */
import { mountShell } from './ui-shell.js';
import { $ } from './core-dom.js';
import { register, redirectIfSignedIn, validateEmail, validatePassword,
         validateUsername, passwordScore } from './core-auth.js';
import { isUsernameAvailable } from './svc-profile.js';

await mountShell();
await redirectIfSignedIn();

const form = $('#register-form');
const alertBox = $('#form-alert');
const submitBtn = $('#submit-btn');
const passwordInput = $('#password');
const strength = $('#strength');
const strengthText = $('#strength-text');

const STRENGTH_WORDS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];

function fieldError(id, message) {
  const input = $(`#${id}`);
  const error = $(`#${id}-error`);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  error.textContent = message || '';
  error.hidden = !message;
  return !message;
}

passwordInput.addEventListener('input', () => {
  const score = passwordScore(passwordInput.value);
  strength.dataset.score = String(score);
  strengthText.textContent = passwordInput.value
    ? `${STRENGTH_WORDS[score]} — at least 8 characters, with a letter and a number.`
    : 'At least 8 characters, with a letter and a number.';
});

// Debounced availability check, so the user finds out before submitting.
let usernameTimer;
$('#username').addEventListener('input', (event) => {
  clearTimeout(usernameTimer);
  const value = event.target.value.trim();
  const problem = validateUsername(value);
  if (problem) return fieldError('username', value ? problem : null);

  usernameTimer = setTimeout(async () => {
    const available = await isUsernameAvailable(value);
    fieldError('username', available ? null : 'That username is taken.');
  }, 400);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  alertBox.hidden = true;

  const username = $('#username').value.trim();
  const email = $('#email').value.trim();
  const password = passwordInput.value;

  const ok = [
    fieldError('username', validateUsername(username)),
    fieldError('email', validateEmail(email)),
    fieldError('password', validatePassword(password))
  ].every(Boolean);

  if (!$('#terms').checked) {
    alertBox.className = 'alert alert-error';
    alertBox.textContent = 'Please accept the terms to continue.';
    alertBox.hidden = false;
    return;
  }
  if (!ok) return;

  submitBtn.dataset.loading = 'true';
  try {
    const { needsConfirmation } = await register({ email, password, username });

    if (needsConfirmation) {
      form.hidden = true;
      alertBox.className = 'alert alert-success';
      alertBox.textContent =
        `Almost there — we sent a confirmation link to ${email}. Click it to activate your account.`;
      alertBox.hidden = false;
    } else {
      location.assign('dashboard.html');
    }
  } catch (err) {
    alertBox.className = 'alert alert-error';
    alertBox.textContent = err.message;
    alertBox.hidden = false;
  } finally {
    delete submitBtn.dataset.loading;
  }
});
