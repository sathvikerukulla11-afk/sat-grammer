/**
 * LOCAL ENVIRONMENT — git-ignored.
 *
 * Wired to the "sat-grammar-lab" Supabase project.
 *
 * The publishable key below is NOT a secret. It is a public identifier
 * every visitor's browser receives, and it grants nothing on its own —
 * Row Level Security and the SECURITY DEFINER functions are what protect
 * the data. The key that IS secret is the service_role key, which must
 * never appear in this file or anywhere else in this repository.
 */
export default {
  SUPABASE_URL: 'https://jlvwceilyezpcrocvlrw.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_E5Kl7mEqMKrA9m7Vyn4vbA_GYQDE29Z',

  // '' for a custom domain or a user site; '/repo-name' for a GitHub
  // Pages project site.
  BASE_PATH: ''
};
