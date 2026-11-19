import fs from 'node:fs';

export function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!raw.length) return resolve({ raw, json: null });
      const type = req.headers['content-type'] || '';
      if (type.includes('application/json')) {
        try {
          return resolve({ raw, json: JSON.parse(raw.toString('utf8')) });
        } catch {
          return reject(Object.assign(new Error('JSON 格式不正确'), { status: 400 }));
        }
      }
      resolve({ raw, json: null });
    });
    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return acc;
    acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    return acc;
  }, {});
}

export function parseMultipart(req, raw) {
  const type = req.headers['content-type'] || '';
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!match) return null;
  const boundary = `--${match[1] || match[2]}`;
  const delimiter = Buffer.from(`\r\n${boundary}`);
  const parts = [];
  const head = Buffer.from(`${boundary}\r\n`);
  let start = raw.indexOf(head);
  if (start !== 0) return null;
  start += head.length;

  while (start < raw.length) {
    let end = raw.indexOf(delimiter, start);
    if (end === -1) break;
    const section = raw.subarray(start, end);
    const sep = section.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const headerText = section.subarray(0, sep).toString('utf8');
      const content = section.subarray(sep + 4);
      const nameMatch = /name="([^"]*)"/i.exec(headerText);
      const fileMatch = /filename="([^"]*)"/i.exec(headerText);
      const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
      parts.push({
        name: nameMatch?.[1] ?? '',
        filename: fileMatch?.[1] ?? null,
        contentType: typeMatch?.[1]?.trim() ?? null,
        data: content,
      });
    }
    start = end + delimiter.length + 2;
    if (raw.subarray(start, start + boundary.length).toString() === boundary && raw[start + boundary.length] === 45) break;
  }
  return parts;
}

export function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      json(res, 404, { error: '文件不存在' });
      return;
    }
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': data.length,
      'cache-control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};
