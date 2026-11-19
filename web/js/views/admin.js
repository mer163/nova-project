import { api } from '../api.js';
import { el, avatar, field, modal, select, toast, confirmDialog, loading, fmtDate, fmtDateTime } from '../ui.js';
import { state } from '../store.js';

const PERM_LABELS = {
  'issue:read': '查看工单',
  'issue:create': '创建工单',
  'issue:update': '编辑工单',
  'issue:delete': '删除 / 取消工单',
  'issue:transition': '推进状态',
  'issue:comment': '评论',
  'issue:assign': '指派负责人',
  'space:read': '查看空间',
  'space:create': '创建空间',
  'space:manage': '管理空间成员',
  'member:manage': '管理成员',
  'role:manage': '管理角色权限',
  'workflow:manage': '配置工作流',
  'audit:read': '查看审计日志',
};

let tab = 'members';

export async function renderAdmin({ content, topbar, navigate }) {
  if (!state.user.permissions.includes('*') && !state.user.permissions.includes('member:manage')) {
    topbar.replaceChildren(el('h1', {}, '成员与权限'));
    content.replaceChildren(el('div', { class: 'empty' },
      el('strong', {}, '没有访问权限'),
      `当前角色「${state.user.roleName}」不能管理成员与角色，请联系管理员。`,
    ));
    return;
  }
  topbar.replaceChildren(el('h1', {}, '成员与权限'), el('span', { class: 'spacer' }));

  const tabs = el('div', { class: 'tabs' },
    ...[['members', '成员'], ['roles', '角色权限'], ['workflow', '工作流'], ['audit', '审计日志']].map(([id, label]) =>
      el('button', { class: `tab${tab === id ? ' active' : ''}`, onclick: () => { tab = id; renderAdmin({ content, topbar, navigate }); } }, label)),
  );
  content.className = 'content tight';
  const panel = el('div', { style: 'padding:20px' });
  content.replaceChildren(tabs, panel);
  panel.replaceChildren(loading(5));

  if (tab === 'members') await renderMembers(panel, navigate);
  else if (tab === 'roles') await renderRoles(panel);
  else if (tab === 'workflow') await renderWorkflows(panel);
  else await renderAudit(panel);
}

async function renderMembers(panel, navigate) {
  const { items, roles } = await api.get('/api/users');
  const canManage = state.user.permissions.includes('*') || state.user.permissions.includes('member:manage');
  const head = el('div', { style: 'display:flex;align-items:center;margin-bottom:14px' },
    el('div', { style: 'font-size:13px;color:#646a73' }, `共 ${items.length} 位成员`),
    el('span', { style: 'flex:1' }),
    el('button', { class: 'btn primary', onclick: () => openCreateUser(panel, roles, navigate) }, '+ 添加成员'),
  );

  const rows = items.map((u) => el('tr', {},
    el('td', {}, el('div', { style: 'display:flex;align-items:center;gap:9px' }, avatar(u), el('div', { style: 'font-size:13px' }, u.name))),
    el('td', { style: 'color:#646a73' }, u.email),
    el('td', {},
      el('select', {
        class: 'select', style: 'width:140px;height:30px', disabled: !canManage,
        onchange: async (e) => {
          try { await api.patch(`/api/users/${u.id}`, { roleId: e.target.value }); toast(`${u.name} 的角色已更新`); }
          catch (err) { toast(err.message, 'err'); renderMembers(panel, navigate); }
        },
      }, ...roles.map((r) => {
        const o = el('option', { value: r.id }, r.name);
        if (r.id === u.roleId) o.selected = true;
        return o;
      })),
    ),
    el('td', { style: 'color:#8f959e;font-size:12px' }, fmtDate(u.createdAt)),
    el('td', {},
      canManage && u.id !== state.user.id
        ? el('button', { class: 'btn ghost sm danger', onclick: async () => {
          if (!(await confirmDialog('移除成员', `确认移除 ${u.name}？其名下工单会保留但不再指派给活跃成员。`, '移除'))) return;
          try { await api.del(`/api/users/${u.id}`); toast('成员已移除'); renderMembers(panel, navigate); }
          catch (err) { toast(err.message, 'err'); }
        } }, '移除')
        : null,
    ),
  ));

  panel.replaceChildren(
    head,
    el('div', { class: 'card', style: 'overflow:hidden' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, ...['成员', '邮箱', '角色', '加入时间', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...rows),
      ),
    ),
    el('p', { style: 'font-size:12px;color:#8f959e;margin-top:12px' },
      '全局角色决定平台能力（能做什么），空间成员角色决定空间内权限（在哪个空间能做）。两者取交集生效。'),
  );
}

function openCreateUser(panel, roles, navigate) {
  const name = el('input', { class: 'input', placeholder: '成员姓名' });
  const email = el('input', { class: 'input', placeholder: 'name@company.com' });
  const pw = el('input', { class: 'input', placeholder: '至少 8 位' });
  const role = select(roles.map((r) => ({ value: r.id, label: r.name })), 'dev');
  const m = modal({
    title: '添加成员',
    body: el('div', {}, field('姓名', name), field('邮箱', email), field('初始密码', pw), field('角色', role)),
    footer: [
      el('button', { class: 'btn', onclick: () => m.close() }, '取消'),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          await api.post('/api/users', { name: name.value.trim(), email: email.value.trim(), password: pw.value, roleId: role.value });
          toast('成员已添加');
          m.close();
          renderMembers(panel, navigate);
        } catch (err) { toast(err.message, 'err'); }
      } }, '添加'),
    ],
  });
}

async function renderRoles(panel) {
  const { items, permissions } = await api.get('/api/roles');
  const canManage = state.user.permissions.includes('*') || state.user.permissions.includes('role:manage');

  const cards = items.map((r) => el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      r.name,
      r.builtin ? el('span', { class: 'tag' }, '内置') : el('span', { class: 'tag soft-blue' }, '自定义'),
      el('span', { style: 'flex:1' }),
      el('span', { style: 'font-size:12px;font-weight:400;color:#8f959e' }, `${r.permissions.includes('*') ? '全部' : r.permissions.length} 项权限`),
    ),
    el('div', { class: 'card-body' },
      el('p', { style: 'margin:0 0 12px;font-size:12.5px;color:#646a73' }, r.description || '暂无描述'),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
        ...(r.permissions.includes('*')
          ? [el('span', { class: 'tag soft-blue' }, '全部权限')]
          : r.permissions.slice(0, 8).map((p) => el('span', { class: 'tag' }, PERM_LABELS[p] ?? p))),
        r.permissions.length > 8 && !r.permissions.includes('*')
          ? el('span', { class: 'tag' }, `+${r.permissions.length - 8}`) : null,
      ),
      canManage
        ? el('div', { style: 'margin-top:14px;display:flex;gap:8px' },
          el('button', { class: 'btn sm', onclick: () => openRoleEditor(r, permissions, panel) }, '编辑权限'),
          !r.builtin ? el('button', { class: 'btn sm danger', onclick: async () => {
            if (!(await confirmDialog('删除角色', `确认删除角色「${r.name}」？仍在使用中的角色无法删除。`, '删除'))) return;
            try { await api.del(`/api/roles/${r.id}`); toast('角色已删除'); renderRoles(panel); }
            catch (err) { toast(err.message, 'err'); }
          } }, '删除') : null,
        )
        : null,
    ),
  ));

  panel.replaceChildren(
    el('div', { style: 'display:flex;align-items:center;margin-bottom:14px' },
      el('div', { style: 'font-size:13px;color:#646a73' }, '角色决定平台级能力，修改后立即对在线成员生效。'),
      el('span', { style: 'flex:1' }),
      canManage ? el('button', { class: 'btn primary', onclick: () => openRoleEditor(null, permissions, panel) }, '+ 新建角色') : null,
    ),
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px' }, ...cards),
  );
}

function openRoleEditor(role, permissions, panel) {
  const name = el('input', { class: 'input', value: role?.name ?? '', placeholder: '角色名称' });
  const desc = el('input', { class: 'input', value: role?.description ?? '', placeholder: '一句话说明职责' });
  const selected = new Set(role?.permissions ?? []);
  const grid = el('div', { class: 'perm-grid' });
  for (const p of permissions) {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = selected.has(p);
    const item = el('label', { class: `perm${cb.checked ? ' on' : ''}` }, cb, PERM_LABELS[p] ?? p);
    cb.addEventListener('change', () => {
      item.classList.toggle('on', cb.checked);
      if (cb.checked) selected.add(p); else selected.delete(p);
    });
    grid.append(item);
  }
  const m = modal({
    title: role ? `编辑角色 · ${role.name}` : '新建角色',
    wide: true,
    body: el('div', {},
      el('div', { class: 'row' }, field('名称', name), field('描述', desc)),
      field('权限', grid),
      el('p', { style: 'font-size:12px;color:#8f959e;margin:0' },
        '空间内读写权限由空间成员角色单独控制；这里的权限是平台级能力。'),
    ),
    footer: [
      el('button', { class: 'btn', onclick: () => m.close() }, '取消'),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          const payload = { name: name.value.trim(), description: desc.value, permissions: [...selected] };
          if (role) await api.put(`/api/roles/${role.id}`, payload);
          else await api.post('/api/roles', payload);
          toast('角色已保存');
          m.close();
          renderRoles(panel);
        } catch (err) { toast(err.message, 'err'); }
      } }, '保存'),
    ],
  });
}

async function renderWorkflows(panel) {
  const { items } = await api.get('/api/workflows');
  const canManage = state.user.permissions.includes('*') || state.user.permissions.includes('workflow:manage');
  const cards = items.map((w) => el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      w.name,
      el('span', { class: 'tag' }, `${w.states.length} 个状态 · ${w.transitions.length} 条流转`),
      el('span', { style: 'flex:1' }),
      canManage ? el('button', { class: 'btn sm', onclick: () => openWorkflowEditor(w, panel) }, '编辑') : null,
    ),
    el('div', { class: 'card-body' },
      el('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px' },
        ...w.states.flatMap((s, idx) => {
          const chip = el('span', { class: 'tag dot', style: `color:${s.color};background:${s.color}14` }, s.name);
          return idx < w.states.length - 1 ? [chip, el('span', { style: 'color:#c9cdd4;font-size:12px' }, '→')] : [chip];
        }),
      ),
      el('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        ...w.transitions.map((t) => {
          const from = w.states.find((s) => s.id === t.from)?.name ?? t.from;
          const to = w.states.find((s) => s.id === t.to)?.name ?? t.to;
          return el('div', { style: 'font-size:12.5px;color:#646a73;display:flex;gap:8px' },
            el('span', { style: 'color:#8f959e' }, `${from} → ${to}`),
            el('span', {}, t.name),
            el('span', { style: 'margin-left:auto;color:#c9cdd4;font-size:11.5px' }, t.permission),
          );
        }),
      ),
    ),
  ));
  panel.replaceChildren(el('div', { style: 'display:flex;flex-direction:column;gap:14px' }, ...cards));
}

function openWorkflowEditor(w, panel) {
  const statesBox = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const draft = w.states.map((s) => ({ ...s }));
  const transitions = w.transitions.map((t) => ({ ...t }));

  const redraw = () => {
    statesBox.replaceChildren(...draft.map((s) => {
      const name = el('input', { class: 'input', value: s.name, style: 'height:30px' });
      name.addEventListener('input', () => { s.name = name.value; });
      const color = el('input', { type: 'color', value: s.color, style: 'width:34px;height:30px;border:1px solid #dee0e3;border-radius:6px;background:#fff' });
      color.addEventListener('input', () => { s.color = color.value; });
      const closing = el('select', { class: 'select', style: 'width:96px;height:30px' },
        el('option', { value: 'open' }, '进行中'),
        el('option', { value: 'closed' }, '已结束'),
      );
      closing.value = s.type;
      closing.addEventListener('change', () => { s.type = closing.value; });
      return el('div', { style: 'display:flex;gap:8px;align-items:center' },
        name, color, closing,
        el('button', { class: 'btn ghost sm danger', onclick: () => {
          if (draft.length <= 2) return toast('至少保留两个状态', 'err');
          draft.splice(draft.indexOf(s), 1);
          redraw();
        } }, '删除'),
      );
    }));
  };
  redraw();

  const transBox = el('div', { style: 'display:flex;flex-direction:column;gap:8px' },
    ...transitions.map((t) => {
      const fromSel = select(draft.map((s) => ({ value: s.id, label: s.name })), t.from);
      const toSel = select(draft.map((s) => ({ value: s.id, label: s.name })), t.to);
      fromSel.addEventListener('change', () => { t.from = fromSel.value; });
      toSel.addEventListener('change', () => { t.to = toSel.value; });
      return el('div', { style: 'display:flex;gap:8px;align-items:center' }, fromSel, '→', toSel);
    }),
  );

  const m = modal({
    title: `编辑工作流 · ${w.name}`,
    wide: true,
    body: el('div', {},
      field('状态', statesBox, '删除状态前请先迁移使用该状态的工单'),
      el('div', { style: 'margin-top:6px' },
        el('div', { style: 'display:flex;align-items:center;margin-bottom:8px' },
          el('span', { style: 'font-size:13px;color:#646a73;font-weight:500' }, '流转规则'),
          el('span', { style: 'flex:1' }),
          el('button', { class: 'btn sm', onclick: () => { transitions.push({ from: draft[0].id, to: draft[1].id, name: '流转', permission: 'issue:transition' }); m.close(); openWorkflowEditor({ ...w, states: draft, transitions }, panel); } }, '+ 新增流转'),
        ),
        transBox,
      ),
    ),
    footer: [
      el('button', { class: 'btn', onclick: () => m.close() }, '取消'),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          await api.patch(`/api/workflows/${w.id}`, { states: draft, transitions });
          toast('工作流已保存');
          m.close();
          renderWorkflows(panel);
        } catch (err) { toast(err.message, 'err'); }
      } }, '保存'),
    ],
  });
}

async function renderAudit(panel) {
  const { items } = await api.get('/api/audit?limit=60');
  panel.replaceChildren(el('div', { class: 'card', style: 'overflow:hidden' },
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, ...['时间', '操作人', '动作', '对象', '详情'].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...items.map((a) => el('tr', {},
        el('td', { style: 'color:#8f959e;font-size:12px;white-space:nowrap' }, fmtDateTime(a.at)),
        el('td', {}, a.actorName),
        el('td', {}, el('span', { class: 'tag' }, a.action)),
        el('td', { style: 'color:#646a73;font-size:12px' }, a.target),
        el('td', { style: 'color:#646a73' }, a.detail),
      ))),
    ),
  ));
}
