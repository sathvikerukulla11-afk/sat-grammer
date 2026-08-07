/**
 * Runtime configuration.
 *
 * Values come from `env.js`, which is git-ignored and created either by
 * copying `env.example.js` locally or by the deploy workflow from GitHub
 * secrets. If it is missing, the defaults below keep the app importable
 * so `setup.html` can render a useful diagnostic instead of a blank page
 * and a stack trace.
 */

const DEFAULTS = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  BASE_PATH: ''
};

let env = DEFAULTS;
let envSource = 'missing';

try {
  // Dynamic import so a missing env.js is a recoverable condition rather
  // than a module-resolution failure that takes the whole page down.
  const module = await import('./env.js');
  env = { ...DEFAULTS, ...(module.default || module) };
  envSource = 'env.js';
} catch {
  // A CI-injected global is the other supported source, for hosts that
  // prefer a <script> tag over a module file.
  if (globalThis.__SATGL_ENV) {
    env = { ...DEFAULTS, ...globalThis.__SATGL_ENV };
    envSource = 'window.__SATGL_ENV';
  }
}

const PLACEHOLDER = /YOUR_PROJECT_REF|YOUR_PUBLISHABLE_ANON_KEY/;

export const ENV_STATUS = Object.freeze({
  source: envSource,
  configured: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY)
              && !PLACEHOLDER.test(env.SUPABASE_URL + env.SUPABASE_ANON_KEY)
});

export const CONFIG = Object.freeze({
  SUPABASE_URL: env.SUPABASE_URL,
  SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
  BASE_PATH: env.BASE_PATH,

  SITE_NAME: 'SAT Grammar Lab',
  SITE_TAGLINE: 'Thousands of original grammar questions. Written here, nowhere else.',

  PRACTICE: Object.freeze({
    DEFAULT_LENGTH: 20,
    LENGTH_OPTIONS: [5, 10, 20, 30, 50],
    TIMED_SECONDS_PER_QUESTION: [30, 45, 60, 90],
    DEFAULT_TIMED_SECONDS: 45,
    AUTOSAVE_INTERVAL_MS: 10000,
    MASTERY_THRESHOLD: 0.85,
    DAILY_GOAL_DEFAULT: 20
  }),

  DIFFICULTIES: Object.freeze(['easy', 'medium', 'hard', 'expert']),

  ROUTES: Object.freeze({
    HOME: 'index.html',
    LOGIN: 'login.html',
    REGISTER: 'register.html',
    DASHBOARD: 'dashboard.html',
    PRACTICE: 'practice.html',
    TIMED: 'timed.html',
    RULES: 'rules.html',
    RULE: 'rule.html',
    REVIEW: 'review.html',
    PROGRESS: 'progress.html',
    ACHIEVEMENTS: 'achievements.html',
    LEADERBOARD: 'leaderboard.html',
    PROFILE: 'profile.html',
    SETTINGS: 'settings.html',
    ADMIN: 'admin.html',
    SETUP: 'setup.html'
  }),

  PROTECTED: Object.freeze([
    'dashboard.html', 'practice.html', 'timed.html', 'review.html',
    'progress.html', 'achievements.html', 'leaderboard.html',
    'profile.html', 'settings.html', 'admin.html'
  ]),

  STAFF_ONLY: Object.freeze(['admin.html'])
});

export default CONFIG;
