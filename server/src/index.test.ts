// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { HealthResponse } from '@shared/api';
import { j, makeApp, put, tmp } from './test-utils';

describe('/api/health', () => {
  it('回报名字、版本与按实际探测的 features', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const h = await j<HealthResponse>(res);
    expect(h).toMatchObject({ ok: true, name: 'moonreader-web-server' });
    expect(typeof h.version).toBe('string');
    expect(h.features).toMatchObject({ dav: true, dict: true, translate: true, library: false, upload: false, proxy: true });
    // 7z 是否存在由探测决定，不写死
    expect(typeof h.features.convert).toBe('boolean');
    expect(typeof h.features['convert.djvu']).toBe('boolean');
  });

  it('配置了书库才报 library/upload；只读书库不报 upload', async () => {
    const lib = tmp();
    expect((await j<HealthResponse>(await makeApp({ MR_LIBRARY_DIR: lib }).app.request('/api/health'))).features).toMatchObject({ library: true, upload: true });
    expect((await j<HealthResponse>(await makeApp({ MR_LIBRARY_DIR: lib, MR_LIBRARY_READONLY: '1' }).app.request('/api/health'))).features).toMatchObject({ library: true, upload: false });
  });

  it('MR_DAV=0 关闭内置 WebDAV，MR_PROXY=off 关闭代理', async () => {
    const { app } = makeApp({ MR_DAV: '0', MR_PROXY: 'off' });
    const h = await j<HealthResponse>(await app.request('/api/health'));
    expect(h.features).toMatchObject({ dav: false, proxy: false });
    expect((await app.request('/dav/', { method: 'PROPFIND' })).status).toBe(404);
  });

  it('外部命令不存在时对应能力为 false（MR_BIN_* 指到不存在的路径）', async () => {
    const prev = { a: process.env.MR_BIN_7Z, b: process.env.MR_BIN_7ZZ, c: process.env.MR_BIN_7ZA };
    process.env.MR_BIN_7Z = process.env.MR_BIN_7ZZ = process.env.MR_BIN_7ZA = '/nonexistent/7z';
    try {
      const { app } = makeApp();
      expect((await j<HealthResponse>(await app.request('/api/health'))).features.convert).toBe(false);
      const res = await app.request('/api/convert?to=cbz&name=a.cbr', { method: 'POST', body: 'x' });
      expect(res.status).toBe(501);
    } finally {
      for (const [k, v] of [['MR_BIN_7Z', prev.a], ['MR_BIN_7ZZ', prev.b], ['MR_BIN_7ZA', prev.c]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('令牌鉴权（MR_TOKEN）', () => {
  const tokenApp = () => makeApp({ MR_TOKEN: 's3cret' }).app;

  it('/api/* 需要令牌，health 例外；Bearer / ?token= / Basic 都行', async () => {
    const app = tokenApp();
    expect((await app.request('/api/health')).status).toBe(200);
    const none = await app.request('/api/dict/sources');
    expect(none.status).toBe(401);
    expect(await j(none)).toEqual({ error: 'unauthorized' });
    expect((await app.request('/api/dict/sources', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await app.request('/api/dict/sources', { headers: { Authorization: 'Bearer s3cret' } })).status).toBe(200);
    expect((await app.request('/api/dict/sources?token=s3cret')).status).toBe(200);
    expect((await app.request('/api/dict/sources', { headers: { Authorization: `Basic ${Buffer.from('u:s3cret').toString('base64')}` } })).status).toBe(200);
  });

  it('/dav 未授权返回 401 + WWW-Authenticate: Basic（WebDAV 客户端据此弹登录）', async () => {
    const app = tokenApp();
    const res = await app.request('/dav/', { method: 'PROPFIND' });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/^Basic /);
    const ok = await app.request('/dav/', { method: 'PROPFIND', headers: { Authorization: `Basic ${Buffer.from('x:s3cret').toString('base64')}`, Depth: '0' } });
    expect(ok.status).toBe(207);
  });

  it('预检请求不需要令牌', async () => {
    const res = await tokenApp().request('/api/library/list', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });
});

describe('CORS', () => {
  it('file:// 打开的单文件版 Origin 为 null 也能用；暴露 X-Proxy-Final-Url 等头', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/health', { headers: { Origin: 'null' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('null');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Proxy-Final-Url');
    const pre = await app.request('/api/proxy', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PROPFIND', 'Access-Control-Request-Headers': 'x-proxy-authorization,depth' } });
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('PROPFIND');
  });

  it('/dav 的 OPTIONS：不带 Origin 是 WebDAV 能力探测，带预检头才是 CORS 预检', async () => {
    const { app } = makeApp();
    const probe = await app.request('/dav/', { method: 'OPTIONS' });
    expect(probe.status).toBe(200);
    expect(probe.headers.get('DAV')).toContain('1');
    const pre = await app.request('/dav/', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PROPFIND' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});

describe('没有令牌时的跨站防护（originGuard）', () => {
  const get = (app: ReturnType<typeof makeApp>['app'], origin?: string, extra: Record<string, string> = {}) =>
    app.request('/api/dict/sources', { headers: { ...(origin ? { Origin: origin } : {}), ...extra } });

  it('别的网站的 Origin 被拒（读书库/用代理的 drive-by 攻击）；本机、null、IP、同 Host 放行', async () => {
    const { app } = makeApp();
    expect((await get(app, 'https://evil.example')).status).toBe(403);
    expect((await get(app, 'http://evil.example:8090', { Host: '127.0.0.1:8090' })).status).toBe(403);
    expect((await get(app, 'https://evil.example', { 'X-Forwarded-Host': 'books.example.com' })).status).toBe(403);
    expect((await get(app)).status).toBe(200); // curl / WebDAV 客户端不带 Origin
    expect((await get(app, 'null')).status).toBe(200); // file:// 打开的单文件版
    expect((await get(app, 'http://localhost:5173')).status).toBe(200);
    expect((await get(app, 'http://127.0.0.1:5181')).status).toBe(200);
    expect((await get(app, 'http://[::1]:5173')).status).toBe(200);
    expect((await get(app, 'http://192.168.1.5:8080')).status).toBe(200);
    expect((await get(app, 'https://books.example.com', { Host: 'books.example.com' })).status).toBe(200); // 服务端自己托管的前端
    expect((await get(app, 'https://books.example.com', { 'X-Forwarded-Host': 'books.example.com', Host: '127.0.0.1:8090' })).status).toBe(200); // 反代
  });

  it('预检、/dav、/api/proxy 同样受保护', async () => {
    const { app } = makeApp();
    const pre = await app.request('/api/proxy', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
    expect(pre.status).toBe(403);
    expect((await app.request('/dav/', { method: 'PROPFIND', headers: { Origin: 'https://evil.example', Depth: '0' } })).status).toBe(403);
    expect((await app.request('/api/proxy?url=http%3A%2F%2F127.0.0.1%3A1%2F', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('设了 MR_TOKEN 就不做这个检查（令牌本身就是防护）', async () => {
    const { app } = makeApp({ MR_TOKEN: 'k' });
    expect((await get(app, 'https://anywhere.example', { Authorization: 'Bearer k' })).status).toBe(200);
  });
});

describe('路由兜底与静态文件', () => {
  it('未知 /api 路径返回 JSON 404，而不是 SPA 页面', async () => {
    const { app } = makeApp({ MR_STATIC_DIR: (() => { const d = tmp(); put(d, 'index.html', '<html>spa</html>'); return d; })() });
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await j(res)).toEqual({ error: 'not found' });
  });

  it('托管 dist：文件原样给，未知路径回退 index.html，路径穿越不会读到目录外', async () => {
    const outer = tmp();
    put(outer, 'secret.txt', 'TOP SECRET');
    const dist = tmp();
    put(dist, 'index.html', '<html>spa</html>');
    put(dist, 'assets/app.js', 'console.log(1)');
    const { app } = makeApp({ MR_STATIC_DIR: dist });
    expect(await (await app.request('/assets/app.js')).text()).toBe('console.log(1)');
    expect(await (await app.request('/some/spa/route')).text()).toBe('<html>spa</html>');
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', `/..%2f${outer.split('/').pop()}/secret.txt`]) {
      expect(await (await app.request(p)).text()).not.toContain('TOP SECRET');
    }
  });
});
