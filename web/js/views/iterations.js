import { api } from '../api.js';
import {
  el, field, modal, select, toast, fmtDate, loading, avatar, confirmDialog,
} from '../ui.js';
import { state } from '../store.js';

const STATUS_COLOR = { planned: '#8f959e', active: '#3370ff', completed: '#2ea121' };

export async function renderIterations({ content, topbar, navigate }) {
  topbar.replaceChildren(
    el('h1', {}, '迭代'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: () => openCreate(content, navigate) }, '+ 新建迭代'),
  );
  content.replaceChildren(loading(4));
  if (!state.spaces.length) state.spaces = (await api.get('/api/spaces')).items;
  const { items } = await api.get('/api/iterations');

  if (!items.length) {
    content.replaceChildren(el('div', { class: 'empty' },
      el('strong', {}, '还没有迭代'),
      '按节奏拆分工作，把工单挂到迭代上。',
      el('div', { style: 'margin-top:16px' },
        el('button', { class: 'btn primary', onclick: () => openCreate(content, navigate) }, '新建迭代')),
    ));
    return;
  }

  content.replaceChildren(
    el('div', { class: 'stat-grid', style: 'margin-bottom:16px' },
      ...[
        ['进行中迭代', items.filter((i) => i.status === 'active').length],
        ['已结束迭代', items.filter((i) => i.status === 'completed').length],
        ['覆盖工单', items.reduce((s, i) => s + i.issueCount, 0)],
        ['估算合计', `${items.reduce((s, i) => s + i.estimateTotal, 0)} 点`],
      ].map(([label, value], idx) => el('div', { class: 'stat' },
        el('div', { class: 'label' }, label),
        el('div', { class: 'value', style: 'display:flex;align-items:baseline' }, String(value),
          el('small', {}, idx === 3 ? '' : '个')),
      )),
    ),
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px' },
      ...items.map((it) => iterationCard(it, content, navigate)),
    ),
  );
}

function iterationCard(it, content, navigate) {
  const color = STATUS_COLOR[it.status] ?? '#8f959e';
  return el('div', { class: 'card' },
    el('div', { class: 'card-body' },
      el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' },
        el('span', { class: 'tag dot', style: `color:${color};background:${color}14` }, it.statusLabel),
        el('span', { style: 'font-size:12px;color:#8f959e' },
          `${fmtDate(it.startDate)} → ${fmtDate(it.endDate)}`),
        el('span', { style: 'flex:1' }),
        el('span', { style: 'font-size:12px;color:#8f959e' }, `${it.estimateTotal} 点`),
      ),
      el('div', { style: 'font-size:15px;font-weight:600;margin-bottom:4px' }, it.name),
      el('div', { style: 'font-size:12.5px;color:#646a73;line-height:1.6;min-height:20px;margin-bottom:12px' },
        it.goal || '暂无目标'),
      el('div', { style: 'display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#8f959e;margin-bottom:6px' },
        el('span', {}, `完成 ${it.doneCount}/${it.issueCount}`),
        el('span', {}, `${it.progress}%`),
      ),
      el('div', { style: 'height:6px;border-radius:3px;background:#f0f1f2;overflow:hidden' },
        el('span', { style: `display:block;height:100%;width:${it.progress}%;background:${color}` }),
      ),
      el('div', { style: 'display:flex;gap:8px;margin-top:14px' },
        el('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); navigate(`/issues?iterationId=${it.id}`); } }, '查看工单'),
        el('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); openIterationDialog(it, content, navigate); } }, '编辑'),
        it.status !== 'completed'
          ? el('button', { class: 'btn sm ghost', onclick: async (e) => {
            e.stopPropagation();
            try {
              await api.patch(`/api/iterations/${it.id}`, { status: 'completed' });
              toast('迭代已结束');
              await reloadIterations();
              renderIterations({ content: document.querySelector('.content'), topbar: document.querySelector('.topbar'), navigate });
            } catch (err) { toast(err.message, 'err'); }
          } }, '结束')
          : null,
      ),
    ),
  );
}

function openCreate(content, navigate) {
  openIterationDialog(null, content, navigate);
}

export function openIterationDialog(it, content, navigate) {
  const name = el('input', { class: 'input', value: it?.name ?? '', placeholder: '例如：11 月迭代 · 权限主线' });
  const goal = el('textarea', { class: 'textarea', style: 'min-height:64px', placeholder: '这个迭代要解决什么' }, it?.goal ?? '');
  const space = select(state.spaces.map((s) => ({ value: s.id, label: s.name })), it?.spaceId ?? state.spaces[0]?.id, { disabled: Boolean(it) });
  const start = el('input', { class: 'input', type: 'date', value: it?.startDate ?? '' });
  const end = el('input', { class: 'input', type: 'date', value: it?.endDate ?? '' });
  const status = select([{ value: 'planned', label: '未开始' }, { value: 'active', label: '进行中' }, { value: 'completed', label: '已结束' }], it?.status ?? 'planned');

  const m = modal({
    title: it ? '编辑迭代' : '新建迭代',
    body: el('div', {},
      field('名称', name),
      field('目标', goal),
      el('div', { class: 'row' }, field('空间', space), field('状态', status)),
      el('div', { class: 'row' }, field('开始日期', start), field('结束日期', end)),
    ),
    footer: [
      it ? el('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmDialog('删除迭代', '删除后工单会保留，但会从迭代中解绑。', '删除'))) return;
        try {
          const res = await api.del(`/api/iterations/${it.id}`);
          toast(`迭代已删除，解绑 ${res.detached} 个工单`);
          m.close();
          await reloadIterations();
          renderIterations({ content: document.querySelector('.content'), topbar: document.querySelector('.topbar'), navigate });
        } catch (err) { toast(err.message, 'err'); }
      } }, '删除') : null,
      el('button', { class: 'btn', onclick: () => m.close() }, '取消'),
      el('button', { class: 'btn primary', onclick: async () => {
        const payload = {
          name: name.value.trim(),
          goal: goal.value,
          spaceId: space.value,
          startDate: start.value,
          endDate: end.value,
          status: status.value,
        };
        try {
          if (it) await api.patch(`/api/iterations/${it.id}`, payload);
          else await api.post('/api/iterations', payload);
          toast(it ? '迭代已更新' : '迭代已创建');
          m.close();
          await reloadIterations();
          renderIterations({ content: document.querySelector('.content'), topbar: document.querySelector('.topbar'), navigate });
        } catch (err) { toast(err.message, 'err'); }
      } }, '保存'),
    ].filter(Boolean),
  });
}


async function reloadIterations() {
  const data = await api.get('/api/iterations').catch(() => ({ items: [] }));
  state.iterations = data.items;
}
