import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { db } from './lib/db.js';
import { parseCookies, json, MIME, serveStatic } from './lib/http.js';
import { resolveSession } from './lib/auth.js';
import * as auth from './routes/auth.js';
import * as issues from './routes/issues.js';
import * as spaces from './routes/spaces.js';
import * as admin from './routes/admin.js';

export const routes = [
  ['POST', /^\/api\/auth\/login$/, auth.login, { open: true }],
  ['POST', /^\/api\/auth\/logout$/, auth.logout, { open: true }],
  ['GET', /^\/api\/auth\/me$/, auth.me],
  ['POST', /^\/api\/auth\/password$/, auth.changePassword],

  ['GET', /^\/api\/dashboard$/, admin.dashboard],
  ['GET', /^\/api\/spaces$/, spaces.listSpaces],
  ['POST', /^\/api\/spaces$/, spaces.createSpace],
  ['GET', /^\/api\/spaces\/([^/]+)$/, spaces.getSpace],
  ['PATCH', /^\/api\/spaces\/([^/]+)$/, spaces.updateSpace],
  ['POST', /^\/api\/spaces\/([^/]+)\/members$/, spaces.addMember],
  ['DELETE', /^\/api\/spaces\/([^/]+)\/members\/([^/]+)$/, spaces.removeMember],
  ['GET', /^\/api\/workload$/, spaces.myWorkload],

  ['GET', /^\/api\/issues$/, issues.listIssues],
  ['POST', /^\/api\/issues$/, issues.createIssue],
  ['GET', /^\/api\/issues\/([^/]+)$/, issues.getIssue],
  ['PATCH', /^\/api\/issues\/([^/]+)$/, issues.updateIssue],
  ['DELETE', /^\/api\/issues\/([^/]+)$/, issues.deleteIssue],
  ['POST', /^\/api\/issues\/([^/]+)\/transition$/, issues.transitionIssue],
  ['POST', /^\/api\/issues\/([^/]+)\/comments$/, issues.commentIssue],

  ['GET', /^\/api\/directory$/, admin.directory],
  ['GET', /^\/api\/users$/, admin.listUsers],
  ['POST', /^\/api\/users$/, admin.createUser],
  ['PATCH', /^\/api\/users\/([^/]+)$/, admin.updateUser],
  ['DELETE', /^\/api\/users\/([^/]+)$/, admin.deleteUser],
  ['GET', /^\/api\/roles$/, admin.listRoles],
  ['POST', /^\/api\/roles$/, admin.saveRole],
  ['PUT', /^\/api\/roles\/([^/]+)$/, admin.saveRole],
  ['DELETE', /^\/api\/roles\/([^/]+)$/, admin.deleteRole],
  ['GET', /^\/api\/workflows$/, admin.listWorkflows],
  ['PATCH', /^\/api\/workflows\/([^/]+)$/, admin.saveWorkflow],
  ['GET', /^\/api\/audit$/, admin.listAudit],
  ['GET', /^\/api\/meta$/, admin.workflowMeta, { open: true }],
];

export function createApp({ webDir = path.join(process.cwd(), 'web') } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { error: '非法路径编码' });
    }

    if (!pathname.startsWith('/api/')) {
      const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(webDir, safe === '/' ? 'index.html' : safe);
      if (!filePath.startsWith(webDir)) return json(res, 403, { error: '非法路径' });
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return serveStatic(res, filePath, MIME[path.extname(filePath)] || 'application/octet-stream');
      }
      return serveStatic(res, path.join(webDir, 'index.html'), MIME['.html']);
    }

    const token = parseCookies(req).nova_session;
    const session = resolveSession(token);

    for (const [method, pattern, handler, opts = {}] of routes) {
      if (req.method !== method) continue;
      const m = pattern.exec(pathname);
      if (!m) continue;
      if (!opts.open && !session) return json(res, 401, { error: '请先登录', code: 'UNAUTHENTICATED' });
      try {
        const params = {};
        if (/\/members\/[^/]+$/.test(pathname)) {
          const parts = pathname.split('/').filter(Boolean);
          params.id = parts[2];
          params.userId = parts[4];
        } else if (m[1]) {
          params.id = m[1];
        }
        await handler(req, res, { user: session?.user ?? null, params, url, session });
        db.save();
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[api]', pathname, err);
        json(res, status, { error: err.message || '服务器内部错误', code: err.code });
      }
      return;
    }
    json(res, 404, { error: `没有找到接口 ${req.method} ${pathname}` });
  });
}
