import { api } from '../api.js';
import { el, avatar, field, toast, fmtDate } from '../ui.js';
import { state } from '../store.js';

export async function renderSettings({ content, topbar }) {
  topbar.replaceChildren(el('h1', {}, '设置'), el('span', { class: 'spacer' }));
  const u = state.user;
  const cur = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const next = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const again = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });

  content.replaceChildren(
    el('div', { class: 'grid-2' },
      el('div', { style: 'display:flex;flex-direction:column;gap:16px' },
        el('div', { class: 'card' },
          el('div', { class: 'card-head' }, '账号信息'),
          el('div', { class: 'card-body' },
            el('div', { style: 'display:flex;align-items:center;gap:12px' },
              avatar(u, 'lg'),
              el('div', {},
                el('div', { style: 'font-size:15px;font-weight:600' }, u.name),
                el('div', { style: 'font-size:12.5px;color:#8f959e' }, u.email),
              ),
            ),
            el('div', { class: 'meta-grid', style: 'margin-top:14px;border-bottom:none' },
              el('span', { class: 'k' }, '全局角色'),
              el('div', { class: 'v' }, el('span', { class: 'tag soft-blue' }, u.roleName)),
              el('span', { class: 'k' }, '权限项'),
              el('div', { class: 'v' }, u.permissions.includes('*') ? '全部权限' : `${u.permissions.length} 项`),
              el('span', { class: 'k' }, '加入时间'),
              el('div', { class: 'v' }, fmtDate(u.createdAt)),
            ),
          ),
        ),
        el('div', { class: 'card' },
          el('div', { class: 'card-head' }, '修改密码'),
          el('div', { class: 'card-body' },
            field('当前密码', cur),
            field('新密码', next, '至少 8 位'),
            field('确认新密码', again),
            el('button', { class: 'btn primary', onclick: async () => {
              if (next.value !== again.value) return toast('两次输入的新密码不一致', 'err');
              try {
                await api.post('/api/auth/password', { currentPassword: cur.value, newPassword: next.value });
                toast('密码已更新');
                cur.value = next.value = again.value = '';
              } catch (err) { toast(err.message, 'err'); }
            } }, '更新密码'),
          ),
        ),
      ),
      el('div', { style: 'display:flex;flex-direction:column;gap:16px' },
        el('div', { class: 'card' },
          el('div', { class: 'card-head' }, '我的权限'),
          el('div', { class: 'card-body' },
            el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
              ...(u.permissions.includes('*')
                ? [el('span', { class: 'tag soft-blue' }, '全部权限')]
                : u.permissions.map((p) => el('span', { class: 'tag' }, p))),
            ),
            el('p', { style: 'font-size:12px;color:#8f959e;margin:12px 0 0;line-height:1.7' },
              '这是平台级权限。进入具体空间后，还会叠加空间成员角色（负责人 / 可编辑 / 只读）。'),
          ),
        ),
        el('div', { class: 'card' },
          el('div', { class: 'card-head' }, '会话'),
          el('div', { class: 'card-body' },
            el('p', { style: 'font-size:12.5px;color:#646a73;margin:0 0 12px;line-height:1.7' },
              '退出后需要重新登录；本地演示数据保存在工作区的 data/db.json。'),
            el('button', { class: 'btn danger', onclick: () => window.dispatchEvent(new Event('nova:logout')) }, '退出登录'),
          ),
        ),
      ),
    ),
  );
}
