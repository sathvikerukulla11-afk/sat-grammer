/** Leaderboard, ranked by XP earned in the selected period. */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $, $$ } from './core-dom.js';
import { num, pct, initials, ordinal } from './core-format.js';
import { getLeaderboard, getMyRank } from './svc-progress.js';
import { store } from './core-store.js';

await mountShell();
if (!await requireAuth()) throw new Error('redirecting');

let period = new URLSearchParams(location.search).get('period') || 'weekly';

$$('#period-picker .btn').forEach((button) => {
  button.setAttribute('aria-pressed', String(button.dataset.period === period));
  button.addEventListener('click', () => {
    period = button.dataset.period;
    $$('#period-picker .btn').forEach((b) =>
      b.setAttribute('aria-pressed', String(b === button)));
    draw();
  });
});

async function draw() {
  render($('#leaderboard-list'), h('div.skeleton.skeleton-text', { style: { height: '160px' } }));

  const [rows, mine] = await Promise.all([getLeaderboard(period), getMyRank(period)]);
  const myId = store.get('user')?.id;

  if (!rows.length) {
    render($('#leaderboard-list'), h('div.empty', {},
      h('p.empty__title', {}, 'The board is empty for this period'),
      h('p', {}, 'Answer ten questions to be ranked.'),
      h('a.btn.btn-primary.mt-4', { href: 'practice.html' }, 'Start practicing')));
    return;
  }

  const inList = rows.some((row) => row.user_id === myId);

  render($('#leaderboard-list'),
    rows.map((row) => leaderRow(row, row.user_id === myId)),
    !inList && mine ? leaderRow(mine, true) : null,
    !inList && !mine
      ? h('p.text-sm.muted.mt-4.text-center', {},
          'You are not ranked in this period yet — ten questions gets you on the board.')
      : null);
}

function leaderRow(row, isMe) {
  return h('div.leader-row', {
    dataset: { rank: String(row.rank), me: String(isMe) }
  },
    h('span.leader-rank', {}, row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : ordinal(row.rank)),
    row.avatar_url
      ? h('img.avatar', { src: row.avatar_url, alt: '', loading: 'lazy' })
      : h('span.avatar', { 'aria-hidden': 'true' }, initials(row.display_name)),
    h('div', {},
      h('div', { style: { fontWeight: '500' } }, row.display_name, isMe ? ' (you)' : ''),
      h('div.text-xs.muted', {},
        `Level ${row.level ?? 1} · ${num(row.answered)} answered · ${pct(row.accuracy)} accurate`)),
    h('span.leader-score', {}, `${num(row.score)} XP`));
}

await draw();
