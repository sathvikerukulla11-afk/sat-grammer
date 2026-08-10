/**
 * Home page.
 *
 * One job now: point "Start Practicing" at the right place. The bank counts
 * that used to be fetched here live on learn-more.html instead, so the
 * landing page makes no network call at all and renders instantly.
 */
import { mountShell } from './ui-shell.js';
import { $$ } from './core-dom.js';
import { isSignedIn } from './core-auth.js';

await mountShell();

/* practice.html is in CONFIG.PROTECTED, so sending a signed-out visitor
   there just bounces them to login. Registering with ?next= lands them on
   practice the moment they have an account. */
if (isSignedIn()) {
  $$('#cta-practice, #cta-practice-2').forEach((a) => { a.href = 'practice.html'; });
}
