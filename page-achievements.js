/** Achievements grid with progress bars for the locked ones. */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $, $$ } from './core-dom.js';
import { pct, relativeTime, num } from './core-format.js';
import { getAchievements } from './svc-progress.js';

await mountShell();
if (!await requireAuth()) throw new Error('redirecting');

const ICONS = {
  footprints: '👣', flame: '🔥', hundred: '💯', target: '🎯', trophy: '🏆',
  eye: '👁', crosshair: '◎', calendar: '📅', 'calendar-check': '🗓',
  'calendar-heart': '💝', crown: '👑', badge: '🎖', layers: '📚',
  'shield-star': '🛡', sparkle: '✨', gem: '💎', sun: '☀️', sunrise: '🌅',
  clock: '⏰', hourglass: '⏳', 'chevrons-up': '⏫', rocket: '🚀', star: '⭐'
};

const achievements = await getAchievements();
const unlocked = achievements.filter((a) => a.unlocked);
const totalXp = unlocked.reduce((sum, a) => sum + a.xp_reward, 0);

$('#achievement-summary').textContent =
  `${unlocked.length} of ${achievements.length} unlocked · ${num(totalXp)} XP earned from badges`;

let filter = 'all';
$$('[data-filter]').forEach((chip) => chip.addEventListener('click', () => {
  filter = chip.dataset.filter;
  $$('[data-filter]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
  draw();
}));

function draw() {
  const rows = achievements.filter((a) =>
    filter === 'all' ? true : filter === 'unlocked' ? a.unlocked : !a.unlocked);

  if (!rows.length) {
    render($('#achievement-grid'), h('div.empty', {},
      h('p.empty__title', {}, 'Nothing here yet'),
      h('p', {}, 'Keep practicing and these fill in.')));
    return;
  }

  render($('#achievement-grid'), rows.map((achievement) =>
    h('article.achievement', {
      dataset: { locked: String(!achievement.unlocked), tier: achievement.tier }
    },
      h('div.achievement__icon', { 'aria-hidden': 'true' },
        ICONS[achievement.icon] || ICONS.star),
      h('div', { style: { flex: '1' } },
        h('div.row-between', {},
          h('h2.card__title', {}, achievement.name),
          h('span.badge', {}, `+${achievement.xp_reward} XP`)),
        h('p.text-sm.muted.mt-1', {}, achievement.description),
        achievement.unlocked
          ? h('p.text-xs.mt-3', { style: { color: 'var(--success)' } },
              `Unlocked ${relativeTime(achievement.unlocked_at)}`)
          : h('div.mt-3', {},
              h('div.progress.progress--thin', {
                role: 'progressbar',
                'aria-valuenow': String(Math.round(achievement.progress * 100)),
                'aria-valuemin': '0', 'aria-valuemax': '100',
                'aria-label': `${achievement.name} progress`
              },
                h('div.progress__fill', { style: { width: `${achievement.progress * 100}%` } })),
              h('p.text-xs.subtle.mt-1', {}, `${pct(achievement.progress)} of the way there`))))));
}

draw();
