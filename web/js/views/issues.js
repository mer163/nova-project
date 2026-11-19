import { api } from '../api.js';
import {
  el, fmtTime, fmtDate, avatar, statusTag, kindTag, priorityTag,
  kindMeta, toast, modal, field, select, loading,
} from '../ui.js';
import { state } from '../store.js';

let filter = { kind: 'requirement', spaceId: '', view: 'list', q: '', status: '', mine: false };
let cache = { items: [], counts: {} };

export async function renderIssues({ content, topbar, route, navigate }) {
  if (route?.params?.kind) filter.kind = route.params.kind;
  if (route?.params?.space) filter.spaceId = route.params.space;
  if (!state.spaces.length) state.spaces = (await api.get('/api/spaces')).items;

  topbar.replaceChildren(
    el('h1', {}, '需求与缺陷'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: () => openSpaceFilter(navigate) }, '⌸ 空间筛选'),
    el('button', { class: 'btn primary', onclick: () => openCreate(navigate) }, '+ 新建'),
  );

  content.className = 'content tight';
  const toolbar = el('div', { class: 'toolbar' });
  const body = el('div', { style: 'background:#fff;min-height:calc(100vh - 108px)' });
  content.replaceChildren(toolbar, body);

  const draw = async () => {
    body.replaceChildren(loading(6));
    const data = await api.get(`/api/issues${api.qs({
      kind: filter.kind,
      spaceId: filter.spaceId,
      status: filter.status,
      q: filter.q,
      assigneeId: filter.mine ? state.user.id : '',
    })}`);
    cache.items = data.items;
    cache.counts = data.counts;
    state.issueCount = data.total;
    renderToolbar(toolbar, data, draw);
    if (filter.view === 'board') renderBoard(body, data, navigate, draw);
    else renderTable(body, data, navigate);
    if (route?.params?.open) {
      openIssue(route.params.open, draw);
      route.params.open = null;
      history.replaceState(null, '', '#/issues');
    }
    if (route?.params?.new) {
      route.params.new = null;
      openCreate(navigate);
    }
  };
  await draw();
}

function openSpaceFilter(navigate) {
  const body = el('div', {});
  const sel = select([{ value: '', label: '全部空间' }, ...state.spaces.map((s) => ({ value: s.id, label: s.name }))], filter.spaceId);
  body.append(field('空间', sel));
  const m = modal({
    title: '筛选空间',
    body,
    footer: [
      el('button', { class: 'btn', onclick: () => m.close() }, '取消'),
      el('button', { class: 'btn primary', onclick: () => {
        const next = sel.value;
        m.close();
        filter.spaceId = next;
        if (next) navigate(`/issues?space=${next}`);
        else {
          navigate('/issues');
          renderIssues({
            content: document.querySelector('.content'),
            topbar: document.querySelector('.topbar'),
            route: { name: 'issues', params: {} },
            navigate,
          });
        }
      } }, '应用'),
    ],
  });
}

function renderToolbar(toolbar, data, draw) {
  const kindSeg = el('div', { class: 'seg' },
    ...[['requirement', '需求'], ['bug', '缺陷'], ['task', '任务']].map(([k, label]) =>
      el('button', { class: filter.kind === k ? 'active' : '', onclick: () => { filter.kind = k; filter.status = ''; draw(); } }, label)),
  );
  const viewSeg = el('div', { class: 'seg' },
    ...[['list', '列表'], ['board', '看板']].map(([v, label]) =>
      el('button', { class: filter.view === v ? 'active' : '', onclick: () => { filter.view = v; draw(); } }, label)),
  );
  const search = el('input', {
    class: 'input',
    style: 'width:210px;height:32px',
    placeholder: '搜索编号或标题',
    value: filter.q,
    onkeydown: (e) => { if (e.key === 'Enter') { filter.q = e.target.value.trim(); draw(); } },
  });
  const spaceSel = select(
    [{ value: '', label: '全部空间' }, ...state.spaces.map((s) => ({ value: s.id, label: s.name }))],
    filter.spaceId,
    { style: 'width:150px;height:32px', onchange: (e) => { filter.spaceId = e.target.value; draw(); } },
  );
  const mineBtn = el('button', {
    class: 'btn sm',
    style: filter.mine ? 'border-color:#b9cdfd;background:#f4f7ff;color:#3370ff' : '',
    onclick: () => { filter.mine = !filter.mine; draw(); },
  }, '只看我的');

  toolbar.replaceChildren(kindSeg, spaceSel, search, mineBtn, el('span', { class: 'spacer' }), viewSeg);
}

function renderTable(body, data, navigate) {
  if (!data.items.length) {
    body.replaceChildren(el('div', { class: 'empty' },
      el('strong', {}, '没有符合条件的工单'),
      '换个筛选条件，或新建一条。',
    ));
    return;
  }
  const rows = data.items.map((i) => el('tr', { onclick: () => openIssue(i.id) },
    el('td', { class: 'key' }, i.key),
    el('td', {}, el('div', { class: 'title-cell' },
      el('span', { class: 'dotmark', style: `background:${kindMeta(i.kind).color}` }),
      el('span', {}, i.title),
      ...(i.labels ?? []).map((l) => el('span', { class: 'tag' }, l)),
    )),
    el('td', {}, statusTag(i)),
    el('td', {}, priorityTag(i.priority)),
    el('td', {}, i.assigneeName ? el('div', { style: 'display:flex;align-items:center;gap:6px' }, avatar({ name: i.assigneeName }), i.assigneeName) : el('span', { style: 'color:#8f959e' }, '未指派')),
    el('td', { class: 'ellipsis', style: 'max-width:120px;color:#646a73' }, i.spaceName),
    el('td', { style: 'color:#8f959e;font-size:12px' }, fmtTime(i.updatedAt)),
  ));

  body.replaceChildren(el('table', { class: 'table' },
    el('thead', {}, el('tr', {},
      ...['编号', '标题', '状态', '优先级', '负责人', '空间', '更新时间'].map((h) => el('th', {}, h)),
    )),
    el('tbody', {}, ...rows),
  ));
}

function renderBoard(body, data, navigate, draw) {
  const kinds = filter.kind;
  const byState = {};
  for (const item of data.items) {
    byState[item.status] = byState[item.status] ?? [];
    byState[item.status].push(item);
  }
  const allStates = state.meta.items.find((w) => w.kind === kinds)?.states ?? [];
  const board = el('div', { class: 'kanban' });
  for (const st of allStates) {
    const col = el('div', { class: 'kcol', dataset: { status: st.id } });
    col.append(el('div', { class: 'kcol-head' },
      el('span', { class: 'dotmark', style: `background:${st.color}` }),
      st.name,
      el('span', { class: 'count' }, String((byState[st.id] ?? []).length)),
    ));
    for (const item of byState[st.id] ?? []) {
      const card = el('div', {
        class: 'kcard',
        draggable: 'true',
        onclick: () => openIssue(item.id, draw),
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', item.id); card.classList.add('dragging'); },
        ondragend: () => card.classList.remove('dragging'),
      },
        el('div', { class: 'k-key' }, item.key),
        el('div', { class: 'k-title' }, item.title),
        el('div', { class: 'k-foot' },
          priorityTag(item.priority),
          ...(item.labels ?? []).slice(0, 2).map((l) => el('span', { class: 'tag' }, l)),
          el('span', { style: 'flex:1' }),
          item.assigneeName ? avatar({ name: item.assigneeName }) : null,
        ),
      );
      col.append(card);
    }
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      if (!id) return;
      const item = data.items.find((i) => i.id === id);
      if (!item || item.status === st.id) return;
      try {
        await api.post(`/api/issues/${id}/transition`, { to: st.id });
        toast(`已流转到「${st.name}」`);
        draw();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    board.append(col);
  }
  body.replaceChildren(board);
}

export async function openIssue(id, onChange) {
  const root = document.getElementById('modal-root');
  const mask = el('div', { class: 'drawer-mask', onclick: (e) => { if (e.target === mask) close(); } });
  const close = () => { mask.remove(); onChange?.(); };
  const drawer = el('div', { class: 'drawer' });
  mask.append(drawer);
  root.append(mask);
  drawer.append(loading(5));

  const { issue, workflow } = await api.get(`/api/issues/${id}`);
  const isEditor = issue.canEdit;

  const head = el('div', { class: 'drawer-head' },
    kindTag(issue.kind),
    el('span', { class: 'key', style: 'color:#8f959e;font-size:12.5px' }, issue.key),
    el('span', { style: 'flex:1' }),
    el('button', { class: 'btn ghost sm', onclick: close }, '✕'),
  );

  const title = el('div', { class: 'issue-title' }, issue.title);
  if (isEditor) {
    title.contentEditable = 'true';
    title.addEventListener('blur', async () => {
      const next = title.textContent.trim();
      if (!next || next === issue.title) { title.textContent = issue.title; return; }
      try {
        await api.patch(`/api/issues/${id}`, { title: next });
        issue.title = next;
        toast('标题已更新');
        onChange?.();
      } catch (err) { toast(err.message, 'err'); title.textContent = issue.title; }
    });
  }

  const meta = el('div', { class: 'meta-grid' });
  const addMeta = (k, v) => meta.append(el('span', { class: 'k' }, k), el('div', { class: 'v' }, v));

  const stateSel = isEditor
    ? select(workflow.states.map((s) => ({ value: s.id, label: s.name })), issue.status, {
      style: 'width:auto;min-width:120px;height:30px',
      onchange: async (e) => {
        const to = e.target.value;
        try {
          await api.post(`/api/issues/${id}/transition`, { to });
          toast('状态已更新');
          openIssueLoop();
        } catch (err) {
          toast(err.message, 'err');
          e.target.value = issue.status;
        }
      },
    })
    : statusTag(issue);

  const members = await api.get('/api/directory').catch(() => ({ items: [] }));
  const assigneeSel = isEditor
    ? select([{ value: '', label: '未指派' }, ...members.items.map((u) => ({ value: u.id, label: u.name }))], issue.assigneeId, {
      style: 'width:auto;min-width:120px;height:30px',
      onchange: async (e) => {
        try {
          await api.patch(`/api/issues/${id}`, { assigneeId: e.target.value || null });
          toast('负责人已更新');
          issue.assigneeId = e.target.value || null;
          onChange?.();
        } catch (err) { toast(err.message, 'err'); }
      },
    })
    : (issue.assigneeName ?? '未指派');

  const prioritySel = isEditor
    ? select(['P0', 'P1', 'P2', 'P3'].map((p) => ({ value: p, label: p })), issue.priority, {
      style: 'width:auto;min-width:90px;height:30px',
      onchange: async (e) => {
        try { await api.patch(`/api/issues/${id}`, { priority: e.target.value }); toast('优先级已更新'); onChange?.(); }
        catch (err) { toast(err.message, 'err'); }
      },
    })
    : priorityTag(issue.priority);

  addMeta('状态', stateSel);
  addMeta('负责人', assigneeSel);
  addMeta('优先级', prioritySel);
  addMeta('所属空间', issue.spaceName);
  addMeta('截止日期', issue.dueDate ? fmtDate(issue.dueDate) : '未设置');
  addMeta('创建人', `${issue.creatorName ?? '—'} · ${fmtTime(issue.createdAt)}`);

  const nextSteps = issue.transitions ?? [];
  const actionRow = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 0' },
    ...nextSteps.map((t) => el('button', {
      class: 'btn sm',
      disabled: !isEditor,
      onclick: async () => {
        try {
          await api.post(`/api/issues/${id}/transition`, { to: t.to });
          toast(`已流转：${t.name}`);
          openIssueLoop();
        } catch (err) { toast(err.message, 'err'); }
      },
    }, t.name, ' →')),
  );

  const body = el('div', { class: 'drawer-body' },
    title,
    meta,
    nextSteps.length ? el('div', {}, el('div', { style: 'font-size:12px;color:#8f959e;margin-bottom:8px' }, '可执行流转'), actionRow) : null,
    el('div', { class: 'section-title' }, '描述', el('span', { class: 'line' })),
    renderDescription(issue, isEditor, id, onChange),
    el('div', { class: 'section-title' }, `评论 ${issue.comments?.length ?? 0}`, el('span', { class: 'line' })),
    renderComments(issue, id, () => openIssueLoop()),
    el('div', { class: 'section-title' }, '操作记录', el('span', { class: 'line' })),
    el('div', { class: 'timeline' },
      ...(issue.history ?? []).slice(0, 20).map((h) => {
        return el('div', { class: 't-item' },
          el('strong', { style: 'font-weight:500;margin-right:6px' }, h.actorName ?? '系统'),
          h.detail,
          el('span', { style: 'color:#8f959e;margin-left:8px' }, fmtTime(h.at)),
        );
      }),
    ),
  );

  const foot = el('div', { class: 'drawer-foot' },
    el('span', { style: 'flex:1;font-size:12px;color:#8f959e;align-self:center' }, `更新于 ${fmtTime(issue.updatedAt)}`),
    issue.canEdit && issue.transitions?.length && issue.closed
      ? el('button', { class: 'btn', onclick: async () => {
        const t = issue.transitions[0];
        try { await api.post(`/api/issues/${id}/transition`, { to: t.to }); toast('已重新打开'); openIssueLoop(); }
        catch (err) { toast(err.message, 'err'); }
      } }, '重新打开')
      : null,
    el('button', { class: 'btn', onclick: close }, '关闭'),
  );

  drawer.replaceChildren(head, body, foot);

  const openIssueLoop = () => { mask.remove(); openIssue(id, onChange); };
}

function renderDescription(issue, isEditor, id, onChange) {
  const box = el('div', {
    style: 'font-size:13px;line-height:1.75;color:#1f2329;white-space:pre-wrap;min-height:44px;padding:2px 0',
  }, issue.description || '暂无描述');
  if (!isEditor) return box;
  box.style.cursor = 'text';
  box.title = '点击编辑';
  box.addEventListener('click', () => {
    const ta = el('textarea', { class: 'textarea', style: 'min-height:120px' }, issue.description ?? '');
    const actions = el('div', { style: 'display:flex;gap:8px;margin-top:8px' },
      el('button', { class: 'btn sm primary', onclick: async () => {
        try {
          await api.patch(`/api/issues/${id}`, { description: ta.value });
          toast('描述已保存');
          issue.description = ta.value;
          actions.replaceWith(box);
          ta.replaceWith(box);
          onChange?.();
        } catch (err) { toast(err.message, 'err'); }
      } }, '保存'),
      el('button', { class: 'btn sm', onclick: () => { actions.remove(); ta.remove(); box.style.display = ''; } }, '取消'),
    );
    box.style.display = 'none';
    box.after(ta, actions);
    ta.focus();
  });
  return box;
}

function renderComments(issue, id, refresh) {
  const wrap = el('div', {});
  for (const c of issue.comments ?? []) {
    wrap.append(el('div', { class: 'comment' },
      avatar({ name: c.authorName, avatarColor: c.avatarColor }, 'sm'),
      el('div', { class: 'c-body' },
        el('div', { class: 'c-head' }, el('span', { class: 'c-name' }, c.authorName ?? c.authorId), el('span', { class: 'c-time' }, fmtTime(c.createdAt))),
        el('div', { class: 'c-text' }, c.content),
      ),
    ));
  }
  const input = el('textarea', { class: 'textarea', style: 'min-height:72px', placeholder: '添加评论，支持多行…' });
  const send = el('button', { class: 'btn primary sm', onclick: async () => {
    const content = input.value.trim();
    if (!content) return toast('请先输入内容', 'err');
    try {
      await api.post(`/api/issues/${id}/comments`, { content });
      toast('评论已发布');
      refresh();
    } catch (err) { toast(err.message, 'err'); }
  } }, '发表');
  wrap.append(el('div', { style: 'margin-top:10px' }, input, el('div', { style: 'display:flex;justify-content:flex-end;margin-top:8px' }, send)));
  return wrap;
}

export function openCreate(navigate) {
  const kind = select([{ value: 'requirement', label: '需求' }, { value: 'bug', label: '缺陷' }, { value: 'task', label: '任务' }], filter.kind);
  const space = select(state.spaces.map((s) => ({ value: s.id, label: `${s.name}（${s.key}）` })), filter.spaceId || state.spaces[0]?.id);
  const title = el('input', { class: 'input', placeholder: '简明扼要地描述问题或目标' });
  const desc = el('textarea', { class: 'textarea', placeholder: '背景、期望结果、验收标准…' });
  const priority = select(['P0', 'P1', 'P2', 'P3'].map((p) => ({ value: p, label: p })), 'P2');
  const labels = el('input', { class: 'input', placeholder: '多个标签用逗号分隔' });
  const dueDate = el('input', { class: 'input', type: 'date' });

  const m = modal({
    title: '新建工单',
    wide: true,
    body: el('div', {},
      el('div', { class: 'row' }, field('类型', kind), field('空间', space)),
      field('标题', title),
      field('描述', desc),
      el('div', { class: 'row' }, field('优先级', priority), field('截止日期', dueDate)),
      field('标签', labels, '例如：权限, 核心'),
    ),
    footer: [
      el('button', { class: 'btn', onclick: () => m.close() }, '取消'),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          const created = await api.post('/api/issues', {
            kind: kind.value,
            spaceId: space.value,
            title: title.value.trim(),
            description: desc.value,
            priority: priority.value,
            dueDate: dueDate.value || null,
            labels: labels.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          });
          toast(`已创建 ${created.issue.key}`);
          m.close();
          navigate(`/issues?open=${created.issue.id}`);
        } catch (err) { toast(err.message, 'err'); }
      } }, '创建'),
    ],
  });
  setTimeout(() => title.focus(), 40);
}

export { renderIssues as default };
