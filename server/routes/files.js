import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../lib/db.js';
import { canEditIssue, issueSpace, requireSpaceAccess } from '../lib/auth.js';
import { json, readBody, parseMultipart } from '../lib/http.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
const MAX_BYTES = 5 * 1024 * 1024;

const BLOCKED_EXT = new Set(['.html', '.htm', '.svg', '.js', '.mjs', '.exe', '.sh']);

function issueOr404(id) {
  const issue = db.data.issues.find((i) => i.id === id);
  if (!issue) {
    const err = new Error('需求不存在');
    err.status = 404;
    throw err;
  }
  return issue;
}

export async function uploadAttachment(req, res, { user, params }) {
  const issue = issueOr404(params.id);
  requireSpaceAccess(user, issueSpace(issue), 'viewer');
  if (!canEditIssue(user, issue)) return json(res, 403, { error: '你没有为该工单上传附件的权限' });

  const { raw } = await readBody(req, MAX_BYTES + 512 * 1024);
  const parts = parseMultipart(req, raw);
  const file = parts?.find((p) => p.filename && p.filename.trim());
  if (!file || !file.data?.length) return json(res, 400, { error: '没有收到文件' });
  if (file.data.length > MAX_BYTES) return json(res, 413, { error: '单个附件不能超过 5MB' });

  const ext = path.extname(file.filename).toLowerCase() || '';
  if (BLOCKED_EXT.has(ext)) return json(res, 400, { error: `${ext} 类型不允许上传` });

  const safeName = path.basename(file.filename).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 120);
  const stored = `${crypto.randomBytes(12).toString('hex')}${ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), file.data);

  const attachment = {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: safeName,
    size: file.data.length,
    contentType: file.contentType || 'application/octet-stream',
    stored,
    uploaderId: user.id,
    createdAt: new Date().toISOString(),
  };
  issue.attachments = issue.attachments ?? [];
  issue.attachments.unshift(attachment);
  issue.updatedAt = attachment.createdAt;
  issue.history.unshift({
    at: attachment.createdAt,
    actorId: user.id,
    action: 'attachment',
    detail: `上传附件 ${safeName}`,
  });
  db.audit(user.id, 'issue.attachment.add', `issue:${issue.id}`, safeName);
  db.save();

  const { stored: _omit, ...publicAttachment } = attachment;
  json(res, 201, { attachment: publicAttachment });
}

export async function downloadAttachment(req, res, { user, params }) {
  const issue = issueOr404(params.id);
  requireSpaceAccess(user, issueSpace(issue), 'viewer');
  const attachment = (issue.attachments ?? []).find((a) => a.id === params.sub);
  if (!attachment) return json(res, 404, { error: '附件不存在' });
  const filePath = path.join(UPLOAD_DIR, path.basename(attachment.stored));
  if (!fs.existsSync(filePath)) return json(res, 404, { error: '附件文件已丢失' });

  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    'content-type': attachment.contentType || 'application/octet-stream',
    'content-length': data.length,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    'cache-control': 'private, max-age=0',
  });
  res.end(data);
}

export async function deleteAttachment(req, res, { user, params }) {
  const issue = issueOr404(params.id);
  if (!canEditIssue(user, issue)) return json(res, 403, { error: '你没有删除附件的权限' });
  const attachment = (issue.attachments ?? []).find((a) => a.id === params.sub);
  if (!attachment) return json(res, 404, { error: '附件不存在' });
  if (attachment.uploaderId !== user.id && !canEditIssue(user, issue)) {
    return json(res, 403, { error: '只能删除自己的附件' });
  }
  issue.attachments = issue.attachments.filter((a) => a.id !== attachment.id);
  const filePath = path.join(UPLOAD_DIR, path.basename(attachment.stored));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.audit(user.id, 'issue.attachment.remove', `issue:${issue.id}`, attachment.name);
  db.save();
  json(res, 200, { ok: true });
}
