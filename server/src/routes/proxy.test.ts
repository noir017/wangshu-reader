// @vitest-environment node
import { createHash } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Hono } from 'hono';
import { afterAll, describe, expect, it } from 'vitest';
import { j, listen, makeApp } from '../test-utils';
import { blockReason, hostAllowed } from './proxy';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

const servers: http.Server[] = [];
afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
});

/** 起一个本地上游；handler 拿到完整请求体后应答 */
async function upstream(handler: (req: Seen, res: ServerResponse) => void): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const s: Seen = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) };
      seen.push(s);
      handler(s, res);
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const px = (app: Hono, target: string, init: RequestInit = {}) =>
  app.request(`/api/proxy?url=${encodeURIComponent(target)}`, init);

describe('开放策略', () => {
  it('auto：本机或带令牌才开放；经反向代理（带 X-Forwarded-For）视为非本机', async () => {
    const up = await upstream((_r, res) => res.end('ok'));
    const { app } = makeApp();
    expect((await px(app, up.url)).status).toBe(200);
    const remote = await px(app, up.url, { headers: { 'X-Forwarded-For': '1.2.3.4' } });
    expect(remote.status).toBe(403);
    expect((await j<{ error: string }>(remote)).error).toMatch(/MR_TOKEN/);
    expect(remote.headers.get('X-Proxy-Error')).toBe('1');
    // 设了令牌：远程请求带令牌即可
    const t = makeApp({ MR_TOKEN: 'k' }).app;
    expect((await px(t, up.url, { headers: { 'X-Forwarded-For': '1.2.3.4', Authorization: 'Bearer k' } })).status).toBe(200);
    expect((await px(t, up.url, { headers: { 'X-Forwarded-For': '1.2.3.4' } })).status).toBe(401);
  });

  it('on 一律开放，off 一律关闭；health 的 features.proxy 随之变化', async () => {
    const up = await upstream((_r, res) => res.end('ok'));
    const on = makeApp({ MR_PROXY: 'on' }).app;
    expect((await px(on, up.url, { headers: { 'X-Forwarded-For': '1.2.3.4' } })).status).toBe(200);
    const off = makeApp({ MR_PROXY: 'off' }).app;
    expect((await px(off, up.url)).status).toBe(403);
    const health = async (app: Hono, h: Record<string, string> = {}) => (await j<{ features: { proxy: boolean } }>(await app.request('/api/health', { headers: h }))).features.proxy;
    expect(await health(on)).toBe(true);
    expect(await health(off)).toBe(false);
    expect(await health(makeApp().app)).toBe(true);
    expect(await health(makeApp().app, { 'X-Forwarded-For': '1.2.3.4' })).toBe(false);
  });

  it('参数错误：缺 url、不是 http(s)、方法不允许', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/proxy')).status).toBe(400);
    expect((await px(app, 'not a url')).status).toBe(400);
    expect((await px(app, 'file:///etc/passwd')).status).toBe(400);
    expect((await px(app, 'ftp://example.com/x')).status).toBe(400);
    expect((await px(app, 'http://127.0.0.1:1/', { method: 'POST', headers: { 'X-Proxy-Method': 'TRACE' } })).status).toBe(400);
    expect((await px(app, 'http://127.0.0.1:1/', { method: 'POST', headers: { 'X-Proxy-Method': 'CONNECT' } })).status).toBe(400);
  });
});

describe('请求头映射', () => {
  it('白名单头转发；X-Proxy-Authorization/Cookie/User-Agent 映射；其余（含调用方自己的 Authorization、Cookie）不转发', async () => {
    const up = await upstream((_r, res) => res.end('ok'));
    const { app } = makeApp({ MR_TOKEN: 'srv-token' });
    await px(app, `${up.url}/p?q=1`, {
      headers: {
        Authorization: 'Bearer srv-token',
        Cookie: 'session=browser',
        Accept: 'application/atom+xml',
        Range: 'bytes=0-9',
        Depth: '1',
        'X-Proxy-Authorization': 'Basic dXNlcjpwYXNz',
        'X-Proxy-Cookie': 'a=b',
        'X-Proxy-User-Agent': 'Aldiko/1.0',
        'X-Custom': 'nope',
        Origin: 'http://evil.test',
      },
    });
    const h = up.seen[0].headers;
    expect(up.seen[0].url).toBe('/p?q=1');
    expect(h.authorization).toBe('Basic dXNlcjpwYXNz');
    expect(h.cookie).toBe('a=b');
    expect(h['user-agent']).toBe('Aldiko/1.0');
    expect(h.accept).toBe('application/atom+xml');
    expect(h.range).toBe('bytes=0-9');
    expect(h.depth).toBe('1');
    expect(h['accept-encoding']).toBe('identity');
    expect(h['x-custom']).toBeUndefined();
    expect(h.origin).toBeUndefined();
    expect(h['x-proxy-authorization']).toBeUndefined();
  });

  it('不带 X-Proxy-User-Agent 时用默认 UA（MR_PROXY_USER_AGENT 可改）；URL 里的 user:pass 变 Basic 认证', async () => {
    const up = await upstream((_r, res) => res.end('ok'));
    await px(makeApp().app, up.url);
    expect(up.seen[0].headers['user-agent']).toMatch(/MoonReaderWeb/);
    await px(makeApp({ MR_PROXY_USER_AGENT: 'MyUA' }).app, up.url);
    expect(up.seen[1].headers['user-agent']).toBe('MyUA');
    await px(makeApp().app, up.url.replace('http://', 'http://us%40er:p%3Aw@'));
    expect(up.seen[2].headers.authorization).toBe(`Basic ${Buffer.from('us@er:p:w').toString('base64')}`);
  });
});

describe('方法与请求体', () => {
  it('POST JSON 体原样到达；PROPFIND/MKCOL/MOVE/COPY 带 Depth、Destination 与 XML 体', async () => {
    const up = await upstream((r, res) => res.writeHead(207, { 'Content-Type': 'application/xml', DAV: '1' }).end(`<r method="${r.method}"/>`));
    const { app } = makeApp();
    const post = await px(app, up.url, { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, body: '{"a":"中"}' });
    expect(post.status).toBe(207);
    expect(up.seen[0].method).toBe('POST');
    expect(up.seen[0].body.toString()).toBe('{"a":"中"}');
    expect(up.seen[0].headers['content-type']).toBe('application/json;charset=UTF-8');
    expect(up.seen[0].headers['content-length']).toBe(String(Buffer.byteLength('{"a":"中"}'))); // 缓冲转发，带准确长度

    const xml = '<?xml version="1.0"?><a:propfind xmlns:a="DAV:"><a:allprop/></a:propfind>';
    const pf = await px(app, `${up.url}/dav/`, { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'text/xml' }, body: xml });
    expect(await pf.text()).toBe('<r method="PROPFIND"/>');
    expect(pf.headers.get('DAV')).toBe('1');
    expect(up.seen[1]).toMatchObject({ method: 'PROPFIND', url: '/dav/' });
    expect(up.seen[1].headers.depth).toBe('1');
    expect(up.seen[1].body.toString()).toBe(xml);

    await px(app, `${up.url}/dav/new`, { method: 'MKCOL' });
    expect(up.seen[2]).toMatchObject({ method: 'MKCOL', body: Buffer.alloc(0) });
    await px(app, `${up.url}/dav/a`, { method: 'MOVE', headers: { Destination: `${up.url}/dav/b`, Overwrite: 'T' } });
    expect(up.seen[3].headers.destination).toBe(`${up.url}/dav/b`);
    expect(up.seen[3].headers.overwrite).toBe('T');
    await px(app, `${up.url}/dav/a`, { method: 'COPY', headers: { Destination: `/api/proxy?url=${encodeURIComponent(`${up.url}/dav/c`)}` } });
    expect(up.seen[4].headers.destination).toBe(`${up.url}/dav/c`); // 指向本代理的 Destination 还原成真正目标
    await px(app, `${up.url}/x`, { method: 'POST', headers: { 'X-Proxy-Method': 'PROPFIND' } });
    expect(up.seen[5].method).toBe('PROPFIND');
  });

  it('大请求体与大响应体流式转发，内容完整', async () => {
    const hash = (b: Buffer) => createHash('sha1').update(b).digest('hex');
    const payload = Buffer.alloc(20 * 1024 * 1024);
    for (let i = 0; i < payload.length; i += 4096) payload.writeUInt32LE(i, i);
    const up = await upstream((r, res) => res.writeHead(200, { 'Content-Type': 'application/octet-stream', ETag: `"${hash(r.body)}"` }).end(r.method === 'POST' ? payload : 'ok'));
    const { app } = makeApp();
    const srv = await listen(app);
    try {
      const res = await fetch(`${srv.url}/api/proxy?url=${encodeURIComponent(up.url)}`, { method: 'POST', body: payload });
      expect(res.headers.get('ETag')).toBe(`"${hash(payload)}"`);
      expect(hash(Buffer.from(await res.arrayBuffer()))).toBe(hash(payload));
      expect(up.seen[0].body.length).toBe(payload.length);
    } finally {
      await srv.close();
    }
  });
});

describe('响应', () => {
  it('状态码原样；保留白名单响应头；WWW-Authenticate / Set-Cookie 改名；带最终 URL', async () => {
    const up = await upstream((r, res) => {
      if (r.url === '/401') return res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"', 'Set-Cookie': ['a=1; Path=/', 'b=2'] }).end('no');
      if (r.url === '/file') return res.writeHead(200, { 'Content-Type': 'application/epub+zip', 'Content-Disposition': 'attachment; filename="b.epub"', ETag: '"e1"', 'Last-Modified': 'Wed, 21 Oct 2026 07:28:00 GMT', 'X-Secret': 'no', 'Content-Security-Policy': 'default-src none', 'Strict-Transport-Security': 'max-age=1' }).end('EPUB');
      if (r.url === '/range') return res.writeHead(206, { 'Content-Range': 'bytes 2-3/10', 'Content-Type': 'text/plain', 'Accept-Ranges': 'bytes' }).end('cd');
      if (r.url === '/204') return res.writeHead(204).end();
      if (r.url === '/304') return res.writeHead(304, { ETag: '"e1"' }).end();
      res.writeHead(404).end('nf');
    });
    const { app } = makeApp();
    const r401 = await px(app, `${up.url}/401`);
    expect(r401.status).toBe(401);
    expect(r401.headers.get('WWW-Authenticate')).toBeNull(); // 不能让浏览器弹登录框
    expect(r401.headers.get('X-Proxy-WWW-Authenticate')).toBe('Basic realm="x"');
    expect(r401.headers.get('X-Proxy-Set-Cookie')).toContain('a=1; Path=/');
    const file = await px(app, `${up.url}/file`);
    expect(await file.text()).toBe('EPUB');
    expect(file.headers.get('Content-Type')).toBe('application/epub+zip');
    expect(file.headers.get('Content-Disposition')).toBe('attachment; filename="b.epub"');
    expect(file.headers.get('ETag')).toBe('"e1"');
    expect(file.headers.get('X-Secret')).toBeNull();
    expect(file.headers.get('Content-Security-Policy')).toBeNull();
    expect(file.headers.get('Strict-Transport-Security')).toBeNull();
    expect(file.headers.get('X-Proxy-Final-Url')).toBe(`${up.url}/file`);
    const rg = await px(app, `${up.url}/range`, { headers: { Range: 'bytes=2-3' } });
    expect(rg.status).toBe(206);
    expect(rg.headers.get('Content-Range')).toBe('bytes 2-3/10');
    expect((await px(app, `${up.url}/204`)).status).toBe(204);
    expect((await px(app, `${up.url}/304`)).status).toBe(304);
    expect((await px(app, `${up.url}/nope`)).status).toBe(404);
    const head = await px(app, `${up.url}/file`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('最终 URL 不泄露 URL 里的 user:pass', async () => {
    const up = await upstream((_r, res) => res.end('ok'));
    const r = await px(makeApp().app, up.url.replace('http://', 'http://u:p@'));
    expect(r.headers.get('X-Proxy-Final-Url')).toBe(`${up.url}/`);
  });
});

describe('重定向', () => {
  it('跟随 301/302，给出最终 URL；相对 Location 按当前 URL 解析', async () => {
    const up = await upstream((r, res) => {
      if (r.url === '/a') return res.writeHead(302, { Location: '/b' }).end();
      if (r.url === '/b') return res.writeHead(301, { Location: `${up.url}/c?x=1` }).end();
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`at ${r.url}`);
    });
    const res = await px(makeApp().app, `${up.url}/a`);
    expect(await res.text()).toBe('at /c?x=1');
    expect(res.headers.get('X-Proxy-Final-Url')).toBe(`${up.url}/c?x=1`);
  });

  it('303 与 301/302+POST 改 GET 并去掉请求体；307/308 保持方法与请求体', async () => {
    const up = await upstream((r, res) => {
      const m = /^\/(\d+)$/.exec(r.url);
      if (m) return res.writeHead(Number(m[1]), { Location: '/final' }).end();
      res.end('done');
    });
    const { app } = makeApp();
    for (const code of [301, 302, 303]) {
      up.seen.length = 0;
      await px(app, `${up.url}/${code}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'payload' });
      expect(up.seen.at(-1), String(code)).toMatchObject({ method: 'GET', url: '/final' });
      expect(up.seen.at(-1)!.body.length).toBe(0);
      expect(up.seen.at(-1)!.headers['content-type']).toBeUndefined();
    }
    for (const code of [307, 308]) {
      up.seen.length = 0;
      await px(app, `${up.url}/${code}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'payload' });
      expect(up.seen.at(-1), String(code)).toMatchObject({ method: 'PUT', url: '/final' });
      expect(up.seen.at(-1)!.body.toString()).toBe('payload');
    }
  });

  it('跨主机重定向不带凭据，同主机保留；重定向过多 502', async () => {
    const target = await upstream((_r, res) => res.end('target'));
    const up = await upstream((r, res) => {
      if (r.url === '/cross') return res.writeHead(302, { Location: target.url.replace('127.0.0.1', 'localhost') }).end();
      if (r.url === '/same') return res.writeHead(302, { Location: '/landing' }).end();
      if (r.url === '/loop') return res.writeHead(302, { Location: '/loop' }).end();
      res.end('landing');
    });
    const { app } = makeApp({ MR_PROXY_MAX_REDIRECTS: '3' });
    const h = { 'X-Proxy-Authorization': 'Basic c2VjcmV0', 'X-Proxy-Cookie': 'sid=1' };
    await px(app, `${up.url}/cross`, { headers: h });
    expect(target.seen[0].headers.authorization).toBeUndefined();
    expect(target.seen[0].headers.cookie).toBeUndefined();
    await px(app, `${up.url}/same`, { headers: h });
    expect(up.seen.at(-1)!.headers.authorization).toBe('Basic c2VjcmV0');
    const loop = await px(app, `${up.url}/loop`);
    expect(loop.status).toBe(502);
    expect((await j<{ error: string }>(loop)).error).toMatch(/重定向超过 3 次/);
  });
});

describe('错误', () => {
  it('连接被拒 / 找不到主机 / 超时 的状态码与中文提示', async () => {
    const { app } = makeApp();
    const refused = await px(app, 'http://127.0.0.1:1/');
    expect(refused.status).toBe(502);
    expect((await j<{ error: string }>(refused)).error).toMatch(/拒绝连接/);
    const nx = await px(app, 'http://no-such-host.invalid/');
    expect(nx.status).toBe(502);
    expect((await j<{ error: string }>(nx)).error).toMatch(/找不到主机/);
    const slow = await upstream(() => undefined); // 永不应答
    const t = await px(app, slow.url, { headers: { 'X-Proxy-Timeout': '0.3' } });
    expect(t.status).toBe(504);
    expect((await j<{ error: string }>(t)).error).toMatch(/超时/);
  });
});

describe('SSRF 防护', () => {
  it('链路本地/云元数据地址永远禁止（包括 IPv4 映射的 IPv6 写法）', async () => {
    const { app } = makeApp();
    for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://[::ffff:169.254.169.254]/', 'http://100.100.100.200/', 'http://[fe80::1]/', 'http://0.0.0.0/']) {
      const r = await px(app, u);
      expect(r.status, u).toBe(403);
    }
  });

  it('重定向到禁止地址同样被拦', async () => {
    const up = await upstream((_r, res) => res.writeHead(302, { Location: 'http://169.254.169.254/latest' }).end());
    const r = await px(makeApp().app, up.url);
    expect(r.status).toBe(403);
  });

  it('MR_PROXY_BLOCK_PRIVATE=1：回环/内网地址与解析到内网的域名都禁止', async () => {
    const up = await upstream((_r, res) => res.end('ok'));
    const { app } = makeApp({ MR_PROXY_BLOCK_PRIVATE: '1' });
    expect((await px(app, up.url)).status).toBe(403);
    expect((await px(app, up.url.replace('127.0.0.1', 'localhost'))).status).toBe(403); // 经 DNS 解析后拦截
    expect((await px(app, 'http://192.168.1.10/')).status).toBe(403);
    expect((await px(app, 'http://[::1]/')).status).toBe(403);
  });

  it('MR_PROXY_ALLOW_HOSTS：只允许列表内的主机（含子域），重定向出去的也要在列表内', async () => {
    const up = await upstream((_r, res) => res.writeHead(302, { Location: 'http://not-allowed.test/' }).end());
    const { app } = makeApp({ MR_PROXY_ALLOW_HOSTS: '127.0.0.1, example.org' });
    expect((await px(app, 'http://other.test/')).status).toBe(403);
    const r = await px(app, up.url);
    expect(r.status).toBe(403);
    expect((await j<{ error: string }>(r)).error).toMatch(/不在允许列表/);
  });

  it('blockReason / hostAllowed 单元', () => {
    const open = { blockPrivate: false };
    const strict = { blockPrivate: true };
    expect(blockReason('8.8.8.8', strict)).toBeNull();
    expect(blockReason('169.254.1.1', open)).toBeTruthy();
    expect(blockReason('::ffff:169.254.169.254', open)).toBeTruthy();
    expect(blockReason('224.0.0.1', open)).toBeTruthy();
    expect(blockReason('127.0.0.1', open)).toBeNull();
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '100.64.0.1', '::1', 'fd12::1', '::ffff:10.0.0.1']) expect(blockReason(ip, strict), ip).toBeTruthy();
    expect(blockReason('172.32.0.1', strict)).toBeNull();
    expect(blockReason('2606:4700::1111', strict)).toBeNull();
    expect(hostAllowed('a.example.com', ['example.com'])).toBe(true);
    expect(hostAllowed('example.com', ['example.com'])).toBe(true);
    expect(hostAllowed('badexample.com', ['example.com'])).toBe(false);
    expect(hostAllowed('example.com', ['*.example.com'])).toBe(false);
    expect(hostAllowed('x.example.com', ['*.example.com'])).toBe(true);
    expect(hostAllowed('anything', [])).toBe(true);
  });
});

// 联网的冒烟（默认跳过）：MR_TEST_NET=1 vitest run server/src/routes/proxy.test.ts
describe.skipIf(!process.env.MR_TEST_NET)('联网：真实 OPDS', () => {
  it('Project Gutenberg OPDS 首页（http 会被 301/302 到 https，最终 URL 在 X-Proxy-Final-Url）', async () => {
    const res = await px(makeApp().app, 'http://www.gutenberg.org/ebooks.opds/');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Proxy-Final-Url')).toMatch(/^https:\/\/www\.gutenberg\.org\/ebooks\.opds\/?$/);
    expect(await res.text()).toContain('<feed');
  }, 30_000);
});
