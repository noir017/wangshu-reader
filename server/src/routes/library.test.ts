// @vitest-environment node
import type { LibraryEntry, LibraryListResponse } from '@shared/api';
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync, existsSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { png, writeEpub, writeZip } from '../test-fixtures';
import { j, listen, makeApp, put, tmp } from '../test-utils';
import { find7z } from '../util/exec';

const has7z = !!find7z();

const post = (app: Hono, p: string, body: unknown) =>
  app.request(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const upload = (app: Hono, to: string, files: Record<string, string | Uint8Array<ArrayBuffer>>, query = '') => {
  const fd = new FormData();
  for (const [name, data] of Object.entries(files)) fd.append('file', new File([data], name));
  return app.request(`/api/library/upload?path=${encodeURIComponent(to)}${query}`, { method: 'POST', body: fd });
};

function sampleLib(): string {
  const lib = tmp('mr-lib-');
  put(lib, 'Books/b10.txt', 'ten');
  put(lib, 'Books/b2.txt', 'two');
  put(lib, 'Books/hello.txt', '你好，世界。\nHello, world.\n');
  put(lib, 'Books/page.html', '<script>alert(1)</script>');
  put(lib, '.hidden/secret.txt', 'hidden');
  put(lib, '中文目录/三体.txt', '科学边界');
  put(lib, 'Upload/.keep');
  return lib;
}

describe('列表', () => {
  it('目录在前、自然排序；隐藏项与上传临时文件默认不出现', async () => {
    const lib = sampleLib();
    put(lib, 'Books/.upload-abc.mr-part', 'x');
    put(lib, '.dot.txt', 'x');
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const root = await j<LibraryListResponse>(await app.request('/api/library/list?path='));
    expect(root.path).toBe('');
    expect(root.entries.map((e) => e.name)).toEqual(['Books', 'Upload', '中文目录']);
    const books = await j<LibraryListResponse>(await app.request('/api/library/list?path=Books'));
    expect(books.entries.map((e) => e.name)).toEqual(['b2.txt', 'b10.txt', 'hello.txt', 'page.html']);
    expect(books.entries[0]).toMatchObject({ path: 'Books/b2.txt', dir: false, size: 3 });
    expect(books.entries[0].mtime).toBeGreaterThan(1e12);
    const all = await j<LibraryListResponse>(await app.request('/api/library/list?path=&hidden=1'));
    expect(all.entries.map((e) => e.name)).toContain('.hidden');
    expect(all.entries.map((e) => e.name)).toContain('.dot.txt');
  });

  it('压缩包文件带 archive 标记；不存在的路径 404；文件当目录列 400', async () => {
    const lib = sampleLib();
    put(lib, 'a.cbz', 'x');
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const root = await j<LibraryListResponse>(await app.request('/api/library/list?path='));
    expect(root.entries.find((e) => e.name === 'a.cbz')?.archive).toBe(true);
    expect((await app.request('/api/library/list?path=nope')).status).toBe(404);
    expect((await app.request('/api/library/list?path=Books/hello.txt')).status).toBe(400);
  });

  it('没配置书库：503（health 的 library 为 false，前端据此置灰）', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/library/list?path=');
    expect(res.status).toBe(503);
    expect((await j<{ error: string }>(res)).error).toMatch(/MR_LIBRARY_DIR/);
  });

  it('多个书库根：根名作第一段路径，根列表是虚拟目录，不能在其中操作', async () => {
    const a = tmp('mr-a-');
    const b = tmp('mr-b-');
    put(a, 'x.txt', 'a');
    put(b, 'y/z.txt', 'b');
    const { app } = makeApp({ MR_LIBRARY_DIR: `${a}:${b}` });
    const root = await j<LibraryListResponse>(await app.request('/api/library/list?path='));
    expect(root.entries.map((e) => e.name)).toEqual([path.basename(a), path.basename(b)]);
    const inA = await j<LibraryListResponse>(await app.request(`/api/library/list?path=${path.basename(a)}`));
    expect(inA.entries[0].path).toBe(`${path.basename(a)}/x.txt`);
    expect(await (await app.request(`/api/library/file?path=${encodeURIComponent(`${path.basename(b)}/y/z.txt`)}`)).text()).toBe('b');
    expect((await post(app, '/api/library/mkdir', { path: 'newroot' })).status).toBe(404);
    expect((await upload(app, '', { 'a.txt': 'x' })).status).toBe(400);
    const found = await j<LibraryListResponse>(await app.request('/api/library/search?path=&q=z.txt'));
    expect(found.entries.map((e) => e.path)).toEqual([`${path.basename(b)}/y/z.txt`]);
  });
});

describe('文件内容', () => {
  it('Range / 416 / HEAD / 条件请求；脚本类文件强制下载并带沙箱头', async () => {
    const { app } = makeApp({ MR_LIBRARY_DIR: sampleLib() });
    const u = '/api/library/file?path=Books/b10.txt';
    const r = await app.request(u, { headers: { Range: 'bytes=1-2' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toBe('bytes 1-2/3');
    expect(await r.text()).toBe('en');
    expect((await app.request(u, { headers: { Range: 'bytes=10-' } })).status).toBe(416);
    const full = await app.request(u);
    expect(full.status).toBe(200);
    expect(full.headers.get('Accept-Ranges')).toBe('bytes');
    const etag = full.headers.get('ETag')!;
    expect((await app.request(u, { headers: { 'If-None-Match': etag } })).status).toBe(304);
    const head = await app.request(u, { method: 'HEAD' });
    expect(head.headers.get('Content-Length')).toBe('3');
    expect(await head.text()).toBe('');
    const html = await app.request('/api/library/file?path=Books/page.html');
    expect(html.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(html.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(html.headers.get('Content-Security-Policy')).toBe('sandbox');
    expect((await app.request('/api/library/file?path=Books/hello.txt&download=1')).headers.get('Content-Disposition')).toMatch(/^attachment; filename="hello.txt"/);
  });

  it('文件名含非 ASCII 字符时响应头合法', async () => {
    const { app } = makeApp({ MR_LIBRARY_DIR: sampleLib() });
    const r = await app.request(`/api/library/file?path=${encodeURIComponent('中文目录/三体.txt')}`);
    expect(await r.text()).toBe('科学边界');
    expect(r.headers.get('Content-Disposition')).toContain("filename*=UTF-8''%E4%B8%89%E4%BD%93.txt");
  });
});

describe('防越界', () => {
  it('.. / 绝对路径 / NUL / 编码过的 .. 都不能离开书库', async () => {
    const outer = tmp('mr-outer-');
    put(outer, 'secret.txt', 'TOP SECRET');
    const lib = path.join(outer, 'lib');
    put(lib, 'ok.txt', 'ok');
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    for (const p of ['../secret.txt', '..%2Fsecret.txt', 'a/../../secret.txt', `${outer}/secret.txt`, '/secret.txt', 'ok.txt\0', '%00']) {
      for (const route of ['file', 'list', 'thumb']) {
        const res = await app.request(`/api/library/${route}?path=${p.includes('%') ? p : encodeURIComponent(p)}`);
        expect(res.status, `${route} ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(400);
        expect(await res.text()).not.toContain('TOP SECRET');
      }
    }
    const mv = await post(app, '/api/library/move', { paths: ['ok.txt'], to: '../' });
    expect(mv.status).toBe(400);
    expect((await post(app, '/api/library/delete', { paths: ['../secret.txt'] })).status).toBe(400);
    expect(existsSync(path.join(outer, 'secret.txt'))).toBe(true);
  });

  it('符号链接：指向书库外的目录/文件读不到、不出现在列表、不能写入；指向库内的正常用', async () => {
    const outer = tmp('mr-outer-');
    put(outer, 'secret.txt', 'TOP SECRET');
    put(outer, 'dir/inner.txt', 'inner');
    const lib = path.join(outer, 'lib');
    put(lib, 'real/doc.txt', 'doc');
    symlinkSync(outer, path.join(lib, 'escape-dir'));
    symlinkSync(path.join(outer, 'secret.txt'), path.join(lib, 'escape-file.txt'));
    symlinkSync('/nonexistent/target', path.join(lib, 'dangling'));
    symlinkSync(path.join(lib, 'real'), path.join(lib, 'inside-link'));
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const names = (await j<LibraryListResponse>(await app.request('/api/library/list?path='))).entries.map((e) => e.name);
    expect(names).toEqual(['inside-link', 'real']);
    for (const p of ['escape-file.txt', 'escape-dir/secret.txt', 'escape-dir/dir/inner.txt']) {
      const res = await app.request(`/api/library/file?path=${encodeURIComponent(p)}`);
      expect(res.status, p).toBe(403);
    }
    expect((await app.request('/api/library/list?path=escape-dir')).status).toBe(403);
    expect(await (await app.request('/api/library/file?path=inside-link/doc.txt')).text()).toBe('doc');
    // 写操作
    expect((await upload(app, 'escape-dir', { 'x.txt': 'x' })).status).toBe(403);
    expect((await post(app, '/api/library/mkdir', { path: 'escape-dir/new' })).status).toBe(403);
    expect((await post(app, '/api/library/delete', { paths: ['escape-dir/dir/inner.txt'] })).status).toBe(403);
    expect((await post(app, '/api/library/move', { paths: ['real/doc.txt'], to: 'escape-dir' })).status).toBe(403);
    expect(existsSync(path.join(outer, 'x.txt'))).toBe(false);
    expect(readFileSync(path.join(outer, 'dir/inner.txt'), 'utf8')).toBe('inner');
    // 拷贝：目录内的链接若指向库外，复制时被跳过而不是解引用
    symlinkSync(outer, path.join(lib, 'real', 'sneaky'));
    const cp = await post(app, '/api/library/copy', { paths: ['real'], to: '' });
    expect(cp.status).toBe(200);
    const copied = (await j<{ entries: LibraryEntry[] }>(cp)).entries[0];
    expect(readdirSync(path.join(lib, copied.name))).toEqual(['doc.txt']);
  });
});

describe('搜索', () => {
  it('递归、多关键字都要命中、不区分大小写、跳过隐藏目录', async () => {
    const lib = sampleLib();
    put(lib, 'Books/sub/Alice In Wonderland.EPUB', 'x');
    put(lib, '.hidden/alice.txt', 'x');
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const q = async (qs: string, extra = '') => (await j<LibraryListResponse>(await app.request(`/api/library/search?path=&q=${encodeURIComponent(qs)}${extra}`))).entries.map((e) => e.path);
    expect(await q('alice')).toEqual(['Books/sub/Alice In Wonderland.EPUB']);
    expect(await q('wonder alice')).toEqual(['Books/sub/Alice In Wonderland.EPUB']);
    expect(await q('alice zzz')).toEqual([]);
    expect(await q('alice', '&hidden=1')).toHaveLength(2);
    expect((await app.request('/api/library/search?path=&q=')).status).toBe(400);
  });
});

describe.skipIf(!has7z)('压缩包内浏览', () => {
  async function zipLib(): Promise<string> {
    const lib = tmp('mr-lib-');
    await writeZip(path.join(lib, 'comics/bundle.zip'), [
      { name: 'vol1/001.png', data: png(40, 60, [90, 90, 200]) },
      { name: 'vol1/002.png', data: png(40, 60, [200, 90, 200]) },
      { name: 'notes/readme.txt', data: 'notes in zip' },
      { name: 'top.txt', data: 'top' },
      { name: '.dot', data: 'x' },
      { name: '__MACOSX/junk', data: 'x' },
    ]);
    return lib;
  }

  it("'archive?inner' 路径：根、子目录、文件（HEAD、不支持 Range）", async () => {
    const { app } = makeApp({ MR_LIBRARY_DIR: await zipLib() });
    const list = async (p: string) => (await j<LibraryListResponse>(await app.request(`/api/library/list?path=${encodeURIComponent(p)}`)));
    const root = await list('comics/bundle.zip?');
    expect(root.path).toBe('comics/bundle.zip?');
    expect(root.entries.map((e) => [e.name, e.dir])).toEqual([['notes', true], ['vol1', true], ['top.txt', false]]);
    expect((await list('comics/bundle.zip')).entries.length).toBe(3); // 压缩包文件本身也可当目录列
    const vol = await list('comics/bundle.zip?vol1');
    expect(vol.entries.map((e) => e.path)).toEqual(['comics/bundle.zip?vol1/001.png', 'comics/bundle.zip?vol1/002.png']);
    const f = await app.request(`/api/library/file?path=${encodeURIComponent('comics/bundle.zip?notes/readme.txt')}`);
    expect(await f.text()).toBe('notes in zip');
    expect(f.headers.get('Accept-Ranges')).toBe('none');
    const h = await app.request(`/api/library/file?path=${encodeURIComponent('comics/bundle.zip?top.txt')}`, { method: 'HEAD' });
    expect(h.headers.get('Content-Length')).toBe('3');
    expect((await app.request(`/api/library/list?path=${encodeURIComponent('comics/bundle.zip?nope')}`)).status).toBe(404);
    expect((await app.request(`/api/library/file?path=${encodeURIComponent('comics/bundle.zip?nope.txt')}`)).status).toBe(404);
    expect((await app.request(`/api/library/file?path=${encodeURIComponent('comics/bundle.zip?vol1')}`)).status).toBe(400);
    const hidden = await j<LibraryListResponse>(await app.request(`/api/library/list?path=${encodeURIComponent('comics/bundle.zip?')}&hidden=1`));
    expect(hidden.entries.map((e) => e.name)).toContain('.dot');
  });

  it('包内路径只读：写操作一律 400；包内路径里的 .. 被拒绝', async () => {
    const { app } = makeApp({ MR_LIBRARY_DIR: await zipLib() });
    expect((await post(app, '/api/library/delete', { paths: ['comics/bundle.zip?top.txt'] })).status).toBe(400);
    expect((await post(app, '/api/library/rename', { path: 'comics/bundle.zip?top.txt', newName: 'x' })).status).toBe(400);
    expect((await app.request(`/api/library/file?path=${encodeURIComponent('comics/bundle.zip?../x')}`)).status).toBe(400);
  });

  it('无 UTF-8 标志的 GBK 文件名 zip 按 GBK 还原', async () => {
    const lib = tmp('mr-lib-');
    // 用同字节数的占位名写 zip，再把本地头和中央目录里的名字替换成 GBK 字节（"中文.txt"）
    const file = path.join(lib, 'gbk.zip');
    await writeZip(file, [{ name: 'AAAA.txt', data: 'hello gbk' }]);
    const buf = readFileSync(file);
    const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]); // 中文
    let at = -1;
    while ((at = buf.indexOf('AAAA', at + 1)) >= 0) gbk.copy(buf, at);
    writeFileSync(file, buf);
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const list = await j<LibraryListResponse>(await app.request('/api/library/list?path=gbk.zip'));
    expect(list.entries.map((e) => e.name)).toEqual(['中文.txt']);
    const f = await app.request(`/api/library/file?path=${encodeURIComponent('gbk.zip?中文.txt')}`);
    expect(await f.text()).toBe('hello gbk');
  });
});

describe.skipIf(!has7z)('封面缩略图', () => {
  it('EPUB / FB2 / CBZ（自然序第一张）出封面，txt 404，结果带 ETag 可 304', async () => {
    const lib = tmp('mr-lib-');
    await writeEpub(path.join(lib, 'Alice.epub'), 'Alice', png(200, 300, [200, 80, 60]));
    put(lib, 'story.fb2', `<?xml version="1.0"?><FictionBook xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><coverpage><image l:href="#c.png"/></coverpage></title-info></description><binary id="c.png" content-type="image/png">${png(120, 180, [40, 120, 200]).toString('base64')}</binary></FictionBook>`);
    await writeZip(path.join(lib, 'demo.cbz'), [
      { name: 'page10.png', data: png(60, 90, [10, 10, 10]) },
      { name: 'page2.png', data: png(60, 90, [250, 250, 0]) },
      { name: 'page1.png', data: png(60, 90, [0, 200, 0]) },
    ]);
    put(lib, 'hello.txt', 'x');
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    for (const name of ['Alice.epub', 'story.fb2', 'demo.cbz']) {
      const r = await app.request(`/api/library/thumb?path=${encodeURIComponent(name)}&size=64`);
      expect(r.status, name).toBe(200);
      expect(r.headers.get('Content-Type')).toMatch(/^image\//);
      const body = Buffer.from(await r.arrayBuffer());
      expect(body.length).toBeGreaterThan(100);
      const etag = r.headers.get('ETag')!;
      expect((await app.request(`/api/library/thumb?path=${encodeURIComponent(name)}&size=64`, { headers: { 'If-None-Match': etag } })).status).toBe(304);
    }
    expect((await app.request('/api/library/thumb?path=hello.txt')).status).toBe(404);
    expect((await app.request('/api/library/thumb?path=hello.txt')).status).toBe(404); // 负缓存路径也是 404
    // 压缩包内的图片也能出缩略图
    await writeZip(path.join(lib, 'bundle.zip'), [{ name: 'vol1/001.png', data: png(40, 60, [90, 90, 200]) }]);
    expect((await app.request(`/api/library/thumb?path=${encodeURIComponent('bundle.zip?vol1/001.png')}`)).status).toBe(200);
  });
});

describe('上传', () => {
  it('多文件、中文名、重名加序号、overwrite=1 覆盖、目录不存在时自动创建', async () => {
    const lib = sampleLib();
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const r = await upload(app, 'Upload', { 'a.txt': 'A', '中文 书.txt': 'B' });
    expect(r.status).toBe(200);
    const saved = (await j<{ saved: LibraryEntry[] }>(r)).saved;
    expect(saved.map((e) => e.path).sort()).toEqual(['Upload/a.txt', 'Upload/中文 书.txt']);
    const again = (await j<{ saved: LibraryEntry[] }>(await upload(app, 'Upload', { 'a.txt': 'A2' }))).saved;
    expect(again[0].name).toBe('a (1).txt');
    expect(readFileSync(path.join(lib, 'Upload/a.txt'), 'utf8')).toBe('A');
    await upload(app, 'Upload', { 'a.txt': 'A3' }, '&overwrite=1');
    expect(readFileSync(path.join(lib, 'Upload/a.txt'), 'utf8')).toBe('A3');
    await upload(app, 'Fresh/Dir', { 'x.txt': 'x' });
    expect(readFileSync(path.join(lib, 'Fresh/Dir/x.txt'), 'utf8')).toBe('x');
    expect(readdirSync(path.join(lib, 'Upload')).filter((n) => n.endsWith('.mr-part'))).toEqual([]);
  });

  it('文件名里的路径成分被丢掉；不是 multipart / 没有文件 → 400；只读书库 → 403；超限 → 413', async () => {
    const lib = sampleLib();
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const evil = await j<{ saved: LibraryEntry[] }>(await upload(app, 'Upload', { '../../evil.txt': 'x', 'C:\\temp\\win.txt': 'y' }));
    expect(evil.saved.map((e) => e.path).sort()).toEqual(['Upload/evil.txt', 'Upload/win.txt']);
    expect(existsSync(path.join(lib, '..', 'evil.txt'))).toBe(false);
    expect((await app.request('/api/library/upload?path=Upload', { method: 'POST', body: 'raw', headers: { 'Content-Type': 'text/plain' } })).status).toBe(400);
    const empty = new FormData();
    empty.append('note', 'no file');
    expect((await app.request('/api/library/upload?path=Upload', { method: 'POST', body: empty })).status).toBe(400);

    const ro = makeApp({ MR_LIBRARY_DIR: lib, MR_LIBRARY_READONLY: '1' }).app;
    expect((await upload(ro, 'Upload', { 'x.txt': 'x' })).status).toBe(403);
    expect((await post(ro, '/api/library/delete', { paths: ['Books/b2.txt'] })).status).toBe(403);
    expect((await ro.request('/api/library/list?path=Books')).status).toBe(200);

    const small = makeApp({ MR_LIBRARY_DIR: lib, MR_MAX_UPLOAD_MB: '0.001' }).app; // ≈1 KB
    const big = await upload(small, 'Upload', { 'big.bin': new Uint8Array(5000) });
    expect(big.status).toBe(413);
    expect(existsSync(path.join(lib, 'Upload/big.bin'))).toBe(false);
    expect(readdirSync(path.join(lib, 'Upload')).filter((n) => n.endsWith('.mr-part'))).toEqual([]);
  });

  it('客户端中途断开：服务端不崩、不留临时文件', async () => {
    const lib = sampleLib();
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const srv = await listen(app);
    try {
      const port = Number(new URL(srv.url).port);
      await new Promise<void>((resolve) => {
        const sock = net.connect(port, '127.0.0.1', () => {
          const boundary = 'XBOUNDARYX';
          const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="half.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
          sock.write(`POST /api/library/upload?path=Upload HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: 100000\r\n\r\n${head}`);
          sock.write(Buffer.alloc(20000, 1));
          setTimeout(() => {
            sock.destroy();
            resolve();
          }, 150);
        });
        sock.on('error', () => undefined);
      });
      await new Promise((r) => setTimeout(r, 300));
      const alive = await fetch(`${srv.url}/api/health`);
      expect(alive.status).toBe(200);
      expect(readdirSync(path.join(lib, 'Upload')).filter((n) => n !== '.keep')).toEqual([]);
    } finally {
      await srv.close();
    }
  });
});

describe('新建 / 改名 / 拷贝 / 移动 / 删除', () => {
  it('mkdir：返回 entry；已存在 409；非法名字 400', async () => {
    const lib = sampleLib();
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const r = await post(app, '/api/library/mkdir', { path: 'Books/新目录' });
    expect(r.status).toBe(200);
    expect((await j<{ entry: LibraryEntry }>(r)).entry).toMatchObject({ name: '新目录', path: 'Books/新目录', dir: true });
    expect(statSync(path.join(lib, 'Books/新目录')).isDirectory()).toBe(true);
    expect((await post(app, '/api/library/mkdir', { path: 'Books/新目录' })).status).toBe(409);
    expect((await post(app, '/api/library/mkdir', { path: 'Books/x.mr-part' })).status).toBe(400);
    expect((await post(app, '/api/library/mkdir', {})).status).toBe(400);
    expect((await app.request('/api/library/mkdir', { method: 'POST', body: 'not json' })).status).toBe(400);
  });

  it('rename：不允许带路径、重名 409、不能改书库根', async () => {
    const lib = sampleLib();
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const ok = await post(app, '/api/library/rename', { path: 'Books/b2.txt', newName: '第二本.txt' });
    expect((await j<{ entry: LibraryEntry }>(ok)).entry.path).toBe('Books/第二本.txt');
    expect(existsSync(path.join(lib, 'Books/第二本.txt'))).toBe(true);
    expect((await post(app, '/api/library/rename', { path: 'Books/b10.txt', newName: '../b10.txt' })).status).toBe(400);
    expect((await post(app, '/api/library/rename', { path: 'Books/b10.txt', newName: 'hello.txt' })).status).toBe(409);
    expect((await post(app, '/api/library/rename', { path: 'Books/b10.txt', newName: '' })).status).toBe(400);
    expect((await post(app, '/api/library/rename', { path: '', newName: 'x' })).status).toBe(400);
    expect((await post(app, '/api/library/rename', { path: 'nope', newName: 'x' })).status).toBe(404);
  });

  it('copy：目录递归、重名加序号；不能拷进自己里面', async () => {
    const lib = sampleLib();
    put(lib, 'Books/sub/deep/f.txt', 'deep');
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const r = await post(app, '/api/library/copy', { paths: ['Books/sub', 'Books/hello.txt'], to: 'Upload' });
    const entries = (await j<{ entries: LibraryEntry[] }>(r)).entries;
    expect(entries.map((e) => e.path)).toEqual(['Upload/sub', 'Upload/hello.txt']);
    expect(readFileSync(path.join(lib, 'Upload/sub/deep/f.txt'), 'utf8')).toBe('deep');
    const dup = (await j<{ entries: LibraryEntry[] }>(await post(app, '/api/library/copy', { paths: ['Books/hello.txt'], to: 'Upload' }))).entries;
    expect(dup[0].name).toBe('hello (1).txt');
    expect(existsSync(path.join(lib, 'Books/hello.txt'))).toBe(true);
    const self = await post(app, '/api/library/copy', { paths: ['Books'], to: 'Books/sub' });
    expect(self.status).toBe(400);
    expect((await post(app, '/api/library/copy', { paths: ['Books/hello.txt'], to: 'Books/hello.txt' })).status).toBe(400);
    expect((await post(app, '/api/library/copy', { paths: [], to: 'Upload' })).status).toBe(400);
  });

  it('move：同名冲突 409 且什么都不动；移到原目录是空操作；不能移进自己里面', async () => {
    const lib = sampleLib();
    put(lib, 'Upload/b2.txt', 'already');
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const conflict = await post(app, '/api/library/move', { paths: ['Books/hello.txt', 'Books/b2.txt'], to: 'Upload' });
    expect(conflict.status).toBe(409);
    expect(existsSync(path.join(lib, 'Books/hello.txt'))).toBe(true); // 先检查后动手
    const ok = await post(app, '/api/library/move', { paths: ['Books/hello.txt', 'Books/b10.txt'], to: 'Upload' });
    expect((await j<{ entries: LibraryEntry[] }>(ok)).entries.map((e) => e.path)).toEqual(['Upload/hello.txt', 'Upload/b10.txt']);
    expect(existsSync(path.join(lib, 'Books/hello.txt'))).toBe(false);
    const same = await post(app, '/api/library/move', { paths: ['Upload/hello.txt'], to: 'Upload' });
    expect((await j<{ entries: LibraryEntry[] }>(same)).entries[0].path).toBe('Upload/hello.txt');
    expect((await post(app, '/api/library/move', { paths: ['Books'], to: 'Books/x' })).status).toBeGreaterThanOrEqual(400);
    mkdirSync(path.join(lib, 'Books/inner'));
    expect((await post(app, '/api/library/move', { paths: ['Books'], to: 'Books/inner' })).status).toBe(400);
  });

  it('delete：文件与目录（递归）；不能删书库根；不存在的路径 404', async () => {
    const lib = sampleLib();
    const { app } = makeApp({ MR_LIBRARY_DIR: lib });
    const r = await post(app, '/api/library/delete', { paths: ['Books/b2.txt', '中文目录'] });
    expect(await j(r)).toEqual({ ok: true });
    expect(existsSync(path.join(lib, 'Books/b2.txt'))).toBe(false);
    expect(existsSync(path.join(lib, '中文目录'))).toBe(false);
    expect((await post(app, '/api/library/delete', { paths: [''] })).status).toBe(403);
    expect((await post(app, '/api/library/delete', { paths: ['nope.txt'] })).status).toBe(404);
    expect(existsSync(lib)).toBe(true);
  });
});
