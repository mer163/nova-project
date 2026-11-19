import { db } from '../lib/db.js';
import { json } from '../lib/http.js';

export async function listNotifications(req, res, { user, url }) {
  const onlyUnread = url.searchParams.get('unread') === '1';
  let items = db.data.notifications.filter((n) => n.userId === user.id);
  if (onlyUnread) items = items.filter((n) => !n.read);
  const unread = db.data.notifications.filter((n) => n.userId === user.id && !n.read).length;
  json(res, 200, { items: items.slice(0, 50), unread });
}

export async function markRead(req, res, { user, params }) {
  const target = db.data.notifications.find((n) => n.id === params.id && n.userId === user.id);
  if (!target) return json(res, 404, { error: '通知不存在' });
  target.read = true;
  db.save();
  json(res, 200, { ok: true });
}

export async function markAllRead(req, res, { user }) {
  let count = 0;
  for (const n of db.data.notifications) {
    if (n.userId === user.id && !n.read) {
      n.read = true;
      count += 1;
    }
  }
  db.save();
  json(res, 200, { ok: true, count });
}
