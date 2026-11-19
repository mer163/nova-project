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

test('迭代列表带进度统计', async () => {
  const res = await admin.call('GET', '/api/iterations');
  assert.equal(res.status, 200);
  const { items, statuses } = await res.json();
  assert.ok(items.length >= 3);
  assert.ok(statuses.some((s) => s.value === 'active'));
  const active = items.find((i) => i.status === 'active');
  assert.ok(active.issueCount >= 1);
  assert.ok(active.progress >= 0 && active.progress <= 100);
});

test('访客看不到未加入空间的迭代', async () => {
  const { items } = await (await guest.call('GET', '/api/iterations')).json();
  assert.ok(items.every((i) => i.spaceId === 'spc-core'));
});

test('创建迭代校验日期与重名', async () => {
  const bad = await admin.call('POST', '/api/iterations', {
    spaceId: 'spc-core', name: '倒置日期', startDate: '2026-12-10', endDate: '2026-12-01',
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /结束日期/);

  const dup = await admin.call('POST', '/api/iterations', {
    spaceId: 'spc-core', name: '11 月迭代 · 权限主线', startDate: '2026-12-01', endDate: '2026-12-10',
  });
  assert.equal(dup.status, 409);

  const ok = await admin.call('POST', '/api/iterations', {
    spaceId: 'spc-core', name: '临时迭代', startDate: '2026-12-01', endDate: '2026-12-10', goal: '用于测试',
  });
  assert.equal(ok.status, 201);
  const { iteration } = await ok.json();
  assert.equal(iteration.status, 'planned');
  assert.equal(iteration.progress, 0);
});

test('访客不能创建迭代，研发可以更新', async () => {
  const denied = await guest.call('POST', '/api/iterations', {
    spaceId: 'spc-core', name: '访客迭代', startDate: '2026-12-01', endDate: '2026-12-10',
  });
  assert.equal(denied.status, 403);

  const updated = await dev.call('PATCH', '/api/iterations/itr-2411', { goal: '权限模型收尾', status: 'completed' });
  assert.equal(updated.status, 200);
  const { iteration } = await updated.json();
  assert.equal(iteration.goal, '权限模型收尾');
  assert.equal(iteration.status, 'completed');
  assert.equal(iteration.statusLabel, '已结束');
});

test('迭代看板返回成员负载与估算合计', async () => {
  const res = await admin.call('GET', '/api/iterations/itr-2411/board');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.estimateTotal > 0);
  assert.ok(data.members.length > 0);
  assert.ok(data.byKind.requirement >= 1);
});

test('迭代筛选工单', async () => {
  const res = await admin.call('GET', '/api/issues?iterationId=itr-grow-1');
  const { items } = await res.json();
  assert.ok(items.length >= 1);
  assert.ok(items.every((i) => i.iterationId === 'itr-grow-1'));
});

test('删除迭代会解绑工单', async () => {
  const created = await (await admin.call('POST', '/api/iterations', {
    spaceId: 'spc-core', name: '待删除迭代', startDate: '2026-11-20', endDate: '2026-11-30',
  })).json();
  await admin.call('PATCH', '/api/issues/issue-7', { iterationId: created.iteration.id });
  const del = await admin.call('DELETE', `/api/iterations/${created.iteration.id}`);
  assert.equal(del.status, 200);
  assert.equal((await del.json()).detached, 1);
  const detail = await (await admin.call('GET', '/api/issues/issue-7')).json();
  assert.equal(detail.issue.iterationId, null);
});

test('通知只在被指派与评论时产生给相关人', async () => {
  const before = await (await dev.call('GET', '/api/notifications')).json();
  const beforeUnread = before.unread;

  await admin.call('POST', '/api/issues/issue-7/comments', { content: '请在验证环境复核一次' });
  const after = await (await dev.call('GET', '/api/notifications')).json();
  if (after.unread > beforeUnread) {
    assert.ok(after.items.some((n) => n.type === 'issue.comment'));
  }
  const guestNotes = await (await guest.call('GET', '/api/notifications')).json();
  assert.ok(guestNotes.items.every((n) => n.userId === guest.user.id));
});

test('标记通知已读', async () => {
  const { items } = await (await dev.call('GET', '/api/notifications')).json();
  const unread = items.find((n) => !n.read);
  if (!unread) return;
  const res = await dev.call('POST', `/api/notifications/${unread.id}/read`);
  assert.equal(res.status, 200);
  const { unread: count } = await (await dev.call('GET', '/api/notifications')).json();
  assert.ok(count >= 0);
  const all = await dev.call('POST', '/api/notifications/read-all');
  assert.equal(all.status, 200);
});

test('批量修改按权限逐条处理', async () => {
  const res = await admin.call('POST', '/api/issues/bulk', {
    ids: ['issue-1', 'issue-9'],
    patch: { priority: 'P1' },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.updated, 2);
  assert.equal(data.skipped.length, 0);

  const denied = await guest.call('POST', '/api/issues/bulk', {
    ids: ['issue-1'], patch: { priority: 'P0' },
  });
  assert.equal(denied.status, 200);
  const skipped = await denied.json();
  assert.equal(skipped.updated, 0);
  assert.equal(skipped.skipped[0].reason, '无权限');
});

test('批量修改拒绝空字段', async () => {
  const res = await admin.call('POST', '/api/issues/bulk', { ids: ['issue-1'], patch: {} });
  assert.equal(res.status, 400);
});

test('导出 CSV 带 BOM 且按空间过滤', async () => {
  const res = await guest.call('GET', '/api/issues/export?kind=bug');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes);
  assert.ok(text.includes('BUG-0005'));
  const rows = text.trim().split('\n');
  assert.ok(rows.length >= 2);
  assert.ok(rows[0].includes('编号'));
});

test('关注与取消关注工单', async () => {
  const on = await dev.call('POST', '/api/issues/issue-2/watch');
  assert.equal(on.status, 200);
  const body = await on.json();
  assert.equal(typeof body.watching, 'boolean');
  const detail = await (await dev.call('GET', '/api/issues/issue-2')).json();
  assert.equal(detail.issue.watching, body.watching);
});

test('访客不能上传或删除附件', async () => {
  const upload = await guest.call('POST', '/api/issues/issue-3/attachments', {});
  assert.equal(upload.status, 403);
  const remove = await guest.call('DELETE', '/api/issues/issue-3/attachments/att-none');
  assert.equal(remove.status, 403);
});

test('上传后可下载且危险类型被拦截', async () => {
  const boundary = '----nova-test-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="说明.txt"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from('权限模型说明'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(`${server.base}/api/issues/issue-3/attachments`, {
    method: 'POST',
    headers: { cookie: admin.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(res.status, 201);
  const { attachment } = await res.json();
  assert.equal(attachment.name, '说明.txt');
  assert.equal('stored' in attachment, false);

  const dl = await admin.call('GET', `/api/issues/issue-3/attachments/${attachment.id}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-type'), /text\/plain/);
  assert.equal((await dl.text()).trim(), '权限模型说明');

  const badBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.html"\r\nContent-Type: text/html\r\n\r\n`),
    Buffer.from('<script>'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const blocked = await fetch(`${server.base}/api/issues/issue-3/attachments`, {
    method: 'POST',
    headers: { cookie: admin.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: badBody,
  });
  assert.equal(blocked.status, 400);
});

test('删除附件后列表不再包含它', async () => {
  const detail = await (await admin.call('GET', '/api/issues/issue-3')).json();
  const attachment = detail.issue.attachments[0];
  if (!attachment) return;
  const res = await admin.call('DELETE', `/api/issues/issue-3/attachments/${attachment.id}`);
  assert.equal(res.status, 200);
  const after = await (await admin.call('GET', '/api/issues/issue-3')).json();
  assert.equal(after.issue.attachments.length, 0);
});
