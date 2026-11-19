import { api } from '../api.js';
import { el, fmtTime, toast, loading } from '../ui.js';
import { state } from '../store.js';

const TYPE_ICON = {
  'issue.transition': '⇄',
  'issue.assigned': '◉',
  'issue.comment': '✎',
};

export async function renderNotifications({ content, topbar, navigate }) {
  topbar.replaceChildren(
    el('h1', {}, '通知'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: async () => {
      try {
        const res = await api.post('/api/notifications/read-all');
        toast(`已全部标为已读（${res.count} 条）`);
        refreshBadge();
        renderNotifications({ content, topbar, navigate });
      } catch (err) { toast(err.message, 'err'); }
    } }, '全部标为已读'),
  );
  content.replaceChildren(loading(3));

  const { items, unread } = await api.get('/api/notifications');
  if (!items.length) {
    content.replaceChildren(el('div', { class: 'empty' },
      el('strong', {}, '没有新通知'),
      '被指派、状态变更或有新评论时会出现在这里。',
    ));
    return;
  }

  content.replaceChildren(
    el('div', { style: 'font-size:13px;color:#646a73;margin-bottom:12px' },
      unread ? `${unread} 条未读` : '全部已读'),
    el('div', { class: 'card', style: 'overflow:hidden' },
      el('div', {},
        ...items.map((n) => el('div', {
          style: `display:flex;gap:12px;padding:13px 16px;border-bottom:1px solid #f0f1f2;cursor:pointer;${n.read ? '' : 'background:#f7faff'}`,
          onclick: async () => {
            try { await api.post(`/api/notifications/${n.id}/read`); } catch { /* 忽略 */ }
            refreshBadge();
            if (n.issueId) navigate(`/issues?open=${n.issueId}`);
          },
        },
          el('div', {
            style: 'width:26px;height:26px;flex:0 0 26px;border-radius:50%;display:grid;place-items:center;font-size:13px;background:#eef3ff;color:#3370ff',
          }, TYPE_ICON[n.type] ?? '•'),
          el('div', { style: 'flex:1;min-width:0' },
            el('div', { style: 'display:flex;gap:8px;align-items:baseline' },
              el('span', { style: 'font-size:13px;font-weight:500' }, n.title),
              !n.read ? el('span', { style: 'width:6px;height:6px;border-radius:50%;background:#f54a45' }) : null,
              el('span', { style: 'margin-left:auto;font-size:11.5px;color:#8f959e' }, fmtTime(n.createdAt)),
            ),
            el('div', { style: 'font-size:12.5px;color:#646a73;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, n.body),
          ),
        )),
      ),
    ),
  );
}

export async function refreshBadge() {
  try {
    const { unread } = await api.get('/api/notifications?unread=1');
    state.unreadCount = unread;
    const badge = document.querySelector('[data-nav-badge="notifications"]');
    if (!badge) return;
    badge.textContent = unread ? String(unread) : '';
    badge.style.display = unread ? '' : 'none';
  } catch { /* 忽略 */ }
}
