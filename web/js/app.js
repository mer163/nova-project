import { api } from './api.js';
import { el, avatar, toast } from './ui.js';
import { state } from './store.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderIssues } from './views/issues.js';
import { renderSpaces } from './views/spaces.js';
import { renderAdmin } from './views/admin.js';
import { renderSettings } from './views/settings.js';
import { renderIterations } from './views/iterations.js';
import { renderNotifications, refreshBadge } from './views/notifications.js';

const NAV = [
  { id: 'dashboard', label: '工作台', icon: '◎' },
  { id: 'issues', label: '需求与缺陷', icon: '▤' },
  { id: 'iterations', label: '迭代', icon: '⧉' },
  { id: 'notifications', label: '通知', icon: '✉', badge: true },
  { id: 'spaces', label: '空间', icon: '⌸' },
  { id: 'admin', label: '成员与权限', icon: '⛨' },
  { id: 'settings', label: '设置', icon: '⚙' },
];

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(queryPart ?? ''));
  return { name: segs[0] || 'dashboard', rest: segs.slice(1), params };
}

export function navigate(path) {
  if (location.hash === `#${path}`) render();
  else location.hash = `#${path}`;
}

let root;

function shell() {
  const main = el('div', { class: 'main' });
  const content = el('div', { class: 'content' });
  const sidebar = el('aside', { class: 'sidebar' },
    el('div', { class: 'sidebar-top' },
      el('div', { class: 'brand' },
        el('div', { class: 'brand-mark' }, 'N'),
        el('div', {},
          el('div', { class: 'brand-name' }, 'Nova'),
          el('div', { class: 'brand-sub' }, '需求 · 缺陷 · 权限'),
        ),
      ),
    ),
    nav(),
    el('div', { class: 'side-foot' },
      el('div', { class: 'user-chip', onclick: () => navigate('/settings') },
        avatar(state.user, 'lg'),
        el('div', { class: 'user-meta' },
          el('div', { class: 'user-name' }, state.user?.name ?? ''),
          el('div', { class: 'user-role' }, state.user?.roleName ?? ''),
        ),
      ),
    ),
  );
  root.replaceChildren(el('div', { class: 'app-shell' }, sidebar, main));
  main.replaceChildren(el('div', { class: 'topbar' }), content);
  return { content, topbar: main.firstChild };
}

function nav() {
  const list = el('nav', { class: 'nav' });
  for (const item of NAV) {
    const btn = el('button', {
      class: `nav-item${state.route.name === item.id ? ' active' : ''}`,
      onclick: () => navigate(`/${item.id}`),
    }, el('span', { style: 'width:16px;text-align:center;opacity:.8' }, item.icon), item.label);
    if (item.id === 'issues' && state.issueCount != null) {
      btn.append(el('span', { class: 'count' }, String(state.issueCount)));
    }
    if (item.badge) {
      const badge = el('span', {
        class: 'count', dataset: { navBadge: item.id },
        style: state.unreadCount ? '' : 'display:none',
      }, state.unreadCount ? String(state.unreadCount) : '');
      btn.append(badge);
    }
    list.append(btn);
  }
  return list;
}

const renderers = {
  dashboard: renderDashboard,
  issues: renderIssues,
  iterations: renderIterations,
  notifications: renderNotifications,
  spaces: renderSpaces,
  admin: renderAdmin,
  settings: renderSettings,
};

async function render() {
  if (!state.user) return;
  document.getElementById('modal-root').replaceChildren();
  const route = parseHash();
  state.route = route;
  const views = shell();
  const renderer = renderers[route.name] ?? renderDashboard;
  try {
    await renderer({ content: views.content, topbar: views.topbar, route, navigate });
  } catch (err) {
    if (err.status === 401) return boot();
    views.content.replaceChildren(el('div', { class: 'empty' },
      el('strong', {}, '页面加载失败'),
      err.message,
      el('div', { style: 'margin-top:14px' },
        el('button', { class: 'btn', onclick: () => render() }, '重试'),
      ),
    ));
    toast(err.message, 'err');
  }
}

export function refreshNav() {
  const list = document.querySelector('.nav');
  if (!list) return;
  const active = list.querySelector('.nav-item.active');
  const idx = NAV.findIndex((n) => n.id === state.route.name);
  if (active && idx >= 0) {
    const replacement = nav();
    list.replaceWith(replacement);
  }
}

async function boot() {
  root = document.getElementById('app');
  try {
    const data = await api.get('/api/auth/me');
    state.user = data.user;
    state.meta = await api.get('/api/meta');
    const spaces = await api.get('/api/spaces');
    state.spaces = spaces.items;
    const iterations = await api.get('/api/iterations').catch(() => ({ items: [] }));
    state.iterations = iterations.items;
    await render();
    refreshBadge();
  } catch (err) {
    if (err.status === 401) return renderLogin(root, async () => {
      await boot();
    });
    root.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, '无法连接服务'), err.message));
  }
}

window.addEventListener('hashchange', () => render());
window.addEventListener('nova:refresh-iterations', async () => {
  const iterations = await api.get('/api/iterations').catch(() => ({ items: [] }));
  state.iterations = iterations.items;
  render();
});
window.addEventListener('nova:logout', async () => {
  await api.post('/api/auth/logout', {});
  state.user = null;
  renderLogin(document.getElementById('app'), () => boot());
});

boot();

export { api, state };
