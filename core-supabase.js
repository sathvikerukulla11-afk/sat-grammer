/**
 * Supabase client singleton.
 *
 * The SDK loads from a CDN as an ES module, so the project stays
 * build-step-free — no bundler, no Node, no package.json.
 *
 * If the environment is not configured, we still export a client rather
 * than throwing at import time. Every call will fail, but it fails with a
 * clear network error at the call site instead of taking down every page
 * that merely imports this module. `setup.html` reports the real problem.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG, ENV_STATUS } from './config.js';

if (!ENV_STATUS.configured) {
  console.warn(
    '[SAT Grammar Lab] Supabase is not configured.\n' +
    'Copy env.example.js to env.js and fill in your ' +
    'project URL and publishable key, then open setup.html to verify.'
  );
}

export const supabase = createClient(
  CONFIG.SUPABASE_URL || 'https://unconfigured.supabase.co',
  CONFIG.SUPABASE_ANON_KEY || 'unconfigured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'satgl.auth',
      flowType: 'pkce'
    },
    global: { headers: { 'x-client-info': 'sat-grammar-lab/1.0' } },
    db: { schema: 'public' }
  }
);

export { ENV_STATUS };
export default supabase;
