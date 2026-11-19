import { db } from '../lib/db.js';
import {
  can, canEditIssue, issueSpace, requireSpaceAccess,
} from '../lib/auth.js';
import {
  availableTransitions, findState, initialStatus, workflowFor,
} from '../lib/workflow.js';
import { notifyIssueWatchers } from '../lib/notify.js';
import { json, readBody } from '../lib/http.js';

const KINDS = ['requirement', 'bug', 'task'];

export function issueView(issue) {
  const space = db.data.spaces.find((s) => s.id === issue.spaceId);
  const state = findState(issue.kind, issue.status);
  const assignee = db.data.users.find((u) => u.id === issue.assigneeId);
  const creator = db.data.users.find((u) => u.id === issue.creatorId);
  const iteration = issue.iterationId ? db.data.iterations.find((i) => i.id === issue.iterationId) : null;
  return {
    ...issue,
    spaceName: space?.name ?? '未知空间',
    statusName: state?.name ?? issue.status,
    statusColor: state?.color ?? '#8f959e',
    closed: state?.type === 'closed',
    assigneeName: assignee?.name ?? null,
    iterationName: iteration?.name ?? null,
    attachmentCount: (issue.attachments ?? []).length,
    attachments: (issue.attachments ?? []).map(({ stored, ...rest }) => rest),
    watchers: issue.watchers ?? [],
    watcherCount: (issue.watchers ?? []).length,
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
  if (url.searchParams.get('format') === 'csv') return exportIssues(req, res, { user, url });
  const q = url.searchParams;
  const spaceId = q.get('spaceId');
  const kind = q.get('kind');
  const status = q.get('status');
  const assigneeId = q.get('assigneeId');
  const iterationId = q.get('iterationId');
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
  if (iterationId) items = items.filter((i) => i.iterationId === iterationId);
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
  detail.watching = (issue.watchers ?? []).includes(user.id);
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
    iterationId: body?.iterationId || null,
    watchers: [],
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

  const editable = ['title', 'description', 'priority', 'labels', 'dueDate', 'estimate', 'assigneeId', 'parentId', 'iterationId'];
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
  if (changed.includes('assigneeId') && issue.assigneeId && issue.assigneeId !== user.id) {
    notifyIssueWatchers(issue, user.id, {
      type: 'issue.assigned',
      title: `${issue.key} 指派给你`,
      body: issue.title,
    });
  }
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
  notifyIssueWatchers(issue, user.id, {
    type: 'issue.transition',
    title: `${issue.key} 状态变更`,
    body: `${findState(issue.kind, from)?.name ?? from} → ${findState(issue.kind, to)?.name ?? to}`,
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
  notifyIssueWatchers(issue, user.id, {
    type: 'issue.comment',
    title: `${issue.key} 有新评论`,
    body: `${user.name}：${content.slice(0, 60)}`,
  });
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

export async function toggleWatch(req, res, { user, params }) {
  const issue = db.data.issues.find((i) => i.id === params.id);
  if (!issue) return json(res, 404, { error: '需求不存在' });
  requireSpaceAccess(user, issueSpace(issue), 'viewer');
  issue.watchers = issue.watchers ?? [];
  const idx = issue.watchers.indexOf(user.id);
  if (idx >= 0) issue.watchers.splice(idx, 1);
  else issue.watchers.push(user.id);
  db.save();
  json(res, 200, { watching: idx < 0, watcherCount: issue.watchers.length });
}

const BULK_FIELDS = ['assigneeId', 'priority', 'iterationId', 'dueDate'];

export async function bulkUpdate(req, res, { user }) {
  const { json: body } = await readBody(req);
  const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean).slice(0, 100) : [];
  if (!ids.length) return json(res, 400, { error: '请选择至少一个工单' });
  const patch = {};
  for (const field of BULK_FIELDS) {
    if (body?.patch?.[field] !== undefined) patch[field] = body.patch[field] || null;
  }
  if (!Object.keys(patch).length) return json(res, 400, { error: '没有可批量修改的字段' });

  const updated = [];
  const skipped = [];
  for (const id of ids) {
    const issue = db.data.issues.find((i) => i.id === id);
    if (!issue) { skipped.push({ id, reason: '不存在' }); continue; }
    if (!canEditIssue(user, issue)) { skipped.push({ id, key: issue.key, reason: '无权限' }); continue; }
    Object.assign(issue, patch);
    issue.updatedAt = new Date().toISOString();
    issue.history.unshift({
      at: issue.updatedAt,
      actorId: user.id,
      action: 'bulk',
      detail: `批量修改 ${Object.keys(patch).join('、')}`,
    });
    updated.push(issue.key);
  }
  db.audit(user.id, 'issue.bulk', 'issues', `更新 ${updated.length} 条，跳过 ${skipped.length} 条`);
  db.save();
  json(res, 200, { updated: updated.length, skipped, keys: updated });
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function exportIssues(req, res, { user, url }) {
  const q = url.searchParams;
  const spaceId = q.get('spaceId');
  const kind = q.get('kind');
  const visible = db.data.spaces.filter((s) => (s.members ?? []).some((m) => m.userId === user.id));
  const ids = new Set(visible.map((s) => s.id));
  let items = db.data.issues.filter((i) => ids.has(i.spaceId));
  if (spaceId) items = items.filter((i) => i.spaceId === spaceId);
  if (kind) items = items.filter((i) => i.kind === kind);

  const header = ['编号', '类型', '标题', '状态', '优先级', '负责人', '空间', '迭代', '截止日期', '创建人', '创建时间', '更新时间'];
  const rows = items.map((i) => {
    const space = db.data.spaces.find((s) => s.id === i.spaceId);
    const iteration = db.data.iterations.find((x) => x.id === i.iterationId);
    return [
      i.key,
      { requirement: '需求', bug: '缺陷', task: '任务' }[i.kind] ?? i.kind,
      i.title,
      findState(i.kind, i.status)?.name ?? i.status,
      i.priority,
      db.data.users.find((u) => u.id === i.assigneeId)?.name ?? '',
      space?.name ?? '',
      iteration?.name ?? '',
      i.dueDate ?? '',
      db.data.users.find((u) => u.id === i.creatorId)?.name ?? '',
      i.createdAt,
      i.updatedAt,
    ].map(csvCell).join(',');
  });

  const csv = `\ufeff${header.join(',')}\n${rows.join('\n')}\n`;
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`nova-issues-${Date.now()}.csv`)}`,
    'cache-control': 'no-store',
  });
  res.end(csv);
}
