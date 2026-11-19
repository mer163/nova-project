import { api } from '../api.js';
import { el } from '../ui.js';

const DEMO = [
  { email: 'admin@nova.dev', name: '林知远', role: '超级管理员' },
  { email: 'pm@nova.dev', name: '周允', role: '项目负责人' },
  { email: 'dev@nova.dev', name: '陈嘉禾', role: '研发' },
  { email: 'qa@nova.dev', name: '许清', role: '测试' },
  { email: 'guest@nova.dev', name: '顾言', role: '访客' },
];
const DEMO_PASSWORD = 'nova-demo-2024';

export function renderLogin(mount, onSuccess) {
  const email = el('input', { class: 'input', type: 'email', autocomplete: 'username', placeholder: 'you@company.com' });
  const password = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: '请输入密码' });
  const error = el('div', { class: 'login-error', style: 'display:none' });
  const submit = el('button', { class: 'btn primary', style: 'height:38px;width:100%;font-size:14px', type: 'submit' }, '登录');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      error.style.display = 'none';
      submit.disabled = true;
      submit.textContent = '登录中…';
      try {
        await api.post('/api/auth/login', { email: email.value, password: password.value });
        onSuccess();
      } catch (err) {
        error.textContent = err.message;
        error.style.display = 'block';
        submit.disabled = false;
        submit.textContent = '登录';
      }
    },
  },
    el('h3', {}, '登录 Nova'),
    el('div', { class: 'sub' }, '一个类飞书项目的需求、缺陷与权限协作平台'),
    error,
    el('div', { class: 'field' }, el('label', {}, '邮箱'), email),
    el('div', { class: 'field' }, el('label', {}, '密码'), password),
    submit,
    el('div', { class: 'demo-accounts' },
      el('div', { class: 'title' }, '演示账号，点击自动填充'),
      el('div', { class: 'demo-list' },
        ...DEMO.map((d) => el('button', {
          class: 'demo-chip',
          type: 'button',
          onclick: () => {
            email.value = d.email;
            password.value = DEMO_PASSWORD;
            error.style.display = 'none';
          },
        }, el('strong', {}, d.name), `· ${d.role}`)),
      ),
    ),
  );

  mount.replaceChildren(el('div', { class: 'login-wrap' },
    el('div', { class: 'login-card' },
      el('div', { class: 'login-side' },
        el('div', {},
          el('div', { style: 'font-size:13px;letter-spacing:2px;opacity:.75;margin-bottom:10px' }, 'NOVA WORKSPACE'),
          el('h2', {}, '需求、缺陷与权限，一处收敛'),
          el('p', {}, '以空间为单位组织协作：需求与缺陷共用一套列表与看板，状态流转由工作流约束，角色与空间成员双层权限保证每个人只看到该看的。'),
        ),
        el('div', { class: 'login-points' },
          el('div', { class: 'login-point' }, el('i', {}, '1'), '需求 / 缺陷 / 任务统一编号与视图'),
          el('div', { class: 'login-point' }, el('i', {}, '2'), '可配置工作流，非法流转直接拦截'),
          el('div', { class: 'login-point' }, el('i', {}, '3'), '角色权限矩阵 + 空间成员角色'),
        ),
      ),
      el('div', { class: 'login-form' }, form),
    ),
  ));
  setTimeout(() => email.focus(), 50);
}
