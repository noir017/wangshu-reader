// 服务端入口：提供浏览器做不到的功能（跨域代理、格式转换、WebDAV 中转、朗读等），并托管前端静态文件。
// 路由按功能拆在 routes/*.ts，每个文件导出 register(app, ctx)；在下面的 ROUTES 里登记。
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { loadConfig, type ServerConfig } from './config';

export interface ServerContext {
  config: ServerConfig;
}

export type RouteModule = { register(app: Hono, ctx: ServerContext): void };

// 新增路由模块：在 routes/ 下建文件并加到这里
const ROUTES: RouteModule[] = [];

export function createApp(config: ServerConfig): Hono {
  const app = new Hono();
  const ctx: ServerContext = { config };

  // 单文件 html 从 file:// 打开时 Origin 为 null，所以 API 默认放开 CORS；鉴权靠可选的 token
  app.use('/api/*', cors({ origin: (o) => o || '*', exposeHeaders: ['Content-Disposition', 'X-Total-Count'] }));
  app.use('/api/*', async (c, next) => {
    if (!config.token || c.req.path === '/api/health') return next();
    const auth = c.req.header('Authorization') ?? '';
    const q = c.req.query('token');
    if (auth === `Bearer ${config.token}` || q === config.token) return next();
    return c.json({ error: 'unauthorized' }, 401);
  });

  app.get('/api/health', (c) =>
    c.json({ ok: true, name: 'moonreader-web-server', version: config.version, features: config.features }),
  );

  for (const r of ROUTES) r.register(app, ctx);

  app.onError((err, c) => {
    console.error(`[server] ${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: err.message || 'internal error' }, 500);
  });

  if (config.staticDir) {
    app.use('/*', serveStatic({ root: config.staticDir }));
    app.get('*', serveStatic({ root: config.staticDir, path: 'index.html' }));
  }
  return app;
}

// 直接运行（tsx / node dist-server/index.mjs）时启动监听
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('index.mjs')) {
  const config = loadConfig();
  const app = createApp(config);
  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(`[server] listening on http://${info.address}:${info.port} static=${config.staticDir ?? '-'}`);
  });
}
