// @vitest-environment node
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { createClient } from 'webdav';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { listen, makeApp, put, tmp } from '../test-utils';

const dav = (app: Hono, method: string, p: string, init: RequestInit = {}) => app.request(`/dav${p}`, { method, ...init });

describe('WebDAV 协议', () => {
  it('OPTIONS：声明 DAV 能力与支持的方法', async () => {
    const { app } = makeApp();
    const res = await dav(app, 'OPTIONS', '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('DAV')).toBe('1, 2');
    for (const m of ['PROPFIND', 'MKCOL', 'MOVE', 'COPY', 'PUT', 'DELETE', 'GET', 'HEAD']) expect(res.headers.get('Allow')).toContain(m);
  });

  it('MKCOL / PUT / GET / HEAD / Range / 覆盖 / DELETE 的状态码', async () => {
    const { app, config } = makeApp();
    expect((await dav(app, 'MKCOL', '/sync')).status).toBe(201);
    expect((await dav(app, 'MKCOL', '/sync')).status).toBe(405); // 已存在
    expect((await dav(app, 'MKCOL', '/a/b')).status).toBe(409); // 父目录不存在
    expect((await dav(app, 'PUT', '/sync/a%20b.json', { body: '0123456789' })).status).toBe(201);
    expect((await dav(app, 'PUT', '/sync/a%20b.json', { body: 'abcdefghij' })).status).toBe(204);
    expect((await dav(app, 'PUT', '/nope/x.json', { body: 'x' })).status).toBe(409);
    expect((await dav(app, 'PUT', '/sync', { body: 'x' })).status).toBe(405); // 目标是目录
    expect(readFileSync(path.join(config.dataDir, 'dav/sync/a b.json'), 'utf8')).toBe('abcdefghij');

    const get = await dav(app, 'GET', '/sync/a%20b.json');
    expect(await get.text()).toBe('abcdefghij');
    expect(get.headers.get('Content-Disposition')).toBeNull();
    const part = await dav(app, 'GET', '/sync/a%20b.json', { headers: { Range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe('cde');
    const head = await dav(app, 'HEAD', '/sync/a%20b.json');
    expect(head.headers.get('Content-Length')).toBe('10');
    expect((await dav(app, 'GET', '/sync/missing')).status).toBe(404);

    expect((await dav(app, 'DELETE', '/sync/a%20b.json')).status).toBe(204);
    expect((await dav(app, 'DELETE', '/sync/a%20b.json')).status).toBe(404);
    expect((await dav(app, 'DELETE', '/')).status).toBe(403);
  });

  it('If-None-Match: * / If-Match 的条件写入', async () => {
    const { app } = makeApp();
    await dav(app, 'PUT', '/f.txt', { body: 'v1' });
    expect((await dav(app, 'PUT', '/f.txt', { body: 'v2', headers: { 'If-None-Match': '*' } })).status).toBe(412);
    expect((await dav(app, 'PUT', '/f.txt', { body: 'v2', headers: { 'If-Match': '"wrong"' } })).status).toBe(412);
    const etag = (await dav(app, 'HEAD', '/f.txt')).headers.get('ETag')!;
    expect((await dav(app, 'PUT', '/f.txt', { body: 'v2', headers: { 'If-Match': etag } })).status).toBe(204);
    expect((await dav(app, 'PUT', '/new.txt', { body: 'x', headers: { 'If-None-Match': '*' } })).status).toBe(201);
  });

  it('PROPFIND：Depth 0/1，href 编码，目录带 collection，文件带长度/类型/etag；不存在 404', async () => {
    const { app } = makeApp();
    await dav(app, 'MKCOL', '/中文 目录');
    await dav(app, 'PUT', `/${encodeURIComponent('中文 目录')}/书 1.epub`, { body: 'abc' });
    await dav(app, 'MKCOL', `/${encodeURIComponent('中文 目录')}/sub`);
    const d0 = await (await dav(app, 'PROPFIND', `/${encodeURIComponent('中文 目录')}/`, { headers: { Depth: '0' } })).text();
    expect(d0.match(/<D:response>/g)).toHaveLength(1);
    expect(d0).toContain('<D:collection/>');
    const res = await dav(app, 'PROPFIND', `/${encodeURIComponent('中文 目录')}/`, { headers: { Depth: '1' } });
    expect(res.status).toBe(207);
    expect(res.headers.get('Content-Type')).toMatch(/xml/);
    const xml = await res.text();
    expect(xml.match(/<D:response>/g)).toHaveLength(3);
    expect(xml).toContain(`<D:href>/dav/${encodeURIComponent('中文 目录')}/${encodeURIComponent('书 1.epub')}</D:href>`);
    expect(xml).toContain(`<D:href>/dav/${encodeURIComponent('中文 目录')}/sub/</D:href>`);
    expect(xml).toContain('<D:getcontentlength>3</D:getcontentlength>');
    expect(xml).toContain('<D:getcontenttype>application/epub+zip</D:getcontenttype>');
    expect(xml).toMatch(/<D:getetag>"[0-9a-f-]+"<\/D:getetag>/);
    expect(xml).toContain('<D:displayname>书 1.epub</D:displayname>');
    expect((await dav(app, 'PROPFIND', '/missing/', { headers: { Depth: '1' } })).status).toBe(404);
    // 没带 Depth（默认 infinity）按 1 处理，不递归
    await dav(app, 'PUT', `/${encodeURIComponent('中文 目录')}/sub/deep.txt`, { body: 'x' });
    const inf = await (await dav(app, 'PROPFIND', `/${encodeURIComponent('中文 目录')}/`)).text();
    expect(inf).not.toContain('deep.txt');
  });

  it('X-Forwarded-Prefix：反向代理挂在子路径下时 href 带前缀', async () => {
    const { app } = makeApp();
    await dav(app, 'PUT', '/f.txt', { body: 'x' });
    const xml = await (await dav(app, 'PROPFIND', '/', { headers: { Depth: '1', 'X-Forwarded-Prefix': '/books' } })).text();
    expect(xml).toContain('<D:href>/books/dav/f.txt</D:href>');
  });

  it('COPY / MOVE：Destination 绝对 URL 或路径、Overwrite: F、目录整棵、父目录缺失 409', async () => {
    const { app, config } = makeApp();
    await dav(app, 'MKCOL', '/d');
    await dav(app, 'PUT', '/d/a.txt', { body: 'A' });
    await dav(app, 'PUT', '/other.txt', { body: 'O' });
    expect((await dav(app, 'COPY', '/d/a.txt', { headers: { Destination: 'http://localhost/dav/d/b.txt' } })).status).toBe(201);
    expect((await dav(app, 'COPY', '/d/a.txt', { headers: { Destination: '/dav/d/b.txt', Overwrite: 'F' } })).status).toBe(412);
    expect((await dav(app, 'COPY', '/d/a.txt', { headers: { Destination: '/dav/d/b.txt' } })).status).toBe(204);
    expect((await dav(app, 'COPY', '/d', { headers: { Destination: '/dav/d2' } })).status).toBe(201);
    expect(readFileSync(path.join(config.dataDir, 'dav/d2/b.txt'), 'utf8')).toBe('A');
    expect((await dav(app, 'MOVE', '/d/a.txt', { headers: { Destination: '/dav/moved.txt' } })).status).toBe(201);
    expect(existsSync(path.join(config.dataDir, 'dav/d/a.txt'))).toBe(false);
    expect((await dav(app, 'MOVE', '/moved.txt', { headers: { Destination: '/dav/other.txt' } })).status).toBe(204); // 覆盖已有
    expect(readFileSync(path.join(config.dataDir, 'dav/other.txt'), 'utf8')).toBe('A');
    expect((await dav(app, 'MOVE', '/other.txt', { headers: { Destination: '/dav/nodir/x.txt' } })).status).toBe(409);
    expect((await dav(app, 'MOVE', '/d', { headers: { Destination: '/dav/d/inside' } })).status).toBe(403);
    expect((await dav(app, 'MOVE', '/d', { headers: { Destination: '/elsewhere/x' } })).status).toBe(502);
    expect((await dav(app, 'MOVE', '/d')).status).toBe(400);
    expect((await dav(app, 'MOVE', '/nope', { headers: { Destination: '/dav/x' } })).status).toBe(404);
  });

  it('LOCK / UNLOCK 是假锁（Windows、macOS 客户端需要）；PROPPATCH 只回执', async () => {
    const { app } = makeApp();
    await dav(app, 'PUT', '/f.txt', { body: 'x' });
    const lock = await dav(app, 'LOCK', '/f.txt', { headers: { Timeout: 'Second-600' }, body: '<D:lockinfo xmlns:D="DAV:"/>' });
    expect(lock.status).toBe(200);
    expect(lock.headers.get('Lock-Token')).toMatch(/^<opaquelocktoken:/);
    expect(await lock.text()).toContain('Second-600');
    expect((await dav(app, 'UNLOCK', '/f.txt', { headers: { 'Lock-Token': lock.headers.get('Lock-Token')! } })).status).toBe(204);
    const pp = await dav(app, 'PROPPATCH', '/f.txt', { body: '<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:x"><D:set><D:prop><Z:Win32LastModifiedTime>x</Z:Win32LastModifiedTime></D:prop></D:set></D:propertyupdate>' });
    expect(pp.status).toBe(207);
    expect(await pp.text()).toContain('Z:Win32LastModifiedTime');
  });
});

describe('WebDAV 安全', () => {
  it('路径穿越、符号链接逃逸、临时文件后缀都拒绝', async () => {
    const outer = tmp();
    put(outer, 'secret.txt', 'TOP SECRET');
    const { app, config } = makeApp();
    const root = path.join(config.dataDir, 'dav');
    mkdirSync(root, { recursive: true });
    symlinkSync(outer, path.join(root, 'escape'));
    // %2e%2e 会被 URL 解析器当成 .. 提前规范化掉，请求落到 /dav 之外，总之读不到
    for (const p of ['/%2e%2e/%2e%2e/secret.txt', '/a%2F..%2F..%2Fsecret.txt', '/..%5C..%5Csecret.txt']) {
      const r = await dav(app, 'GET', p);
      expect(r.status, p).toBeGreaterThanOrEqual(400);
      expect(await r.text()).not.toContain('TOP SECRET');
    }
    expect((await dav(app, 'GET', '/escape/secret.txt')).status).toBe(403);
    expect((await dav(app, 'PUT', '/escape/new.txt', { body: 'x' })).status).toBeGreaterThanOrEqual(400);
    expect(existsSync(path.join(outer, 'new.txt'))).toBe(false);
    expect((await dav(app, 'PROPFIND', '/escape/', { headers: { Depth: '1' } })).status).toBe(403);
    expect((await dav(app, 'PUT', '/x.mr-part', { body: 'x' })).status).toBe(404);
    expect((await dav(app, 'COPY', '/escape/secret.txt', { headers: { Destination: '/dav/stolen.txt' } })).status).toBe(403);
    expect(existsSync(path.join(root, 'stolen.txt'))).toBe(false);
  });

  it('PUT 超过 MR_MAX_UPLOAD_MB → 413，不留半个文件', async () => {
    const { app, config } = makeApp({ MR_MAX_UPLOAD_MB: '0.001' });
    expect((await dav(app, 'PUT', '/big.bin', { body: new Uint8Array(5000) })).status).toBe(413);
    expect(readdirSync(path.join(config.dataDir, 'dav'))).toEqual([]);
  });
});

describe('用真正的 WebDAV 客户端（webdav 包）走一遍同步会用到的操作', () => {
  it('建目录、写读、列目录、stat、拷贝、移动、删除、带令牌（Basic，密码 = MR_TOKEN）', async () => {
    const { app, config } = makeApp({ MR_TOKEN: 'tok-123' });
    const srv = await listen(app);
    try {
      const anon = createClient(`${srv.url}/dav`);
      await expect(anon.getDirectoryContents('/')).rejects.toMatchObject({ status: 401 });
      const c = createClient(`${srv.url}/dav`, { username: 'me', password: 'tok-123' });
      expect(await c.exists('/Books')).toBe(false);
      await c.createDirectory('/Books/.Moon+', { recursive: true });
      expect(await c.exists('/Books/.Moon+')).toBe(true);
      await c.putFileContents('/Books/.Moon+/notes 1.an', '{"hello":"世界"}');
      expect(await c.getFileContents('/Books/.Moon+/notes 1.an', { format: 'text' })).toBe('{"hello":"世界"}');
      const big = Buffer.alloc(300_000, 7);
      await c.putFileContents('/Books/.Moon+/big.bin', big, { overwrite: true });
      expect(Buffer.from((await c.getFileContents('/Books/.Moon+/big.bin')) as ArrayBuffer).equals(big)).toBe(true);
      const list = (await c.getDirectoryContents('/Books/.Moon+')) as { basename: string; size: number; type: string }[];
      expect(list.map((f) => [f.basename, f.size, f.type]).sort()).toEqual([['big.bin', 300000, 'file'], ['notes 1.an', 18, 'file']].sort());
      const st = (await c.stat('/Books/.Moon+/big.bin')) as { size: number; mime?: string; lastmod: string };
      expect(st.size).toBe(300000);
      expect(Number.isNaN(Date.parse(st.lastmod))).toBe(false);
      await c.copyFile('/Books/.Moon+/big.bin', '/Books/copy.bin');
      await c.moveFile('/Books/copy.bin', '/Books/moved.bin');
      expect(await c.exists('/Books/copy.bin')).toBe(false);
      expect(readFileSync(path.join(config.dataDir, 'dav/Books/moved.bin')).length).toBe(300000);
      await c.deleteFile('/Books/moved.bin');
      expect(await c.exists('/Books/moved.bin')).toBe(false);
      await c.deleteFile('/Books');
      expect(await c.exists('/Books')).toBe(false);
    } finally {
      await srv.close();
    }
  });
});
