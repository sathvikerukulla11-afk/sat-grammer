/**
 * Header, nav, avatar menu, mobile drawer, and footer.
 *
 * Rendered from JS so fifteen HTML pages do not each carry a copy of the
 * navigation that has to be edited fifteen times.
 */
import { h, $, render } from './core-dom.js';
import { store } from './core-store.js';
import { initAuth, signOut, isSignedIn, isStaff } from './core-auth.js';
import { CONFIG, pageUrl } from './config.js';
import { initTheme } from './ui-theme.js';
import { toastAchievement } from './ui-toast.js';
import { on, EVENTS } from './core-events.js';
import { initials } from './core-format.js';
import { mountFeedbackButton, openFeedbackDialog } from './ui-feedback-widget.js';

const R = CONFIG.ROUTES;
const path = pageUrl;

const PUBLIC_NAV = [
  { href: R.CHEATSHEETS, label: 'Cheat Sheets' },
  { href: R.RULES, label: 'Grammar Rules' },
  { href: R.LEADERBOARD, label: 'Leaderboard' },
  { href: R.PRICING, label: 'Pricing' }
];

const PRIVATE_NAV = [
  { href: R.DASHBOARD, label: 'Dashboard' },
  { href: R.PRACTICE, label: 'Practice' },
  { href: R.CHEATSHEETS, label: 'Cheat Sheets' },
  { href: R.RULES, label: 'Rules' },
  { href: R.REVIEW, label: 'Review' },
  { href: R.PROGRESS, label: 'Progress' },
  { href: R.COACH, label: '✨ Coach' },
  { href: R.LEADERBOARD, label: 'Leaderboard' }
];

const currentPage = () => location.pathname.split('/').pop() || R.HOME;

function navLinks(items) {
  const here = currentPage();
  return items.map((item) =>
    h('a.nav__link', {
      href: path(item.href),
      'aria-current': item.href === here ? 'page' : null
    }, item.label)
  );
}

function accountMenu(profile) {
  const trigger = h('button.avatar', {
    type: 'button',
    id: 'account-trigger',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    'aria-controls': 'account-menu',
    'aria-label': 'Account menu'
  },
    profile?.avatar_url
      ? h('img.avatar', { src: profile.avatar_url, alt: '' })
      : initials(profile?.display_name || profile?.username)
  );

  const menu = h('div.menu#account-menu', { hidden: true, role: 'menu' },
    h('div', { style: { padding: 'var(--space-3)' } },
      h('div', { style: { fontWeight: '600' } }, profile?.display_name || profile?.username || 'Student'),
      h('div.text-xs.subtle', {}, `Level ${store.get('stats')?.level ?? 1}`)
    ),
    h('div.menu__sep'),
    h('a.menu__item', { href: path(R.PROFILE), role: 'menuitem' }, 'Profile'),
    h('a.menu__item', { href: path(R.ACHIEVEMENTS), role: 'menuitem' }, 'Achievements'),
    h('a.menu__item', { href: path(R.SETTINGS), role: 'menuitem' }, 'Settings'),
    isStaff() ? h('a.menu__item', { href: path(R.ADMIN), role: 'menuitem' }, 'Admin panel') : null,
    h('div.menu__sep'),
    h('button.menu__item.menu__item--danger', {
      type: 'button', role: 'menuitem', onclick: () => signOut()
    }, 'Sign out')
  );

  const toggle = (open) => {
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(menu.hidden);
  });
  document.addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });

  return h('div.menu-anchor', {}, trigger, menu);
}

function buildHeader() {
  const signedIn = isSignedIn();
  const profile = store.get('profile');
  const stats = store.get('stats');
  const items = signedIn ? PRIVATE_NAV : PUBLIC_NAV;

  const drawer = h('div.drawer#mobile-drawer', { hidden: true },
    h('nav.nav', { 'aria-label': 'Mobile' }, navLinks(items)),
    h('div.mt-6.stack', {},
      signedIn
        ? h('button.btn.btn-ghost.btn-block', { type: 'button', onclick: () => signOut() }, 'Sign out')
        : [
            h('a.btn.btn-block', { href: path(R.LOGIN) }, 'Sign in'),
            h('a.btn.btn-primary.btn-block', { href: path(R.REGISTER) }, 'Create free account')
          ]
    )
  );

  const toggleBtn = h('button.btn.btn-ghost.btn-icon.nav-toggle', {
    type: 'button',
    'aria-label': 'Toggle navigation',
    'aria-expanded': 'false',
    'aria-controls': 'mobile-drawer',
    onclick() {
      const open = drawer.hidden;
      drawer.hidden = !open;
      this.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('no-scroll', open);
    }
  }, '☰');

  const header = h('header.site-header', {},
    h('div.site-header__inner', {},
      h('a.brand', { href: path(R.HOME) },
        h('span.brand__mark', { 'aria-hidden': 'true' }, 'SG'),
        h('span', {}, CONFIG.SITE_NAME)
      ),
      h('nav.nav', { 'aria-label': 'Primary' }, navLinks(items)),
      h('div.header-actions', {},
        signedIn && stats?.current_streak > 0
          ? h('span.streak-pill.hide-mobile', { 'aria-label': `${stats.current_streak} day streak` },
              '🔥', String(stats.current_streak))
          : null,
        signedIn
          ? accountMenu(profile)
          : [
              h('a.btn.btn-ghost.hide-mobile', { href: path(R.LOGIN) }, 'Sign in'),
              h('a.btn.btn-primary', { href: path(R.REGISTER) }, 'Start free')
            ],
        toggleBtn
      )
    )
  );

  return h('div', {}, header, drawer);
}

function buildFooter() {
  const year = new Date().getFullYear();
  return h('footer.site-footer', {},
    h('div.container', {},
      h('div.site-footer__grid', {},
        h('div', {},
          h('a.brand', { href: path(R.HOME) },
            h('span.brand__mark', { 'aria-hidden': 'true' }, 'SG'),
            h('span', {}, CONFIG.SITE_NAME)),
          h('p.mt-4', { style: { maxWidth: '32ch' } }, CONFIG.SITE_TAGLINE)
        ),
        h('div', {},
          h('h3', {}, 'Practice'),
          h('ul', {},
            h('li', {}, h('a', { href: path(R.PRACTICE) }, 'Practice sets')),
            h('li', {}, h('a', { href: path(R.TIMED) }, 'Timed mode')),
            h('li', {}, h('a', { href: path(R.CHEATSHEETS) }, 'Cheat sheets')),
            h('li', {}, h('a', { href: path(R.PRICING) }, 'Pricing')),
            h('li', {}, h('a', { href: path(R.RULES) }, 'Grammar rules')),
            h('li', {}, h('a', { href: path(R.REVIEW) }, 'Review missed'))
          )
        ),
        h('div', {},
          h('h3', {}, 'Progress'),
          h('ul', {},
            h('li', {}, h('a', { href: path(R.PROGRESS) }, 'Statistics')),
            h('li', {}, h('a', { href: path(R.ACHIEVEMENTS) }, 'Achievements')),
            h('li', {}, h('a', { href: path(R.LEADERBOARD) }, 'Leaderboard'))
          )
        ),
        h('div', {},
          h('h3', {}, 'Account'),
          h('ul', {},
            h('li', {}, h('a', { href: path(R.LOGIN) }, 'Sign in')),
            h('li', {}, h('a', { href: path(R.REGISTER) }, 'Create account')),
            h('li', {}, h('a', { href: path(R.SETTINGS) }, 'Settings')),
            h('li', {}, h('a', {
              href: '#feedback',
              onclick(event) { event.preventDefault(); openFeedbackDialog(); }
            }, 'Send feedback'))
          )
        )
      ),
      h('div.site-footer__legal', {},
        h('p', {}, `© ${year} ${CONFIG.SITE_NAME}. Every question on this site is original work, `,
          'written for this project. '),
        h('p.mt-2', {},
          'SAT is a registered trademark of the College Board, which is not affiliated with ',
          'and does not endorse this site. No official test material is reproduced here.')
      )
    )
  );
}

/**
 * Boot a page: theme, auth, header, footer, global listeners.
 * Every page controller calls this first.
 */
export async function mountShell({ skipAuth = false } = {}) {
  initTheme();
  if (!skipAuth) await initAuth();

  const headerSlot = $('#site-header');
  const footerSlot = $('#site-footer');
  if (headerSlot) render(headerSlot, buildHeader());
  if (footerSlot) render(footerSlot, buildFooter());

  // Re-render the header when auth or stats change (streak counter, avatar).
  store.subscribe((_state, changed) => {
    if (!headerSlot) return;
    if (changed.some((k) => ['session', 'profile', 'stats'].includes(k))) {
      render(headerSlot, buildHeader());
    }
  });

  const header = $('.site-header');
  if (header) {
    const onScroll = () => { header.dataset.scrolled = String(window.scrollY > 4); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  on(EVENTS.ACHIEVEMENT_UNLOCKED, toastAchievement);

  mountFeedbackButton();
}
