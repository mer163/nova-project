import { seedIfEmpty } from './lib/seed.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 3000);

if (seedIfEmpty()) console.log('[seed] 已写入演示数据');

const server = createApp();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nova 演示环境运行在 http://localhost:${PORT}`);
  console.log('演示账号见 README，统一初始密码通过 NOVA_SEED_PASSWORD 覆盖');
});

export { server };
