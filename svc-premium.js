/**
 * Premium entitlement.
 *
 * Everything here is advisory: it decides what the interface SHOWS, never
 * what a reader can obtain. The server withholds locked content from the
 * response entirely, so a tampered client sees the same blurred teaser
 * with nothing behind it.
 */
import { supabase } from './core-supabase.js';
import { unwrap } from './core-errors.js';
import { store } from './core-store.js';

/** Whether the signed-in profile currently has premium. */
export function isPremium() {
  const p = store.get('profile');
  if (!p?.is_premium) return false;
  if (p.premium_until && new Date(p.premium_until) < new Date()) return false;
  return true;
}

export async function listPremiumFeatures() {
  return unwrap(
    await supabase.from('premium_features')
      .select('key, name, description, is_live, sort_order')
      .order('sort_order')
  );
}

/** Ask the server, for anything that must not be guessed client-side. */
export async function checkAccess(feature = 'cheat_sheets_premium') {
  const { data, error } = await supabase.rpc('has_premium_access', { p_feature: feature });
  return error ? false : Boolean(data);
}

export const UPGRADE_URL = 'pricing.html';

/* ---- access codes -------------------------------------------------------
 * Redeeming a code files a REQUEST. It never grants premium, and there is
 * no client-side path that can. Approval happens in the admin dashboard,
 * through the same server-side call a Stripe webhook will use later.
 * ------------------------------------------------------------------------ */

export async function redeemCode(code) {
  const { data, error } = await supabase.rpc('redeem_premium_code',
    { p_code: String(code || '').trim() });
  if (error) throw error;
  return data;
}

/** The signed-in user's most recent request, or null. */
export async function myRequest() {
  const { data, error } = await supabase.rpc('my_premium_request');
  return error ? null : data;
}
