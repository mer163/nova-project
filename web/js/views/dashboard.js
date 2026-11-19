import { api } from '../api.js';
import { el, fmtTime, kindMeta, statusTag, avatar, loading } from '../ui.js';

export async function renderDashboard({ content, topbar, navigate }) {
  topbar.replaceChildren(
    el('h1', {}, '工作台'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: () => navigate('/iterations') }, '迭代'),
    el('button', { class: 'btn primary', onclick: () => navigate('/issues?new=1') }, '+ 新建'),
  );
  content.replaceChildren(loading(4));
  const data = await api.get('/api/dashboard');
  const workload = await api.get('/api/workload');

  const t = data.totals;
  const openCount = t.issues - (t.byStatus.done ?? 0) - (t.byStatus.closed ?? 0);

  const stats = el('div', { class: 'stat-grid' },
    statCard('我的待办', t.myOpen ?? workload.openAssigned, `共 ${workload.assigned} 项指派给我`, '#3370ff', workload.assigned ? (t.myOpen ?? workload.openAssigned) / Math.max(1, workload.assigned) : 0),
    statCard('未完成工单', openCount, `全部 ${t.issues} 条`, '#ff8800', t.issues ? openCount / t.issues : 0),
    statCard('缺陷', t.byKind.bug ?? 0, '含已关闭', '#f54a45', t.issues ? (t.byKind.bug ?? 0) / t.issues : 0),
    statCard('进行中迭代', t.activeIterations ?? 0, `未读通知 ${t.unread ?? 0} 条`, '#2ea121', 1),
  );

  const kindBars = el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
    ...Object.entries(t.byKind).map(([kind, count]) => {
      const meta = kindMeta(kind);
      const width = t.issues ? Math.round((count / t.issues) * 100) : 0;
      return el('div', {},
        el('div', { style: 'display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px' },
          el('span', {}, el('span', { class: 'dotmark', style: `display:inline-block;background:${meta.color};margin-right:6px` }), meta.label),
          el('span', { style: 'color:#8f959e' }, `${count} 条`),
        ),
        el('div', { class: 'bar', style: 'height:6px;border-radius:3px;background:#f0f1f2;overflow:hidden' },
          el('span', { style: `display:block;height:100%;width:${width}%;background:${meta.color};border-radius:3px` }),
        ),
      );
    }),
  );

  const recentList = el('div', {},
    ...(data.recent.length ? data.recent.map((i) => {
      const meta = kindMeta(i.kind);
      return el('div', {
        style: 'display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #f0f1f2;cursor:pointer',
        onclick: () => navigate(`/issues?open=${i.id}`),
      },
        el('span', { class: 'dotmark', style: `background:${meta.color}` }),
        el('div', { style: 'min-width:0;flex:1' },
          el('div', { style: 'display:flex;gap:8px;align-items:baseline' },
            el('span', { style: 'font-size:11.5px;color:#8f959e' }, i.key),
            el('span', { style: 'font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, i.title),
          ),
          el('div', { style: 'font-size:11.5px;color:#8f959e;margin-top:3px' }, fmtTime(i.updatedAt)),
        ),
        statusTag(i),
      );
    }) : [el('div', { class: 'empty' }, '暂无最近更新')]),
  );

  const workloadList = el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
    ...(data.workload.length ? data.workload.map((w) => {
      const max = Math.max(...data.workload.map((x) => x.count));
      return el('div', { style: 'display:flex;align-items:center;gap:10px' },
        avatar({ name: w.name, avatarColor: w.color }, 'sm'),
        el('span', { style: 'width:64px;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, w.name),
        el('div', { style: 'flex:1;height:6px;background:#f0f1f2;border-radius:3px;overflow:hidden' },
          el('span', { style: `display:block;height:100%;width:${Math.round((w.count / max) * 100)}%;background:${w.color}` }),
        ),
        el('span', { style: 'font-size:12px;color:#8f959e;width:24px;text-align:right' }, w.count),
      );
    }) : [el('div', { class: 'empty' }, '暂无指派')]),
  );

  content.replaceChildren(
    el('div', { style: 'margin-bottom:16px;font-size:13px;color:#646a73' },
      `${greet()}，${'' }今天还有 ${workload.openAssigned} 项待办。`),
    stats,
    el('div', { class: 'grid-2' },
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, '最近更新',
          el('span', { class: 'spacer', style: 'flex:1' }),
          el('button', { class: 'btn sm ghost', onclick: () => navigate('/issues') }, '打开全部工单'),
        ),
        el('div', { class: 'card-body', style: 'padding-top:6px;padding-bottom:6px' }, recentList),
      ),
      el('div', { style: 'display:flex;flex-direction:column;gap:16px' },
        el('div', { class: 'card' },
          el('div', { class: 'card-head' }, '类型分布'),
          el('div', { class: 'card-body' }, kindBars),
        ),
        el('div', { class: 'card' },
          el('div', { class: 'card-head' }, '成员负载'),
          el('div', { class: 'card-body' }, workloadList),
        ),
      ),
    ),
  );
}

function statCard(label, value, sub, color, ratio) {
  return el('div', { class: 'stat' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, String(value), el('small', {}, sub)),
    el('div', { class: 'bar' }, el('span', { style: `width:${Math.max(4, Math.round(ratio * 100))}%;background:${color}` })),
  );
}

function greet() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date()));
  if (h < 6) return '凌晨好';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}
