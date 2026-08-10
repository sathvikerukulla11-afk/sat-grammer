/** Settings: account, study, appearance, privacy, security. */
import { mountShell } from './ui-shell.js';
import { requireAuth, updatePassword, validatePassword, signOut } from './core-auth.js';
import { $, $$, h } from './core-dom.js';
import { store } from './core-store.js';
import { updateProfile, updateUsername, isUsernameAvailable,
         uploadAvatar, setPreference, exportMyData } from './svc-profile.js';
import { applyTheme, applyFontSize, applyMotion } from './ui-theme.js';
import { toastSuccess, toastError } from './ui-toast.js';
import { confirmDialog, openModal } from './ui-modal.js';
import { local } from './core-store.js';

await mountShell();
const profile = await requireAuth();
if (!profile) throw new Error('redirecting');

const prefs = profile.preferences || {};

/* ---- populate ------------------------------------------------------------ */
$('#display_name').value = profile.display_name || '';
$('#username').value = profile.username || '';
$('#bio').value = profile.bio || '';
$('#target_score').value = profile.target_score || '';
$('#test_date').value = profile.test_date || '';
$('#daily_goal').value = prefs.daily_goal ?? 20;
$('#instant_feedback').checked = prefs.instant_feedback !== false;
$('#keyboard_shortcuts').checked = prefs.keyboard_shortcuts !== false;
$('#reduced_motion').checked = Boolean(prefs.reduced_motion);
$('#is_public').checked = profile.is_public !== false;

const currentTheme = local.get('theme', prefs.theme || 'system');
$$('#theme-picker .btn').forEach((b) =>
  b.setAttribute('aria-pressed', String(b.dataset.theme === currentTheme)));

const currentSize = local.get('fontSize', prefs.font_size || 'md');
$$('#font-picker .btn').forEach((b) =>
  b.setAttribute('aria-pressed', String(b.dataset.size === currentSize)));

/* ---- account form -------------------------------------------------------- */
let usernameTimer;
$('#username').addEventListener('input', (event) => {
  clearTimeout(usernameTimer);
  const value = event.target.value.trim();
  if (value === profile.username) { $('#username-status').textContent = ''; return; }
  usernameTimer = setTimeout(async () => {
    const available = await isUsernameAvailable(value);
    $('#username-status').textContent = available ? 'Available.' : 'That username is taken.';
    $('#username-status').style.color = available ? 'var(--success)' : 'var(--danger)';
  }, 400);
});

$('#account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const username = $('#username').value.trim();
    if (username !== profile.username) await updateUsername(username);

    await updateProfile({
      display_name: $('#display_name').value.trim() || null,
      bio: $('#bio').value.trim() || null
    });

    const file = $('#avatar').files?.[0];
    if (file) await uploadAvatar(file);

    toastSuccess('Account details saved.');
  } catch (err) {
    toastError(err.message);
  }
});

/* ---- study form ---------------------------------------------------------- */
$('#study-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await updateProfile({
      target_score: Number($('#target_score').value) || null,
      test_date: $('#test_date').value || null,
      preferences: {
        ...store.get('profile').preferences,
        daily_goal: Number($('#daily_goal').value) || 20,
        instant_feedback: $('#instant_feedback').checked,
        keyboard_shortcuts: $('#keyboard_shortcuts').checked
      }
    });
    toastSuccess('Study settings saved.');
  } catch (err) {
    toastError(err.message);
  }
});

/* ---- appearance ----------------------------------------------------------- */
$$('#theme-picker .btn').forEach((button) => button.addEventListener('click', async () => {
  $$('#theme-picker .btn').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  applyTheme(button.dataset.theme);
  await setPreference('theme', button.dataset.theme).catch(() => {});
}));

$$('#font-picker .btn').forEach((button) => button.addEventListener('click', async () => {
  $$('#font-picker .btn').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  applyFontSize(button.dataset.size);
  await setPreference('font_size', button.dataset.size).catch(() => {});
}));

$('#reduced_motion').addEventListener('change', async (event) => {
  applyMotion(event.target.checked);
  await setPreference('reduced_motion', event.target.checked).catch(() => {});
});

/* ---- privacy --------------------------------------------------------------- */
$('#is_public').addEventListener('change', async (event) => {
  try {
    await updateProfile({ is_public: event.target.checked });
    toastSuccess(event.target.checked
      ? 'You will appear on the leaderboard.'
      : 'You are hidden from the leaderboard.');
  } catch (err) {
    toastError(err.message);
    event.target.checked = !event.target.checked;
  }
});

$('#export-data-btn').addEventListener('click', async (event) => {
  event.currentTarget.dataset.loading = 'true';
  try {
    const payload = await exportMyData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = h('a', {
      href: URL.createObjectURL(blob),
      download: `sat-grammar-lab-export-${new Date().toISOString().slice(0, 10)}.json`
    });
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (err) {
    toastError(err.message);
  } finally {
    delete event.currentTarget.dataset.loading;
  }
});

/* ---- security ---------------------------------------------------------------- */
$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const next = $('#new_password').value;
  const confirmValue = $('#confirm_password').value;

  const problem = validatePassword(next);
  if (problem) return toastError(problem);
  if (next !== confirmValue) return toastError('The two passwords don’t match.');

  try {
    await updatePassword(next);
    $('#password-form').reset();
    toastSuccess('Password changed.');
  } catch (err) {
    toastError(err.message);
  }
});

/*
 * Account deletion needs a privileged operation (auth.users delete), which
 * the browser cannot perform with the publishable key. It calls an edge
 * function that verifies the caller's JWT and then deletes with the service
 * role. See supabase/functions/delete-account/.
 */
$('#delete-account-btn').addEventListener('click', async () => {
  const confirmed = await confirmDialog({
    title: 'Delete your account?',
    message: 'This removes your profile, every attempt, and all statistics. ' +
             'It can’t be undone. Consider exporting your data first.',
    confirmLabel: 'Delete permanently',
    danger: true
  });
  if (!confirmed) return;

  const input = h('input.input', { type: 'text', placeholder: profile.username });
  openModal({
    title: 'Type your username to confirm',
    body: h('div.field', {},
      h('p.text-sm.muted', {}, `Type ${profile.username} to confirm deletion.`),
      input),
    actions: [
      { label: 'Cancel', value: false },
      { label: 'Delete my account', variant: 'btn-danger', async onClick() {
          if (input.value.trim() !== profile.username) {
            toastError('That doesn’t match your username.');
            return false;
          }
          try {
            const { supabase } = await import('./core-supabase.js');
            const { error } = await supabase.functions.invoke('delete-account');
            if (error) throw error;
            toastSuccess('Account deleted. Signing you out.');
            setTimeout(() => signOut(), 1200);
          } catch {
            toastError('Deletion failed. Please contact support.');
          }
          return true;
        } }
    ]
  });
});

/* Handle the ?#reset landing from a password reset email. */
if (location.hash === '#reset') {
  $('#new_password')?.focus();
  toastSuccess('You can set a new password below.', { title: 'Reset link accepted' });
}
