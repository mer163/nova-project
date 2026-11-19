import { db } from '../lib/db.js';
import {
  atLeast, can, requireSpaceAccess, spaceRole,
} from '../lib/auth.js';
import { json, readBody } from '../lib/http.js';

function spaceView(space, user) {
  const owner = db.data.users.find((u) => u.id === space.ownerId);
  return {
    id: space.id,
    name: space.name,
    key: space.key,
    description: space.description,
    color: space.color,
    ownerId: space.ownerId,
    ownerName: owner?.name ?? null,
    memberCount: (space.members ?? []).length,
    issueCount: db.data.issues.filter((i) => i.spaceId === space.id).length,
    myRole: spaceRole(user, space),
    createdAt: space.createdAt,
  };
}

export async function listSpaces(req, res, { user }) {
  const spaces = db.data.spaces.filter((s) => {
    if (can(user, 'role:manage')) return true;
    return (s.members ?? []).some((m) => m.userId === user.id);
  });
  json(res, 200, { items: spaces.map((s) => spaceView(s, user)) });
}

export async function createSpace(req, res, { user }) {
  if (!can(user, 'space:create')) return json(res, 403, { error: '当前角色不能创建空间' });
  const { json: body } = await readBody(req);
  const name = String(body?.name || '').trim();
  if (name.length < 2) return json(res, 400, { error: '空间名称至少 2 个字' });
  const key = String(body?.key || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) return json(res, 400, { error: '空间标识为 2-10 位大写字母或数字，且以字母开头' });
  if (db.data.spaces.some((s) => s.key === key)) return json(res, 409, { error: '空间标识已被占用' });
  const now = new Date().toISOString();
  const space = {
    id: `spc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    key,
    description: String(body?.description || ''),
    color: String(body?.color || '#3370ff'),
    ownerId: user.id,
    members: [{ userId: user.id, role: 'owner', joinedAt: now }],
    createdAt: now,
  };
  db.data.spaces.push(space);
  db.audit(user.id, 'space.create', `space:${space.id}`, name);
  db.save();
  json(res, 201, { space: spaceView(space, user) });
}

export async function getSpace(req, res, { user, params }) {
  const space = db.data.spaces.find((s) => s.id === params.id);
  if (!space) return json(res, 404, { error: '空间不存在' });
  const role = requireSpaceAccess(user, space, 'viewer');
  json(res, 200, {
    space: spaceView(space, user),
    myRole: role,
    members: (space.members ?? []).map((m) => {
      const u = db.data.users.find((x) => x.id === m.userId);
      return { ...m, name: u?.name, email: u?.email, avatarColor: u?.avatarColor };
    }),
  });
}

export async function updateSpace(req, res, { user, params }) {
  const space = db.data.spaces.find((s) => s.id === params.id);
  if (!space) return json(res, 404, { error: '空间不存在' });
  requireSpaceAccess(user, space, 'owner');
  const { json: body } = await readBody(req);
  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) return json(res, 400, { error: '空间名称至少 2 个字' });
    space.name = name;
  }
  if (body?.description !== undefined) space.description = String(body.description);
  if (body?.color !== undefined) space.color = String(body.color);
  db.audit(user.id, 'space.update', `space:${space.id}`, space.name);
  db.save();
  json(res, 200, { space: spaceView(space, user) });
}

export async function addMember(req, res, { user, params, url }) {
  const space = db.data.spaces.find((s) => s.id === params.id);
  if (!space) return json(res, 404, { error: '空间不存在' });
  requireSpaceAccess(user, space, 'owner');
  const { json: body } = await readBody(req);
  const target = db.data.users.find((u) => u.id === body?.userId || u.email === String(body?.email || '').toLowerCase());
  if (!target) return json(res, 404, { error: '找不到该用户' });
  const role = ['viewer', 'editor', 'owner'].includes(body?.role) ? body.role : 'editor';
  space.members = space.members ?? [];
  const existing = space.members.find((m) => m.userId === target.id);
  if (existing) existing.role = role;
  else space.members.push({ userId: target.id, role, joinedAt: new Date().toISOString() });
  db.audit(user.id, 'space.member.add', `space:${space.id}`, `${target.name}:${role}`);
  db.save();
  json(res, 200, { ok: true, role, userId: target.id, spaceId: space.id, _q: url.searchParams.get('x') });
}

export async function removeMember(req, res, { user, params }) {
  const space = db.data.spaces.find((s) => s.id === params.id);
  if (!space) return json(res, 404, { error: '空间不存在' });
  requireSpaceAccess(user, space, 'owner');
  const targetId = params.userId;
  if (targetId === space.ownerId) return json(res, 400, { error: '不能移除空间负责人' });
  space.members = (space.members ?? []).filter((m) => m.userId !== targetId);
  db.audit(user.id, 'space.member.remove', `space:${space.id}`, targetId);
  db.save();
  json(res, 200, { ok: true });
}

export async function myWorkload(req, res, { user }) {
  const spaces = db.data.spaces.filter((s) => (s.members ?? []).some((m) => m.userId === user.id));
  const ids = new Set(spaces.map((s) => s.id));
  const mine = db.data.issues.filter((i) => ids.has(i.spaceId) && i.assigneeId === user.id);
  const created = db.data.issues.filter((i) => ids.has(i.spaceId) && i.creatorId === user.id);
  json(res, 200, {
    assigned: mine.length,
    created: created.length,
    openAssigned: mine.filter((i) => !['done', 'closed', 'cancelled'].includes(i.status)).length,
    byKind: {
      requirement: mine.filter((i) => i.kind === 'requirement').length,
      bug: mine.filter((i) => i.kind === 'bug').length,
      task: mine.filter((i) => i.kind === 'task').length,
    },
  });
}

export { atLeast };
