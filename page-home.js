/**
 * Home page.
 *
 * Two jobs: point "Start Practicing" at the right place, and state what is
 * in the bank using real counts rather than adjectives. No demo fetch, no
 * scroll animation, no stat strip — the page is deliberately quiet.
 */
import { mountShell } from './ui-shell.js';
import { h, render, $, $$ } from './core-dom.js';
import { isSignedIn } from './core-auth.js';
import { num } from './core-format.js';
import { getSiteStats } from './svc-questions.js';

await mountShell();

/* practice.html is in CONFIG.PROTECTED, so sending a signed-out visitor
   there just bounces them to login. Registering with ?next= lands them on
   practice the moment they have an account. */
if (isSignedIn()) {
  $$('#cta-practice, #cta-practice-2').forEach((a) => { a.href = 'practice.html'; });
}

/* ---- what is in the bank ------------------------------------------------
 * Exact numbers, not rounded marketing ones. "151 questions" is a claim
 * somebody counted; "150+ and growing" is a claim nobody can check, and
 * students can tell the difference.
 *
 * question_count includes premium items a logged-out visitor cannot reach,
 * so this quotes free_question_count.
 * ------------------------------------------------------------------------ */
try {
  const s = await getSiteStats();
  const questions = Number(s?.free_question_count) || 0;
  const rules = Number(s?.rule_count) || 0;
  const sheets = Number(s?.free_cheat_sheet_count) || 0;

  const facts = [
    questions && `${num(questions)} original questions, every one written by hand for this site`,
    rules && `All ${num(rules)} grammar rules the Writing section actually tests`,
    sheets && `${num(sheets)} cheat sheets you can read without an account`,
    'An explanation for all four choices, not just the right one'
  ].filter(Boolean);

  if (facts.length > 1) {
    const list = $('#bank-facts');
    render(list, facts.map((text) => h('li', {}, text)));
    list.hidden = false;
  }
} catch {
  // Say nothing rather than guess. An omitted line reads better than a
  // wrong count on a page whose whole point is being trustworthy.
}
