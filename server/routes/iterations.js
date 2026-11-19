import { db } from '../lib/db.js';
import { can, requireSpaceAccess } from '../lib/auth.js';
import { json, readBody } from '../lib/http.js';

const STATUSES = ['planned', 'active', 'completed'];
const STATUS_LABEL = { planned: '未开始', active: '进行中', completed: '已结束' };

function spaceOr404(id) {
  const space = db.data.spaces.find((s) => s.id === id);
  if (!space) {
    const err = new Error('空间不存在');
    err.status = 404;
    throw err;
  }
  return space;
}

function iterationView(it) {
  const issues = db.data.issues.filter((i) => i.iterationId === it.id);
  const closed = issues.filter((i) => {
    const wf = db.data.workflows.find((w) => w.kind === i.kind);
    return wf?.states.find((s) => s.id === i.status)?.type === 'closed';
  }).length;
  return {
    ...it,
    statusLabel: STATUS_LABEL[it.status] ?? it.status,
    issueCount: issues.length,
    doneCount: closed,
    progress: issues.length ? Math.round((closed / issues.length) * 100) : 0,
    estimateTotal: issues.reduce((sum, i) => sum + (i.estimate ?? 0), 0),
  };
}

export async function listIterations(req, res, { user, url }) {
  const spaceId = url.searchParams.get('spaceId');
  const visible = db.data.spaces.filter((s) => {
    if (can(user, 'role:manage')) return true;
    return (s.members ?? []).some((m) => m.userId === user.id);
  });
  const visibleIds = new Set(visible.map((s) => s.id));
  let items = db.data.iterations.filter((i) => visibleIds.has(i.spaceId));
  if (spaceId) {
    const space = spaceOr404(spaceId);
    requireSpaceAccess(user, space, 'viewer');
    items = items.filter((i) => i.spaceId === spaceId);
  }
  items.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  json(res, 200, { items: items.map(iterationView), statuses: STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) });
}

export async function createIteration(req, res, { user }) {
  const { json: body } = await readBody(req);
  const space = spaceOr404(body?.spaceId);
  requireSpaceAccess(user, space, 'editor');
  const name = String(body?.name || '').trim();
  if (name.length < 2) return json(res, 400, { error: '迭代名称至少 2 个字' });
  if (!body?.startDate || !body?.endDate) return json(res, 400, { error: '请填写起止日期' });
  if (body.startDate > body.endDate) return json(res, 400, { error: '结束日期不能早于开始日期' });
  if (db.data.iterations.some((i) => i.spaceId === space.id && i.name === name)) {
    return json(res, 409, { error: '同一空间下已存在同名迭代' });
  }
  const now = new Date().toISOString();
  const iteration = {
    id: `itr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    spaceId: space.id,
    name,
    goal: String(body?.goal || ''),
    status: STATUSES.includes(body?.status) ? body.status : 'planned',
    startDate: body.startDate,
    endDate: body.endDate,
    creatorId: user.id,
    createdAt: now,
  };
  db.data.iterations.push(iteration);
  db.audit(user.id, 'iteration.create', `iteration:${iteration.id}`, `${space.key} / ${name}`);
  db.save();
  json(res, 201, { iteration: iterationView(iteration) });
}

export async function updateIteration(req, res, { user, params }) {
  const iteration = db.data.iterations.find((i) => i.id === params.id);
  if (!iteration) return json(res, 404, { error: '迭代不存在' });
  const space = spaceOr404(iteration.spaceId);
  requireSpaceAccess(user, space, 'editor');
  const { json: body } = await readBody(req);

  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) return json(res, 400, { error: '迭代名称至少 2 个字' });
    if (db.data.iterations.some((i) => i.id !== iteration.id && i.spaceId === iteration.spaceId && i.name === name)) {
      return json(res, 409, { error: '同一空间下已存在同名迭代' });
    }
    iteration.name = name;
  }
  if (body?.goal !== undefined) iteration.goal = String(body.goal);
  if (body?.status !== undefined) {
    if (!STATUSES.includes(body.status)) return json(res, 400, { error: '状态不合法' });
    iteration.status = body.status;
  }
  if (body?.startDate !== undefined || body?.endDate !== undefined) {
    const start = body.startDate ?? iteration.startDate;
    const end = body.endDate ?? iteration.endDate;
    if (start > end) return json(res, 400, { error: '结束日期不能早于开始日期' });
    iteration.startDate = start;
    iteration.endDate = end;
  }
  db.audit(user.id, 'iteration.update', `iteration:${iteration.id}`, iteration.name);
  db.save();
  json(res, 200, { iteration: iterationView(iteration) });
}

export async function deleteIteration(req, res, { user, params }) {
  const iteration = db.data.iterations.find((i) => i.id === params.id);
  if (!iteration) return json(res, 404, { error: '迭代不存在' });
  const space = spaceOr404(iteration.spaceId);
  requireSpaceAccess(user, space, 'owner');
  const attached = db.data.issues.filter((i) => i.iterationId === iteration.id);
  for (const issue of attached) issue.iterationId = null;
  db.data.iterations = db.data.iterations.filter((i) => i.id !== iteration.id);
  db.audit(user.id, 'iteration.delete', `iteration:${iteration.id}`, `${iteration.name}；解绑 ${attached.length} 个工单`);
  db.save();
  json(res, 200, { ok: true, detached: attached.length });
}

export async function iterationBoard(req, res, { user, params }) {
  const iteration = db.data.iterations.find((i) => i.id === params.id);
  if (!iteration) return json(res, 404, { error: '迭代不存在' });
  const space = spaceOr404(iteration.spaceId);
  requireSpaceAccess(user, space, 'viewer');
  const issues = db.data.issues.filter((i) => i.iterationId === iteration.id);
  const byKind = { requirement: 0, bug: 0, task: 0 };
  const byAssignee = {};
  let estimateTotal = 0;
  for (const issue of issues) {
    byKind[issue.kind] = (byKind[issue.kind] ?? 0) + 1;
    estimateTotal += issue.estimate ?? 0;
    if (issue.assigneeId) byAssignee[issue.assigneeId] = (byAssignee[issue.assigneeId] ?? 0) + 1;
  }
  json(res, 200, {
    iteration: iterationView(iteration),
    byKind,
    estimateTotal,
    members: Object.entries(byAssignee).map(([userId, count]) => {
      const u = db.data.users.find((x) => x.id === userId);
      return { userId, name: u?.name ?? '未指派', avatarColor: u?.avatarColor, count };
    }).sort((a, b) => b.count - a.count),
  });
}
