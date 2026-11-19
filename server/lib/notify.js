import { db } from './db.js';

export function notify(userId, payload) {
  if (!userId) return null;
  const entry = {
    id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId,
    read: false,
    createdAt: new Date().toISOString(),
    ...payload,
  };
  db.data.notifications.unshift(entry);
  db.data.notifications = db.data.notifications.slice(0, 500);
  return entry;
}

export function notifyIssueWatchers(issue, actorId, payload) {
  const targets = new Set();
  if (issue.assigneeId) targets.add(issue.assigneeId);
  targets.add(issue.creatorId);
  for (const watcher of issue.watchers ?? []) targets.add(watcher);
  targets.delete(actorId);
  return [...targets].filter(Boolean).map((uid) => notify(uid, { ...payload, issueId: issue.id, issueKey: issue.key }));
}
