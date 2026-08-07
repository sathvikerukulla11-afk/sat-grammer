/** Leaderboard, ranked by XP earned in the selected period. */
import { mountShell } from './ui-shell.js';
import { requireAuth } from './core-auth.js';
import { h, render, $, $$ } from './core-dom.js';
import { num, pct, initials, ordinal } from './core-format.js';
import { getLeaderboard } from './svc-progress.js';
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

  let board;
  try {
    board = await getLeaderboard(period);
  } catch (err) {
    render($('#leaderboard-list'), h('p.muted', {}, err.message));
    return;
  }

  const { rows, me, why_not_ranked: why, my_answers_this_period: mine } = board;

  if (!rows.length) {
    render($('#leaderboard-list'), h('div.empty', {},
      h('p.empty__title', {}, 'Nobody is ranked for this period yet'),
      h('p', {}, 'Ten answered questions puts you on the board.'),
      h('a.btn.btn-primary.mt-4', { href: 'practice.html' }, 'Start practicing')));
    return;
  }

  // Say WHY someone is missing rather than showing them a list they are
  // not in and leaving them to guess.
  const explain = () => {
    if (!why) return null;
    if (why === 'hidden') {
      return h('div.alert.alert-info.mt-4', {}, h('div', {},
        h('strong', {}, 'You are hidden from the leaderboard. '),
        'Turn it back on in ', h('a', { href: 'settings.html' }, 'settings'), '.'));
    }
    if (why.startsWith('needs_')) {
      const n = why.slice(6);
      return h('div.alert.alert-info.mt-4', {}, h('div', {},
        `You have answered ${mine} question${mine === 1 ? '' : 's'} this period. `,
        h('strong', {}, `${n} more and you are on the board.`)));
    }
    return h('div.alert.alert-info.mt-4', {}, h('div', {},
      'You qualify for this board — the standings refresh every few minutes.'));
  };

  render($('#leaderboard-list'),
    rows.map((row) => leaderRow(row, row.is_me)),
    // Pin the student's own row underneath when they fall off the page.
    me && !rows.some((r) => r.is_me) ? leaderRow(me, true) : null,
    explain());
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
