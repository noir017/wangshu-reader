// 服务端入口：提供浏览器做不到的功能（跨域代理、格式转换、WebDAV 中转、朗读等），并托管前端静态文件。
// 路由按功能拆在 routes/*.ts，每个文件导出 route.register(app, ctx)；在下面的 ROUTES 里登记。
import type { HealthResponse } from '@shared/api';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig, type ServerConfig } from './config';
import * as convert from './routes/convert';
import * as dav from './routes/dav';
import * as dict from './routes/dict';
import * as fonts from './routes/fonts';
import * as library from './routes/library';
import * as proxy from './routes/proxy';
import * as transfer from './routes/transfer';
import * as translate from './routes/translate';
import * as tts from './routes/tts';
import { isAuthorized } from './util/auth';
import { rarTmp } from './lib/rar';
import { cleanStaleTmp } from './util/body';
import { davCors, originGuard } from './util/cors';

export interface ServerContext {
  config: ServerConfig;
}

export type RouteModule = { register(app: Hono, ctx: ServerContext): void };

// 新增路由模块：在 routes/ 下建文件并加到这里
const ROUTES: RouteModule[] = [
  convert.route,
  proxy.route,
  dav.route,
  tts.route,
  translate.route,
  dict.route,
  library.route,
  transfer.route,
  fonts.route,
];

const API_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK'];
const EXPOSED_HEADERS = [
  'Content-Disposition',
  'Content-Length',
  'Content-Range',
  'Content-Type',
  'ETag',
  'Last-Modified',
  'Accept-Ranges',
  'X-Total-Count',
  'X-Truncated',
  'X-Proxy-Final-Url',
  'X-Proxy-WWW-Authenticate',
  'X-Proxy-Set-Cookie',
  'X-Proxy-Error',
  'X-Tts-Engine',
  'X-Tts-Voice',
  'DAV',
  'Lock-Token',
];

export function createApp(config: ServerConfig): Hono {
  const app = new Hono();
  const ctx: ServerContext = { config };
  rarTmp.dir = config.tmpDir;

  // 没有令牌时挡掉别的网站发来的跨站请求（见 originGuard 的说明）；预检也要挡，浏览器才不会发后续请求
  if (!config.token) {
    for (const p of ['/api/*', '/dav', '/dav/*']) app.use(p, originGuard());
  }
  // 单文件 html 从 file:// 打开时 Origin 为 null，所以 API 默认放开 CORS；鉴权靠可选的 token
  app.use('/api/*', cors({ origin: (o) => o || '*', allowMethods: API_METHODS, exposeHeaders: EXPOSED_HEADERS, maxAge: 86400 }));
  // /dav 的 OPTIONS 既是 CORS 预检也是 WebDAV 能力探测，不能交给通用 cors 中间件一刀切
  app.use('/dav', davCors(EXPOSED_HEADERS, API_METHODS));
  app.use('/dav/*', davCors(EXPOSED_HEADERS, API_METHODS));

  app.use('/api/*', async (c, next) => {
    if (!config.token || c.req.path === '/api/health') return next();
    if (isAuthorized(config, c)) return next();
    return c.json({ error: 'unauthorized' }, 401);
  });
  const davAuth: MiddlewareHandler = async (c, next) => {
    if (!config.token || isAuthorized(config, c)) return next();
    // WebDAV 客户端靠 WWW-Authenticate 知道要用 Basic 认证（用户名随意，密码填 MR_TOKEN）
    return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Basic realm="Moon+ Reader Web", charset="UTF-8"' });
  };
  app.use('/dav', davAuth);
  app.use('/dav/*', davAuth);

  for (const r of ROUTES) r.register(app, ctx);

  app.get('/api/health', (c) => {
    const body: HealthResponse = {
      ok: true,
      name: 'moonreader-web-server',
      version: config.version,
      // 代理是否可用取决于调用方（本机 / 带令牌），所以逐请求计算
      features: { ...config.features, proxy: proxy.proxyAllowed(config, c) },
    };
    return c.json(body);
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    // 客户端中途断开（上传到一半、下载取消）不是服务端的错，别刷日志
    if ((err as NodeJS.ErrnoException).code === 'ECONNRESET' || err.message === 'aborted') return c.body(null, 499 as never);
    console.error(`[server] ${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: err.message || 'internal error' }, 500);
  });

  // 未知的 /api 路径返回 JSON 404，别落到下面的 SPA 回退
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  if (config.staticDir) {
    app.use('/*', serveStatic({ root: config.staticDir }));
    app.get('*', serveStatic({ root: config.staticDir, path: 'index.html' }));
  }
  return app;
}

const isLoopback = (h: string) => h === '127.0.0.1' || h === 'localhost' || h === '::1';

// 直接运行（tsx / node dist-server/index.mjs）时启动监听
if (process.argv[1] && (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) || process.argv[1].endsWith('index.mjs'))) {
  const config = loadConfig();
  const app = createApp(config);
  void cleanStaleTmp(config.tmpDir);
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(`[server] listening on http://${info.address}:${info.port} static=${config.staticDir ?? '-'} data=${config.dataDir}`);
    console.log(
      `[server] features: ${Object.entries(config.features)
        .map(([k, v]) => `${k}=${k === 'proxy' ? `${v ? config.proxy.mode : 'off'}` : v ? 'on' : 'off'}`)
        .join(' ')}`,
    );
    if (config.libraryRoots.length) console.log(`[server] library: ${config.libraryRoots.map((r) => `${r.name}=${r.dir}`).join(' ')}${config.libraryReadonly ? ' (readonly)' : ''}`);
    if (!config.token && !isLoopback(config.host)) {
      console.warn('[server] 警告：监听在非本机地址但没有设置 MR_TOKEN —— 书库读写、/dav 对网络上所有人开放；/api/proxy 仅本机可用（MR_PROXY=on 可强制开放，不建议）');
    }
  });
  // 大文件上传（书、备份）可能超过 Node 默认 5 分钟的整体请求超时
  const s = server as import('node:http').Server;
  s.requestTimeout = 0;
  s.keepAliveTimeout = 65_000;
}
