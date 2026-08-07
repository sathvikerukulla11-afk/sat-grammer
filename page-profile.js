/** Read-only view of your own profile. */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $ } from './core-dom.js';
import { num, pct, duration, dateLong, initials, relativeTime } from './core-format.js';
import { getStats, getAchievements } from './svc-progress.js';

await mountShell();
const profile = await requireAuth();
if (!profile) throw new Error('redirecting');

const stats = await getStats({ force: true });

render($('#profile-avatar'),
  profile.avatar_url
    ? h('img.avatar.avatar-lg', { src: profile.avatar_url, alt: '' })
    : h('span.avatar.avatar-lg', { 'aria-hidden': 'true' },
        initials(profile.display_name || profile.username)));

$('#profile-name').textContent = profile.display_name || profile.username;
$('#profile-username').textContent = `@${profile.username} · joined ${dateLong(profile.created_at)}`;
$('#profile-bio').textContent = profile.bio || '';

render($('#profile-badges'), [
  h('span.badge.badge-brand', {}, `Level ${stats?.level ?? 1}`),
  stats?.current_streak ? h('span.badge.badge-warning', {}, `🔥 ${stats.current_streak} day streak`) : null,
  profile.is_public ? h('span.badge', {}, 'On the leaderboard') : h('span.badge', {}, 'Private')
]);

render($('#profile-stats'), [
  ['Questions answered', num(stats?.total_answered ?? 0)],
  ['Accuracy', stats?.total_answered ? pct(stats.accuracy) : '—'],
  ['XP', num(stats?.xp ?? 0)],
  ['Study time', duration(stats?.total_time_ms ?? 0, 'long')]
].map(([label, value]) =>
  h('div.stat', {}, h('span.stat__label', {}, label), h('span.stat__value', {}, value))));

/* ---- recent achievements ------------------------------------------------ */
const achievements = await getAchievements();
const recent = achievements
  .filter((a) => a.unlocked)
  .sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at))
  .slice(0, 5);

render($('#profile-achievements'),
  recent.length
    ? h('div.stack-sm', {}, recent.map((achievement) =>
        h('div.row', {},
          h('span', { 'aria-hidden': 'true' }, '🏅'),
          h('div', {},
            h('div', { style: { fontWeight: '500' } }, achievement.name),
            h('div.text-xs.muted', {}, relativeTime(achievement.unlocked_at))))))
    : h('p.muted', {}, 'No badges yet — the first one comes with your first question.'));

/* ---- goal --------------------------------------------------------------- */
const goal = profile.preferences?.daily_goal ?? 20;
const done = stats?.questions_today ?? 0;
const ratio = Math.min(1, done / goal);

render($('#profile-goal'),
  h('div.stack', {},
    h('div.row-between', {},
      h('span.muted', {}, 'Today'),
      h('strong.tabular', {}, `${done} / ${goal}`)),
    h('div.progress', {
      role: 'progressbar', 'aria-valuenow': String(done),
      'aria-valuemin': '0', 'aria-valuemax': String(goal), 'aria-label': 'Daily goal'
    },
      h('div.progress__fill', {
        style: { width: `${ratio * 100}%` },
        dataset: { tone: ratio >= 1 ? 'success' : null }
      })),
    profile.target_score
      ? h('p.text-sm.muted', {}, `Target Writing score: ${profile.target_score}` +
          (profile.test_date ? ` · test on ${dateLong(profile.test_date)}` : ''))
      : h('p.text-sm.muted', {}, h('a', { href: 'settings.html' }, 'Set a target score'),
          ' to see how far you have to go.')));
