import { api } from '../api.js';
import { el, avatar, field, modal, select, toast, fmtDate, confirmDialog, loading } from '../ui.js';
import { state } from '../store.js';

export async function renderSpaces({ content, topbar, navigate }) {
  topbar.replaceChildren(
    el('h1', {}, '空间'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: () => openCreateSpace(navigate) }, '+ 新建空间'),
  );
  content.replaceChildren(loading(4));
  const { items } = await api.get('/api/spaces');
  state.spaces = items;

  if (!items.length) {
    content.replaceChildren(el('div', { class: 'empty' },
      el('strong', {}, '还没有加入任何空间'),
      '创建第一个空间，把需求和缺陷放进来。',
      el('div', { style: 'margin-top:16px' }, el('button', { class: 'btn primary', onclick: () => openCreateSpace(navigate) }, '新建空间')),
    ));
    return;
  }

  content.replaceChildren(el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px' },
    ...items.map((s) => el('div', { class: 'card', style: 'cursor:pointer', onclick: () => openSpace(s.id) },
      el('div', { class: 'card-body' },
        el('div', { style: 'display:flex;align-items:center;gap:10px' },
          el('div', { style: `width:36px;height:36px;border-radius:9px;background:${s.color};color:#fff;display:grid;place-items:center;font-weight:600` }, s.key.slice(0, 2)),
          el('div', { style: 'min-width:0' },
            el('div', { style: 'font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, s.name),
            el('div', { style: 'font-size:12px;color:#8f959e' }, `${s.key} · ${roleLabel(s.myRole)}`),
          ),
        ),
        el('div', { style: 'font-size:12.5px;color:#646a73;line-height:1.6;margin:10px 0 14px;min-height:38px' }, s.description || '暂无描述'),
        el('div', { style: 'display:flex;gap:14px;font-size:12px;color:#8f959e;border-top:1px solid #f0f1f2;padding-top:10px' },
          el('span', {}, `成员 ${s.memberCount}`),
          el('span', {}, `工单 ${s.issueCount}`),
          el('span', { style: 'margin-left:auto' }, `负责人 ${s.ownerName ?? '—'}`),
        ),
      ),
    )),
  ));
}

const roleLabel = (r) => ({ owner: '负责人', editor: '可编辑', viewer: '只读' }[r] ?? '未加入');

function openCreateSpace(navigate) {
  const name = el('input', { class: 'input', placeholder: '例如：协同平台研发' });
  const key = el('input', { class: 'input', placeholder: '例如：CORE', maxlength: '10' });
  const desc = el('textarea', { class: 'textarea', placeholder: '这个空间负责什么？' });
  const colors = ['#3370ff', '#2ea121', '#f54a45', '#ff8800', '#7f3bf5', '#00b0b0'];
  let color = colors[0];
  const colorRow = el('div', { style: 'display:flex;gap:8px' },
    ...colors.map((c) => {
      const dot = el('button', {
        class: 'btn sm', style: `background:${c};border-color:${c};width:26px;height:26px;padding:0`,
        onclick: () => { color = c; [...colorRow.children].forEach((n) => { n.style.outline = 'none'; }); dot.style.outline = '2px solid #1f2329'; },
      });
      return dot;
    }),
  );
  const m = modal({
    title: '新建空间',
    body: el('div', {},
      field('名称', name),
      field('标识', key, '2-10 位大写字母或数字，用于工单编号前缀'),
      field('描述', desc),
      field('颜色', colorRow),
    ),
    footer: [
      el('button', { class: 'btn', onclick: () => m.close() }, '取消'),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          const created = await api.post('/api/spaces', {
            name: name.value.trim(),
            key: key.value.trim().toUpperCase(),
            description: desc.value,
            color,
          });
          toast('空间已创建');
          m.close();
          renderSpaces({ content: document.querySelector('.content'), topbar: document.querySelector('.topbar'), navigate });
        } catch (err) { toast(err.message, 'err'); }
      } }, '创建'),
    ],
  });
}

async function openSpace(id) {
  const data = await api.get(`/api/spaces/${id}`);
  const { space, members } = data;
  const canManage = space.myRole === 'owner';
  const body = el('div', {});
  body.append(
    el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:14px' },
      el('div', { style: `width:34px;height:34px;border-radius:9px;background:${space.color};color:#fff;display:grid;place-items:center;font-weight:600` }, space.key.slice(0, 2)),
      el('div', {},
        el('div', { style: 'font-weight:600;font-size:15px' }, space.name),
        el('div', { style: 'font-size:12px;color:#8f959e' }, `${space.key} · 创建于 ${fmtDate(space.createdAt)}`),
      ),
    ),
    el('p', { style: 'font-size:13px;color:#646a73;line-height:1.7;margin:0 0 16px' }, space.description || '暂无描述'),
    el('div', { class: 'section-title' }, `成员 ${members.length}`, el('span', { class: 'line' })),
    el('div', { style: 'display:flex;flex-direction:column;gap:8px' },
      ...members.map((m) => el('div', { style: 'display:flex;align-items:center;gap:9px;padding:7px 0' },
        avatar(m, 'sm'),
        el('div', { style: 'flex:1;min-width:0' },
          el('div', { style: 'font-size:13px' }, m.name ?? m.userId),
          el('div', { style: 'font-size:11.5px;color:#8f959e' }, m.email ?? ''),
        ),
        canManage && m.role !== 'owner'
          ? select(
            [{ value: 'viewer', label: '只读' }, { value: 'editor', label: '可编辑' }, { value: 'owner', label: '负责人' }],
            m.role,
            { style: 'width:100px;height:28px', onchange: async (e) => {
              const role = e.target.value;
              try {
                await api.post(`/api/spaces/${id}/members`, { userId: m.userId, role });
                toast('成员角色已更新');
              } catch (err) { toast(err.message, 'err'); }
            } },
          )
          : el('span', { class: 'tag' }, roleLabel(m.role)),
        canManage && m.role !== 'owner'
          ? el('button', { class: 'btn ghost sm danger', onclick: async () => {
            if (!(await confirmDialog('移除成员', '移除后该成员将无法看到本空间的工单。', '移除'))) return;
            try { await api.del(`/api/spaces/${id}/members/${m.userId}`); toast('已移除'); openSpace(id); }
            catch (err) { toast(err.message, 'err'); }
          } }, '移除')
          : null,
      )),
    ),
    el('div', { style: 'margin-top:16px;padding-top:14px;border-top:1px solid #f0f1f2' },
      el('div', { style: 'font-size:12.5px;color:#8f959e;margin-bottom:9px' }, canManage ? '添加成员' : '只有空间负责人可以调整成员'),
      canManage ? addMemberRow(id) : null,
    ),
  );
  const m = modal({
    title: '空间详情',
    wide: true,
    body,
    footer: [
      el('button', { class: 'btn', onclick: () => { m.close(); location.hash = `#/issues?space=${id}`; } }, '查看工单'),
      el('button', { class: 'btn primary', onclick: () => m.close() }, '关闭'),
    ],
  });
}

function addMemberRow(spaceId) {
  const email = el('input', { class: 'input', placeholder: '输入成员邮箱', style: 'flex:1' });
  const role = select([{ value: 'viewer', label: '只读' }, { value: 'editor', label: '可编辑' }], 'editor', { style: 'width:110px' });
  return el('div', { style: 'display:flex;gap:8px' },
    email,
    role,
    el('button', { class: 'btn primary', onclick: async () => {
      try {
        await api.post(`/api/spaces/${spaceId}/members`, { email: email.value.trim(), role: role.value });
        toast('已添加成员');
        openSpace(spaceId);
      } catch (err) { toast(err.message, 'err'); }
    } }, '添加'),
  );
}
