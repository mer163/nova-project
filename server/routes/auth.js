import { db } from '../lib/db.js';
import {
  createSession, destroySession, hashPassword,
  publicUser, verifyPassword, PERMISSIONS,
} from '../lib/auth.js';
import { json, readBody, parseCookies } from '../lib/http.js';

export async function login(req, res) {
  const { json: body } = await readBody(req);
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const user = db.data.users.find((u) => u.email.toLowerCase() === email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return json(res, 401, { error: '邮箱或密码不正确' });
  }
  const token = createSession(user.id);
  res.setHeader('set-cookie', `nova_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 12}`);
  db.audit(user.id, 'auth.login', `user:${user.id}`, '登录成功');
  db.save();
  json(res, 200, { user: publicUser(user) });
}

export async function logout(req, res) {
  const token = parseCookies(req).nova_session;
  destroySession(token);
  res.setHeader('set-cookie', 'nova_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  json(res, 200, { ok: true });
}

export async function me(req, res, { user }) {
  json(res, 200, { user: publicUser(user), permissions: PERMISSIONS });
}

export async function changePassword(req, res, { user }) {
  const { json: body } = await readBody(req);
  const current = String(body?.currentPassword || '');
  const next = String(body?.newPassword || '');
  if (next.length < 8) return json(res, 400, { error: '新密码至少 8 位' });
  if (!verifyPassword(current, user.passwordHash)) return json(res, 400, { error: '当前密码不正确' });
  user.passwordHash = hashPassword(next);
  db.audit(user.id, 'auth.password', `user:${user.id}`, '修改本人密码');
  db.save();
  json(res, 200, { ok: true });
}
