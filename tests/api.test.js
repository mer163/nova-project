import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let server;
let admin;
let dev;
let guest;

before(async () => {
  server = await startServer();
  admin = await server.login('admin@nova.dev');
  dev = await server.login('dev@nova.dev');
  guest = await server.login('guest@nova.dev');
});

after(async () => {
  await server.close();
});

test('未登录访问业务接口返回 401', async () => {
  const res = await fetch(`${server.base}/api/issues`);
  assert.equal(res.status, 401);
});

test('登录后可读到演示数据与统计', async () => {
  const res = await admin.call('GET', '/api/dashboard');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.totals.issues >= 10);
  assert.ok(data.totals.spaces >= 2);
  assert.ok(data.recent.length > 0);
});

test('按类型筛选工单只返回对应类型', async () => {
  const res = await admin.call('GET', '/api/issues?kind=bug');
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(data.items.length > 0);
  assert.ok(data.items.every((i) => i.kind === 'bug'));
  assert.ok(data.counts.open >= 1);
});

test('非法状态流转被工作流拦截', async () => {
  const list = await (await admin.call('GET', '/api/issues?kind=requirement')).json();
  const target = list.items.find((i) => i.status === 'backlog');
  assert.ok(target, '需要一个待评估状态的需求');
  const res = await admin.call('POST', `/api/issues/${target.id}/transition`, { to: 'done' });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /不能从/);
  assert.ok(Array.isArray(body.allowed));
});

test('合法流转会写入操作历史', async () => {
  const list = await (await admin.call('GET', '/api/issues?kind=requirement')).json();
  const target = list.items.find((i) => i.id === 'issue-1');
  const ok = await admin.call('POST', `/api/issues/${target.id}/transition`, { to: 'planned' });
  assert.equal(ok.status, 200);
  const { issue } = await ok.json();
  assert.equal(issue.status, 'planned');
  assert.ok(issue.history[0].detail.includes('待评估 → 已规划'));
});

test('访客角色不能创建、编辑或删除工单', async () => {
  const create = await guest.call('POST', '/api/issues', {
    kind: 'bug', spaceId: 'spc-core', title: '访客试图创建缺陷',
  });
  assert.equal(create.status, 403);

  const edit = await guest.call('PATCH', '/api/issues/issue-5', { title: '访客改名' });
  assert.equal(edit.status, 403);

  const del = await guest.call('DELETE', '/api/issues/issue-5');
  assert.equal(del.status, 403);
});

test('访客可以查看授权空间但不能看到未加入的空间', async () => {
  const core = await guest.call('GET', '/api/spaces/spc-core');
  assert.equal(core.status, 200);
  const grow = await guest.call('GET', '/api/spaces/spc-growth');
  assert.equal(grow.status, 403);

  const list = await (await guest.call('GET', '/api/issues')).json();
  assert.ok(list.items.every((i) => i.spaceId === 'spc-core'));
});

test('研发角色不能进入成员管理接口', async () => {
  const res = await dev.call('GET', '/api/users');
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /member:manage/);
});

test('管理员可以新建成员并调整角色', async () => {
  const created = await admin.call('POST', '/api/users', {
    name: '测试新人', email: 'newbie@nova.dev', password: 'newbie-pass-1', roleId: 'qa',
  });
  assert.equal(created.status, 201);
  const { user } = await created.json();
  assert.equal(user.roleName, '测试');

  const patched = await admin.call('PATCH', `/api/users/${user.id}`, { roleId: 'dev' });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).user.roleName, '研发');
});

test('非法角色权限项会被过滤', async () => {
  const res = await admin.call('POST', '/api/roles', {
    name: '自定义角色', description: '测试', permissions: ['issue:read', 'not-a-permission'],
  });
  assert.equal(res.status, 201);
  const { role } = await res.json();
  assert.deepEqual(role.permissions, ['issue:read']);
});

test('正在使用的角色不能被删除', async () => {
  const res = await admin.call('DELETE', '/api/roles/dev');
  assert.equal(res.status, 400);
});

test('删除未使用的自定义角色成功', async () => {
  const created = await (await admin.call('POST', '/api/roles', {
    name: '临时角色', permissions: ['issue:read'],
  })).json();
  const res = await admin.call('DELETE', `/api/roles/${created.role.id}`);
  assert.equal(res.status, 200);
});

test('工作流不允许删除正在使用的状态', async () => {
  const { items } = await (await admin.call('GET', '/api/workflows')).json();
  const wf = items.find((w) => w.kind === 'bug');
  const next = { ...wf, states: wf.states.filter((s) => s.id !== 'open') };
  const res = await admin.call('PATCH', `/api/workflows/${wf.id}`, { states: next.states });
  assert.equal(res.status, 409);
});

test('审计日志记录关键写操作', async () => {
  const { items } = await (await admin.call('GET', '/api/audit?limit=50')).json();
  assert.ok(items.some((a) => a.action === 'issue.transition' || a.action === 'user.create'));
  assert.ok(items[0].actorName);
});

test('创建工单会生成递增编号与初始状态', async () => {
  const res = await admin.call('POST', '/api/issues', {
    kind: 'bug', spaceId: 'spc-core', title: '新建缺陷用于编号校验', priority: 'P1',
  });
  assert.equal(res.status, 201);
  const { issue } = await res.json();
  assert.match(issue.key, /^BUG-\d{4}$/);
  assert.equal(issue.status, 'open');
  assert.equal(issue.statusName, '待处理');
});
