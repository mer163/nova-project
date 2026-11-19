import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nova-test-'));
}

export async function startServer() {
  process.env.DATA_DIR = tempDataDir();
  process.env.NOVA_SEED_PASSWORD = 'nova-test-pass';
  const { seedIfEmpty } = await import('../server/lib/seed.js');
  const { createApp } = await import('../server/app.js');
  seedIfEmpty();
  const app = createApp({ webDir: path.join(process.cwd(), 'web') });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const base = `http://127.0.0.1:${port}`;

  async function login(email, password = 'nova-test-pass') {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`登录失败: ${body.error}`);
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    return {
      user: body.user,
      cookie,
      call(method, url, payload) {
        return fetch(`${base}${url}`, {
          method,
          headers: {
            cookie,
            ...(payload ? { 'content-type': 'application/json' } : {}),
          },
          body: payload ? JSON.stringify(payload) : undefined,
        });
      },
    };
  }

  return {
    base,
    login,
    close: () => new Promise((resolve) => app.close(resolve)),
  };
}
