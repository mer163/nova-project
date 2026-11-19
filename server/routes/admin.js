import { db } from '../lib/db.js';
import {
  can, hashPassword, PERMISSIONS, publicUser, requirePermission, spaceRole,
} from '../lib/auth.js';
import { availableTransitions, initialStatus, DEFAULT_WORKFLOWS } from '../lib/workflow.js';
import { json, readBody } from '../lib/http.js';

export async function listUsers(req, res, { user }) {
  requirePermission(user, 'member:manage');
  json(res, 200, {
    items: db.data.users.map(publicUser),
    roles: db.data.roles,
    permissions: PERMISSIONS,
  });
}

export async function createUser(req, res, { user }) {
  requirePermission(user, 'member:manage');
  const { json: body } = await readBody(req);
  const name = String(body?.name || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (name.length < 2) return json(res, 400, { error: '姓名至少 2 个字' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: '邮箱格式不正确' });
  if (password.length < 8) return json(res, 400, { error: '初始密码至少 8 位' });
  if (db.data.users.some((u) => u.email.toLowerCase() === email)) return json(res, 409, { error: '邮箱已存在' });
  const roleId = db.data.roles.some((r) => r.id === body?.roleId) ? body.roleId : 'member';
  const colors = ['#3370ff', '#2ea121', '#f54a45', '#ff8800', '#7f3bf5', '#00b0b0'];
  const created = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    email,
    passwordHash: hashPassword(password),
    roleId,
    avatarColor: colors[db.data.users.length % colors.length],
    createdAt: new Date().toISOString(),
  };
  db.data.users.push(created);
  db.audit(user.id, 'user.create', `user:${created.id}`, `${name} ${email}`);
  db.save();
  json(res, 201, { user: publicUser(created) });
}

export async function updateUser(req, res, { user, params }) {
  const target = db.data.users.find((u) => u.id === params.id);
  if (!target) return json(res, 404, { error: '用户不存在' });
  if (target.id !== user.id) requirePermission(user, 'member:manage');
  const { json: body } = await readBody(req);

  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) return json(res, 400, { error: '姓名至少 2 个字' });
    target.name = name;
  }
  if (body?.roleId !== undefined) {
    requirePermission(user, 'role:manage');
    if (!db.data.roles.some((r) => r.id === body.roleId)) return json(res, 400, { error: '角色不存在' });
    target.roleId = body.roleId;
  }
  if (body?.password) {
    if (target.id !== user.id) requirePermission(user, 'member:manage');
    if (String(body.password).length < 8) return json(res, 400, { error: '密码至少 8 位' });
    target.passwordHash = hashPassword(String(body.password));
  }
  db.audit(user.id, 'user.update', `user:${target.id}`, target.name);
  db.save();
  json(res, 200, { user: publicUser(target) });
}

export async function deleteUser(req, res, { user, params }) {
  requirePermission(user, 'member:manage');
  const target = db.data.users.find((u) => u.id === params.id);
  if (!target) return json(res, 404, { error: '用户不存在' });
  if (target.id === user.id) return json(res, 400, { error: '不能删除自己' });
  const assigned = db.data.issues.filter((i) => i.assigneeId === target.id).length;
  db.data.users = db.data.users.filter((u) => u.id !== target.id);
  for (const space of db.data.spaces) {
    space.members = (space.members ?? []).map((m) => (m.userId === target.id ? { ...m, role: 'viewer' } : m));
  }
  db.audit(user.id, 'user.delete', `user:${target.id}`, `${target.name}；遗留待办 ${assigned}`);
  db.save();
  json(res, 200, { ok: true, reassigned: assigned });
}

export async function listRoles(req, res, { user }) {
  requirePermission(user, 'issue:read');
  json(res, 200, { items: db.data.roles, permissions: PERMISSIONS });
}

export async function saveRole(req, res, { user, params }) {
  requirePermission(user, 'role:manage');
  const { json: body } = await readBody(req);
  const permissions = Array.isArray(body?.permissions)
    ? body.permissions.filter((p) => PERMISSIONS.includes(p) || p === '*')
    : [];
  if (params.id) {
    const role = db.data.roles.find((r) => r.id === params.id);
    if (!role) return json(res, 404, { error: '角色不存在' });
    if (role.builtin && permissions.includes('*') === false && role.permissions.includes('*')) {
      return json(res, 400, { error: '内置管理员角色需保留全部权限' });
    }
    role.name = String(body?.name || role.name).trim();
    role.description = String(body?.description ?? role.description ?? '');
    role.permissions = permissions;
    db.audit(user.id, 'role.update', `role:${role.id}`, `${role.name}:${permissions.length} 项权限`);
    db.save();
    return json(res, 200, { role });
  }
  const created = {
    id: `role-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: String(body?.name || '').trim() || '未命名角色',
    description: String(body?.description || ''),
    permissions,
    builtin: false,
  };
  db.data.roles.push(created);
  db.audit(user.id, 'role.create', `role:${created.id}`, created.name);
  db.save();
  json(res, 201, { role: created });
}

export async function deleteRole(req, res, { user, params }) {
  requirePermission(user, 'role:manage');
  const role = db.data.roles.find((r) => r.id === params.id);
  if (!role) return json(res, 404, { error: '角色不存在' });
  if (role.builtin) return json(res, 400, { error: '内置角色不可删除' });
  const refs = db.data.users.filter((u) => u.roleId === role.id);
  if (refs.length) return json(res, 409, { error: `还有 ${refs.length} 位成员使用该角色，请先调整他们的角色` });
  db.data.roles = db.data.roles.filter((r) => r.id !== role.id);
  db.audit(user.id, 'role.delete', `role:${role.id}`, role.name);
  db.save();
  json(res, 200, { ok: true });
}

export async function listWorkflows(req, res, { user }) {
  requirePermission(user, 'issue:read');
  json(res, 200, { items: db.data.workflows });
}

export async function saveWorkflow(req, res, { user, params }) {
  requirePermission(user, 'workflow:manage');
  const { json: body } = await readBody(req);
  const workflow = db.data.workflows.find((w) => w.id === params.id);
  if (!workflow) return json(res, 404, { error: '工作流不存在' });

  if (Array.isArray(body?.states)) {
    const states = body.states
      .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
      .map((s) => ({
        id: s.id,
        name: s.name,
        color: String(s.color || '#8f959e'),
        type: s.type === 'closed' ? 'closed' : 'open',
      }));
    if (states.length < 2) return json(res, 400, { error: '至少保留两个状态' });
    const valid = new Set(states.map((s) => s.id));
    const used = db.data.issues.filter((i) => i.kind === workflow.kind && !valid.has(i.status));
    if (used.length) return json(res, 409, { error: `有 ${used.length} 个工单正在使用被删除的状态，先迁移它们` });
    workflow.states = states;
    workflow.transitions = (workflow.transitions ?? []).filter((t) => valid.has(t.from) && valid.has(t.to));
  }
  if (Array.isArray(body?.transitions)) {
    const valid = new Set(workflow.states.map((s) => s.id));
    workflow.transitions = body.transitions
      .filter((t) => t && valid.has(t.from) && valid.has(t.to) && t.from !== t.to)
      .map((t) => ({
        from: t.from,
        to: t.to,
        name: String(t.name || '流转'),
        permission: PERMISSIONS.includes(t.permission) ? t.permission : 'issue:transition',
      }));
  }
  db.audit(user.id, 'workflow.update', `workflow:${workflow.id}`, workflow.name);
  db.save();
  json(res, 200, { workflow });
}

export async function listAudit(req, res, { user, url }) {
  requirePermission(user, 'audit:read');
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
  const items = db.data.audit.slice(0, limit).map((a) => {
    const actor = db.data.users.find((u) => u.id === a.actorId);
    return { ...a, actorName: actor?.name ?? '已删除用户' };
  });
  json(res, 200, { items });
}

export async function dashboard(req, res, { user }) {
  requirePermission(user, 'issue:read');
  const spaces = db.data.spaces.filter((s) => {
    if (can(user, 'role:manage')) return true;
    return (s.members ?? []).some((m) => m.userId === user.id);
  });
  const ids = new Set(spaces.map((s) => s.id));
  const issues = db.data.issues.filter((i) => ids.has(i.spaceId));
  const byKind = { requirement: 0, bug: 0, task: 0 };
  const byStatus = {};
  const byAssignee = {};
  for (const issue of issues) {
    byKind[issue.kind] = (byKind[issue.kind] ?? 0) + 1;
    byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
    if (issue.assigneeId) byAssignee[issue.assigneeId] = (byAssignee[issue.assigneeId] ?? 0) + 1;
  }
  const recent = issues
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 8)
    .map((i) => ({
      id: i.id,
      key: i.key,
      title: i.title,
      kind: i.kind,
      status: i.status,
      statusName: db.data.workflows.flatMap((w) => w.states).find((s) => s.id === i.status)?.name ?? i.status,
      updatedAt: i.updatedAt,
      spaceId: i.spaceId,
    }));
  json(res, 200, {
    totals: { issues: issues.length, spaces: spaces.length, members: db.data.users.length, byKind, byStatus },
    workload: Object.entries(byAssignee)
      .map(([userId, count]) => {
        const u = db.data.users.find((x) => x.id === userId);
        return { userId, name: u?.name ?? '未指派', count, color: u?.avatarColor };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    recent,
    spaces: spaces.map((s) => ({ id: s.id, name: s.name, key: s.key, color: s.color, myRole: spaceRole(user, s) })),
  });
}

export async function workflowMeta(req, res) {
  json(res, 200, {
    items: db.data.workflows,
    builtin: DEFAULT_WORKFLOWS,
    initial: {
      requirement: initialStatus('requirement'),
      bug: initialStatus('bug'),
      task: initialStatus('task'),
    },
    transitionsFor: {
      requirement: availableTransitions('requirement', 'backlog'),
    },
  });
}

export async function directory(req, res) {
  json(res, 200, {
    items: db.data.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatarColor: u.avatarColor,
      roleId: u.roleId,
    })),
  });
}
