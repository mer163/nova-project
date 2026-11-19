export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat(3)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toast');
  box.textContent = message;
  box.className = `toast show${kind === 'err' ? ' err' : ''}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { box.className = 'toast'; }, 2600);
}

export function initials(name = '') {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

export function avatar(person, size = '') {
  const name = person?.name ?? person?.assigneeName ?? '未指派';
  const color = person?.avatarColor ?? '#c9cdd4';
  const node = el('span', { class: `avatar ${size}`.trim(), title: name }, initials(name));
  node.style.background = color;
  return node;
}

const KIND_META = {
  requirement: { label: '需求', color: '#3370ff' },
  bug: { label: '缺陷', color: '#f54a45' },
  task: { label: '任务', color: '#00b0b0' },
};
export const kindMeta = (kind) => KIND_META[kind] ?? { label: kind, color: '#8f959e' };

export function statusTag(item) {
  if (!item) return el('span', { class: 'tag' }, '未知');
  const color = item.statusColor ?? '#8f959e';
  const name = item.statusName ?? item.status ?? '';
  const node = el('span', { class: 'tag dot' }, name);
  node.style.color = color;
  node.style.background = `${color}14`;
  return node;
}

export function kindTag(kind) {
  const meta = kindMeta(kind);
  const node = el('span', { class: 'tag' }, meta.label);
  node.style.color = meta.color;
  node.style.background = `${meta.color}14`;
  return node;
}

export function priorityTag(priority) {
  const colors = { P0: '#f54a45', P1: '#ff8800', P2: '#3370ff', P3: '#8f959e' };
  if (!priority) return el('span', { class: 'tag' }, '—');
  const node = el('span', { class: 'tag' }, priority);
  node.style.color = colors[priority] ?? '#8f959e';
  node.style.background = `${colors[priority] ?? '#8f959e'}14`;
  return node;
}

export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDate(ts) {
  if (!ts || new Date(ts).getTime() === 0) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const pick = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function fmtDateTime(ts) {
  if (!ts || new Date(ts).getTime() === 0) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(/\//g, '-');
}

export function modal({ title, body, footer, wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const close = () => { mask.remove(); onClose?.(); };
  const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) close(); } },
    el('div', { class: `modal${wide ? ' wide' : ''}` },
      el('div', { class: 'modal-head' }, title),
      el('div', { class: 'modal-body' }, body),
      footer ? el('div', { class: 'modal-foot' }, footer) : null,
    ),
  );
  root.append(mask);
  return { close, node: mask };
}

export function confirmDialog(title, message, confirmText = '确认') {
  return new Promise((resolve) => {
    const footer = [
      el('button', { class: 'btn', onclick: () => { m.close(); resolve(false); } }, '取消'),
      el('button', { class: 'btn primary', onclick: () => { m.close(); resolve(true); } }, confirmText),
    ];
    const m = modal({ title, body: el('p', { style: 'margin:0;line-height:1.7;color:#646a73' }, message), footer });
  });
}

export function field(label, control, hint) {
  return el('div', { class: 'field' },
    el('label', {}, label),
    control,
    hint ? el('span', { class: 'hint' }, hint) : null,
  );
}

export function select(options, value, attrs = {}) {
  const node = el('select', { class: 'select', ...attrs });
  for (const opt of options) {
    const o = el('option', { value: opt.value }, opt.label);
    if (String(opt.value) === String(value ?? '')) o.selected = true;
    node.append(o);
  }
  return node;
}

export function loading(rows = 3) {
  return el('div', { style: 'padding:16px;display:flex;flex-direction:column;gap:10px' },
    ...Array.from({ length: rows }, () => el('div', { class: 'skeleton', style: 'height:34px' })),
  );
}
