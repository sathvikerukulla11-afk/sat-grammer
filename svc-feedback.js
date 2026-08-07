/**
 * User feedback: bug reports, feature requests, content problems.
 *
 * Open to anonymous visitors as well as signed-in students. A bug that
 * stops someone registering is exactly the report you most need, and
 * requiring an account to file it guarantees you never hear about it.
 */
import { supabase } from './core-supabase.js';
import { unwrap, AppError } from './core-errors.js';
import { store } from './core-store.js';

export const KINDS = Object.freeze([
  { value: 'bug',     label: 'Something is broken' },
  { value: 'content', label: 'A question is wrong or unclear' },
  { value: 'feature', label: 'I want a feature' },
  { value: 'praise',  label: 'Something worked well' },
  { value: 'other',   label: 'Something else' }
]);

export async function submitFeedback({ kind, subject, body }) {
  if (!subject || subject.trim().length < 3) {
    throw new AppError('Give it a short subject line.');
  }
  if (!body || body.trim().length < 10) {
    throw new AppError('Tell us a little more — at least a sentence.');
  }

  return unwrap(
    await supabase.from('feedback').insert({
      user_id: store.get('user')?.id ?? null,
      kind,
      subject: subject.trim().slice(0, 140),
      body: body.trim().slice(0, 4000),

      // Captured automatically so a bug report is actionable without a
      // follow-up conversation.
      page: location.pathname.split('/').pop() + location.search,
      user_agent: navigator.userAgent.slice(0, 300),
      viewport: `${window.innerWidth}x${window.innerHeight}`
    }).select('id').single()
  );
}

export async function getMyFeedback() {
  return unwrap(
    await supabase.from('feedback')
      .select('id, kind, subject, state, created_at')
      .order('created_at', { ascending: false })
  );
}

/* ---- staff ------------------------------------------------------------- */

export async function listFeedback(state = 'new') {
  let query = supabase
    .from('feedback')
    .select('*, reporter:profiles!feedback_user_id_fkey(username)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (state) query = query.eq('state', state);
  return unwrap(await query);
}

export async function setFeedbackState(id, state, note = null) {
  return unwrap(
    await supabase.from('feedback')
      .update({
        state,
        staff_note: note,
        handled_by: store.get('user')?.id,
        handled_at: new Date().toISOString()
      })
      .eq('id', id).select().single()
  );
}
