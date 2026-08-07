/**
 * Environment template.
 *
 * Copy this file to `env.js` and fill in your project's values:
 *
 *     cp env.example.js env.js
 *
 * `env.js` is git-ignored. In CI, the deploy workflow writes it from
 * GitHub repository secrets, so the values never live in the repository.
 *
 * ---------------------------------------------------------------------
 * A note on what is and is not secret
 * ---------------------------------------------------------------------
 * The publishable ("anon") key is NOT a secret. It is a public identifier
 * that every visitor's browser receives; it grants nothing on its own.
 * What protects your data is Row Level Security and the SECURITY DEFINER
 * functions in supabase/migrations/.
 *
 * The key that IS a secret is the service_role key. It bypasses RLS
 * entirely. It belongs only in edge function environment variables and
 * must never appear in this file, anywhere in the deploy folder, or anywhere
 * else in this repository.
 *
 * Keys are kept here anyway because rotating a project, pointing a fork
 * at a different backend, or running a staging environment should not
 * require editing tracked source.
 */
export default {
  SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_PUBLISHABLE_ANON_KEY',

  // '' for a custom domain or user site; '/repo-name' for a project site.
  BASE_PATH: ''
};
