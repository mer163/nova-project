import crypto from 'node:crypto';
import { db } from './db.js';

const KEYLEN = 32;
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export const PERMISSIONS = [
  'issue:read',
  'issue:create',
  'issue:update',
  'issue:delete',
  'issue:transition',
  'issue:comment',
  'issue:assign',
  'space:read',
  'space:create',
  'space:manage',
  'member:manage',
  'role:manage',
  'workflow:manage',
  'audit:read',
];

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, digest] = stored.split(':');
  const derived = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(digest, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function publicUser(user) {
  if (!user) return null;
  const role = db.data.roles.find((r) => r.id === user.roleId);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    roleName: role?.name ?? user.roleId,
    permissions: role?.permissions ?? [],
    avatarColor: user.avatarColor,
    createdAt: user.createdAt,
  };
}

export function resolveSession(token) {
  if (!token) return null;
  const session = db.data.sessions[token];
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    delete db.data.sessions[token];
    db.save();
    return null;
  }
  const user = db.data.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return { user, token };
}

export function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.data.sessions[token] = { userId, expiresAt: Date.now() + SESSION_TTL_MS };
  db.save();
  return token;
}

export function destroySession(token) {
  if (token && db.data.sessions[token]) {
    delete db.data.sessions[token];
    db.save();
  }
}

export function roleOf(user) {
  return db.data.roles.find((r) => r.id === user.roleId);
}

export function can(user, permission) {
  if (!user) return false;
  const role = roleOf(user);
  if (!role) return false;
  if (role.permissions.includes('*')) return true;
  return role.permissions.includes(permission);
}

export function requirePermission(user, permission) {
  if (!can(user, permission)) {
    const err = new Error(`当前角色「${roleOf(user)?.name ?? '未知'}」没有 ${permission} 权限`);
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

export function spaceRole(user, space) {
  if (!user || !space) return null;
  if (can(user, '*') || can(user, 'role:manage')) return 'owner';
  const member = (space.members ?? []).find((m) => m.userId === user.id);
  return member?.role ?? null;
}

const RANK = { owner: 3, editor: 2, viewer: 1 };
export function atLeast(role, role2) {
  return (RANK[role] ?? 0) >= (RANK[role2] ?? 0);
}

export function requireSpaceAccess(user, space, minimum = 'viewer') {
  const role = spaceRole(user, space);
  if (!role || !atLeast(role, minimum)) {
    const err = new Error(role ? '当前空间角色无权执行该操作' : '你不在该空间的成员列表中');
    err.status = 403;
    err.code = 'SPACE_FORBIDDEN';
    throw err;
  }
  return role;
}

export function issueSpace(issue) {
  return db.data.spaces.find((s) => s.id === issue.spaceId);
}

export function canEditIssue(user, issue) {
  const space = issueSpace(issue);
  const role = spaceRole(user, space);
  if (!role) return false;
  if (atLeast(role, 'editor')) return true;
  if (can(user, 'issue:update') && issue.creatorId === user.id) return true;
  return false;
}
