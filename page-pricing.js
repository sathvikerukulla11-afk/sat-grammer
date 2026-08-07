/** Pricing and upgrade. */
import { mountShell } from './ui-shell.js';
import { h, render, $ } from './core-dom.js';
import { isSignedIn } from './core-auth.js';
import { listPremiumFeatures, isPremium, redeemCode, myRequest } from './svc-premium.js';
import { toastSuccess, toastError } from './ui-toast.js';
import { dateShort, relativeTime } from './core-format.js';

await mountShell();

const features = await listPremiumFeatures().catch(() => []);

render($('#feature-grid'), features.map((f) =>
  h('div.card', { style: f.is_live ? {} : { opacity: '0.6' } },
    h('div.row-between', {},
      h('h3.card__title', {}, f.name),
      f.is_live
        ? h('span.badge.badge-success', {}, 'Available now')
        : h('span.badge', {}, 'Coming soon')),
    h('p.muted.mt-2', {}, f.description))));

/* ---- checkout -----------------------------------------------------------
 * No payment provider is wired up yet. Rather than pretend, the button
 * says so. When Stripe is added, its webhook calls set_premium() with the
 * service role — which is the only path that can grant access, by design.
 */
const btn = $('#checkout-btn');
const note = $('#checkout-note');

if (isPremium()) {
  btn.textContent = '✓ You already have Premium';
  btn.disabled = true;
  note.textContent = 'Manage your subscription from Settings.';
} else if (!isSignedIn()) {
  btn.textContent = 'Create a free account first';
  btn.addEventListener('click', () => location.assign('register.html?next=pricing.html'));
  note.textContent = 'Premium attaches to your account, so you need one first.';
} else {
  note.textContent = 'Premium is not on sale yet.';
  btn.addEventListener('click', () => {
    toastSuccess(
      'Premium is not on sale yet — no payment provider is connected, so there is ' +
      'nothing to charge. Access is granted from the admin panel in the meantime.',
      { title: 'Coming soon', duration: 8000 });
  });
}


/* ---- access codes -------------------------------------------------------
 * The state shown here comes from my_premium_request(), which returns only
 * the caller's own row. A student cannot see anyone else's request, and
 * cannot see the codes table at all.
 * ------------------------------------------------------------------------ */
const form  = $('#code-redeem-form');
const slot  = $('#redeem-state');

function showNote(text, tone) {
  render(slot, h(`div.alert.alert-${tone}`, {}, h('div', {}, text)));
}

function showRequest(r) {
  if (!r) return render(slot);

  if (r.status === 'pending') {
    return render(slot, h('div.alert.alert-info', {}, h('div', {},
      h('strong', {}, 'Awaiting review. '),
      `You submitted ${r.code_used} ${relativeTime(r.created_at)}. `,
      'An administrator will approve or reject it — nothing is charged either way.')));
  }

  if (r.status === 'approved') {
    return render(slot, h('div.alert.alert-success', {}, h('div', {},
      h('strong', {}, 'Approved. '),
      r.granted_until
        ? `Premium is active until ${dateShort(r.granted_until)}.`
        : 'Premium is active with no expiry date.',
      r.review_note ? h('div.text-sm.mt-2', {}, r.review_note) : null)));
  }

  return render(slot, h('div.alert.alert-warning', {}, h('div', {},
    h('strong', {}, 'Not approved. '),
    'Your account is still on the free plan, which keeps every free cheat sheet ',
    'and all 151 questions.',
    r.review_note ? h('div.text-sm.mt-2', {}, r.review_note) : null)));
}

if (form) {
  if (isSignedIn()) showRequest(await myRequest());
  else showNote('Sign in first, then enter your code here.', 'info');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isSignedIn()) return location.assign('login.html?next=pricing.html');

    const btn = $('#redeem-btn');
    btn.disabled = true;
    try {
      const out = await redeemCode($('#redeem-code').value);
      if (out.ok) {
        toastSuccess(out.message, { title: 'Request submitted' });
        form.reset();
        showRequest(await myRequest());
      } else {
        // The server answers every bad code the same way on purpose, so a
        // wrong guess reveals nothing about which codes exist.
        showNote(out.message, out.reason === 'already_premium' ? 'success' : 'warning');
      }
    } catch (err) {
      toastError(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}
