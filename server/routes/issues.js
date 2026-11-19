import { db } from '../lib/db.js';
import {
  can, canEditIssue, issueSpace, requireSpaceAccess,
} from '../lib/auth.js';
import {
  availableTransitions, findState, initialStatus, workflowFor,
} from '../lib/workflow.js';
import { json, readBody } from '../lib/http.js';

const KINDS = ['requirement', 'bug', 'task'];

export function issueView(issue) {
  const space = db.data.spaces.find((s) => s.id === issue.spaceId);
  const state = findState(issue.kind, issue.status);
  const assignee = db.data.users.find((u) => u.id === issue.assigneeId);
  const creator = db.data.users.find((u) => u.id === issue.creatorId);
  return {
    ...issue,
    spaceName: space?.name ?? '未知空间',
    statusName: state?.name ?? issue.status,
    statusColor: state?.color ?? '#8f959e',
    closed: state?.type === 'closed',
    assigneeName: assignee?.name ?? null,
    creatorName: creator?.name ?? null,
    commentCount: (issue.comments ?? []).length,
    comments: (issue.comments ?? []).map((c) => {
      const author = db.data.users.find((u) => u.id === c.authorId);
      return { ...c, authorName: author?.name ?? '已移除成员', avatarColor: author?.avatarColor ?? '#8f959e' };
    }),
    history: (issue.history ?? []).map((h) => {
      const actor = db.data.users.find((u) => u.id === h.actorId);
      return { ...h, actorName: actor?.name ?? '系统' };
    }),
    transitions: availableTransitions(issue.kind, issue.status),
  };
}

function nextKey(spaceId, kind) {
  const prefix = { requirement: 'REQ', bug: 'BUG', task: 'TASK' }[kind] ?? 'REQ';
  db.data.counters.issue += 1;
  const seq = db.data.counters.issue;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

export async function listIssues(req, res, { user, url }) {
  const q = url.searchParams;
  const spaceId = q.get('spaceId');
  const kind = q.get('kind');
  const status = q.get('status');
  const assigneeId = q.get('assigneeId');
  const keyword = (q.get('q') || '').trim().toLowerCase();
  const page = Math.max(1, Number(q.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') || 50)));

  const visibleSpaces = db.data.spaces.filter((s) => {
    if (can(user, 'role:manage')) return true;
    return (s.members ?? []).some((m) => m.userId === user.id);
  });
  const spaceIds = new Set(visibleSpaces.map((s) => s.id));

  let items = db.data.issues.filter((i) => spaceIds.has(i.spaceId));
  if (spaceId) items = items.filter((i) => i.spaceId === spaceId);
  if (kind) items = items.filter((i) => i.kind === kind);
  if (status) items = items.filter((i) => i.status === status);
  if (assigneeId) items = items.filter((i) => i.assigneeId === assigneeId);
  if (keyword) {
    items = items.filter((i) => `${i.key} ${i.title} ${i.description ?? ''}`.toLowerCase().includes(keyword));
  }
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const total = items.length;
  const sliced = items.slice((page - 1) * pageSize, page * pageSize).map(issueView);
  const counts = {};
  for (const issue of db.data.issues) {
    if (!spaceIds.has(issue.spaceId)) continue;
    if (spaceId && issue.spaceId !== spaceId) continue;
    if (kind && issue.kind !== kind) continue;
    counts[issue.status] = (counts[issue.status] || 0) + 1;
  }
  json(res, 200, { items: sliced, total, page, pageSize, counts });
}

export async function getIssue(req, res, { user, params }) {
  const issue = db.data.issues.find((i) => i.id === params.id);
  if (!issue) return json(res, 404, { error: '需求不存在' });
  requireSpaceAccess(user, issueSpace(issue), 'viewer');
  const detail = issueView(issue);
  detail.canEdit = canEditIssue(user, issue);
  json(res, 200, { issue: detail, workflow: workflowFor(issue.kind) });
}

export async function createIssue(req, res, { user }) {
  const { json: body } = await readBody(req);
  const kind = String(body?.kind || 'requirement');
  if (!KINDS.includes(kind)) return json(res, 400, { error: `类型必须是 ${KINDS.join('/')}` });
  const title = String(body?.title || '').trim();
  if (title.length < 2) return json(res, 400, { error: '标题至少 2 个字' });

  const space = db.data.spaces.find((s) => s.id === body?.spaceId);
  if (!space) return json(res, 400, { error: '请选择有效的空间' });
  requireSpaceAccess(user, space, 'editor');
  if (!can(user, 'issue:create')) return json(res, 403, { error: '当前角色不能创建需求' });

  const now = new Date().toISOString();
  const issue = {
    id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    key: nextKey(space.id, kind),
    spaceId: space.id,
    kind,
    title,
    description: String(body?.description || ''),
    status: initialStatus(kind),
    priority: ['P0', 'P1', 'P2', 'P3'].includes(body?.priority) ? body.priority : 'P2',
    assigneeId: body?.assigneeId || null,
    creatorId: user.id,
    labels: Array.isArray(body?.labels) ? body.labels.slice(0, 8).map(String) : [],
    dueDate: body?.dueDate || null,
    estimate: Number(body?.estimate) || null,
    parentId: body?.parentId || null,
    comments: [],
    history: [{ at: now, actorId: user.id, action: 'create', detail: '创建' }],
    attachments: [],
    createdAt: now,
    updatedAt: now,
  };
  db.data.issues.unshift(issue);
  db.audit(user.id, 'issue.create', `issue:${issue.id}`, `${issue.key} ${title}`);
  db.save();
  json(res, 201, { issue: issueView(issue) });
}

export async function updateIssue(req, res, { user, params }) {
  const issue = db.data.issues.find((i) => i.id === params.id);
  if (!issue) return json(res, 404, { error: '需求不存在' });
  if (!canEditIssue(user, issue)) return json(res, 403, { error: '你没有编辑该需求的权限' });
  const { json: body } = await readBody(req);
  const now = new Date().toISOString();
  const changed = [];

  const editable = ['title', 'description', 'priority', 'labels', 'dueDate', 'estimate', 'assigneeId', 'parentId'];
  for (const field of editable) {
    if (body?.[field] === undefined) continue;
    if (field === 'title') {
      const title = String(body.title).trim();
      if (title.length < 2) return json(res, 400, { error: '标题至少 2 个字' });
      if (title !== issue.title) { issue.title = title; changed.push('标题'); }
      continue;
    }
    const value = body[field];
    if (JSON.stringify(issue[field]) !== JSON.stringify(value)) {
      issue[field] = value;
      changed.push(field);
    }
  }
  if (!changed.length) return json(res, 200, { issue: issueView(issue), changed: false });
  issue.updatedAt = now;
  issue.history.unshift({ at: now, actorId: user.id, action: 'update', detail: `修改了 ${changed.join('、')}` });
  db.audit(user.id, 'issue.update', `issue:${issue.id}`, changed.join(','));
  db.save();
  json(res, 200, { issue: issueView(issue), changed: true });
}

export async function transitionIssue(req, res, { user, params }) {
  const issue = db.data.issues.find((i) => i.id === params.id);
  if (!issue) return json(res, 404, { error: '需求不存在' });
  if (!canEditIssue(user, issue)) return json(res, 403, { error: '你没有推进该需求的权限' });
  const { json: body } = await readBody(req);
  const to = String(body?.to || '');
  const rule = availableTransitions(issue.kind, issue.status).find((t) => t.to === to);
  if (!rule) {
    return json(res, 409, {
      error: `不能从「${findState(issue.kind, issue.status)?.name ?? issue.status}」直接流转到该状态`,
      allowed: availableTransitions(issue.kind, issue.status),
    });
  }
  if (!can(user, rule.permission)) return json(res, 403, { error: `流转需要 ${rule.permission} 权限` });

  const from = issue.status;
  issue.status = to;
  issue.updatedAt = new Date().toISOString();
  issue.history.unshift({
    at: issue.updatedAt,
    actorId: user.id,
    action: 'transition',
    detail: `${findState(issue.kind, from)?.name ?? from} → ${findState(issue.kind, to)?.name ?? to}`,
  });
  db.audit(user.id, 'issue.transition', `issue:${issue.id}`, `${from} → ${to}`);
  db.save();
  json(res, 200, { issue: issueView(issue) });
}

export async function commentIssue(req, res, { user, params }) {
  const issue = db.data.issues.find((i) => i.id === params.id);
  if (!issue) return json(res, 404, { error: '需求不存在' });
  requireSpaceAccess(user, issueSpace(issue), 'viewer');
  if (!can(user, 'issue:comment')) return json(res, 403, { error: '当前角色不能评论' });
  const { json: body } = await readBody(req);
  const content = String(body?.content || '').trim();
  if (!content) return json(res, 400, { error: '评论内容不能为空' });
  const now = new Date().toISOString();
  issue.comments.unshift({
    id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    authorId: user.id,
    content,
    createdAt: now,
  });
  issue.updatedAt = now;
  db.audit(user.id, 'issue.comment', `issue:${issue.id}`, content.slice(0, 60));
  db.save();
  json(res, 201, { issue: issueView(issue) });
}

export async function deleteIssue(req, res, { user, params }) {
  const issue = db.data.issues.find((i) => i.id === params.id);
  if (!issue) return json(res, 404, { error: '需求不存在' });
  requireSpaceAccess(user, issueSpace(issue), 'owner');
  if (!can(user, 'issue:delete')) return json(res, 403, { error: '当前角色不能删除需求' });
  db.data.issues = db.data.issues.filter((i) => i.id !== issue.id);
  db.audit(user.id, 'issue.delete', `issue:${issue.id}`, `${issue.key} ${issue.title}`);
  db.save();
  json(res, 200, { ok: true });
}
