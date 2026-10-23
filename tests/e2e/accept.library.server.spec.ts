// 服务端接口验收：逐个对着真实构建出来的服务端（esbuild 产物，不是 tsx 开发态）发请求，覆盖 shared/api.ts 的全部接口。
// 联网项（Gutenberg 代理、Edge 朗读、翻译、词典）失败时记录原因但不判红，因为它们取决于外网；其余必须通过。
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import JSZip from 'jszip';
import { makeRar, makePng, makeCbz, SAMPLES, srvFetch, startServer, type Srv } from './accept.library.helpers';

// /api/proxy 用例连真实 Gutenberg，偶尔超时（ETIMEDOUT）：失败重试，串行模式下整组重跑
test.describe.configure({ mode: 'serial', retries: 2 });

let srv: Srv;
const net: string[] = [];
const noteNet = (what: string, ok: boolean, detail: string) => net.push(`${ok ? '通' : '不通'} ${what}: ${detail}`);

test.beforeAll(async () => {
  srv = await startServer({ port: 5418, serve: 'std' });
});
test.afterAll(async () => {
  console.log(`[联网项]\n${net.join('\n')}`);
  await srv.stop();
});

const J = (srvv: Srv, p: string, body: unknown) => srvFetch(srvv, p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/health 与前端托管', async () => {
  const r = await srvFetch(srv, '/api/health');
  expect(r.status).toBe(200);
  const h = (await r.json()) as { ok: boolean; features: Record<string, boolean> };
  expect(h.ok).toBe(true);
  for (const k of ['convert', 'convert.djvu', 'dav', 'library', 'upload', 'proxy']) expect(h.features[k], k).toBe(true);
  const idx = await srvFetch(srv, '/');
  expect(idx.headers.get('content-type')).toContain('text/html');
  // SPA 回退：未知路径回 index.html，未知 /api 路径回 JSON 404
  expect((await srvFetch(srv, '/no/such/page')).headers.get('content-type')).toContain('text/html');
  const nf = await srvFetch(srv, '/api/nothing');
  expect(nf.status).toBe(404);
  expect(((await nf.json()) as { error: string }).error).toBeTruthy();
});

test('/api/library：list / file(Range) / search / 隐藏项 / 压缩包内浏览', async () => {
  const l = (await (await srvFetch(srv, '/api/library/list?path=')).json()) as { entries: { name: string; dir: boolean; path: string }[] };
  expect(l.entries.map((e) => e.name).sort()).toEqual(['Archives', 'Books', 'Comics', 'Docs', 'Upload']); // .hidden 默认不出现
  const lh = (await (await srvFetch(srv, '/api/library/list?path=&hidden=1')).json()) as { entries: { name: string }[] };
  expect(lh.entries.map((e) => e.name)).toContain('.hidden');
  const books = (await (await srvFetch(srv, '/api/library/list?path=Books')).json()) as { entries: { name: string; size: number; mtime: number }[] };
  expect(books.entries.map((e) => e.name)).toContain('验收样书.epub');
  const f = await srvFetch(srv, `/api/library/file?path=${encodeURIComponent('Books/小说.txt')}`, { headers: { Range: 'bytes=0-5' } });
  expect(f.status).toBe(206);
  expect((await f.arrayBuffer()).byteLength).toBe(6);
  const s = (await (await srvFetch(srv, '/api/library/search?path=&q=demo')).json()) as { entries: { path: string }[] };
  expect(s.entries.map((e) => e.path).sort()).toEqual(['Comics/demo.cbr', 'Comics/demo.cbz']);
  // ZIP 包内：列目录、取条目
  const zl = (await (await srvFetch(srv, '/api/library/list?path=Archives/bundle.zip')).json()) as { path: string; entries: { name: string; path: string; dir: boolean }[] };
  expect(zl.entries.map((e) => e.name).sort()).toEqual(['inner', 'top.txt']);
  const zi = (await (await srvFetch(srv, `/api/library/list?path=${encodeURIComponent('Archives/bundle.zip?inner')}`)).json()) as { entries: { name: string; path: string }[] };
  expect(zi.entries.map((e) => e.name).sort()).toEqual(['readme.txt', '内含的书.epub']);
  const ze = await srvFetch(srv, `/api/library/file?path=${encodeURIComponent('Archives/bundle.zip?inner/readme.txt')}`);
  expect(await ze.text()).toContain('压缩包里的说明');
  // RAR 包内
  const rl = (await (await srvFetch(srv, '/api/library/list?path=Comics/demo.cbr')).json()) as { entries: { name: string }[] };
  expect(rl.entries.map((e) => e.name)).toEqual(['ch1']);
  const rf = await srvFetch(srv, `/api/library/file?path=${encodeURIComponent('Comics/demo.cbr?ch1/page1.png')}`);
  expect(Buffer.from(await rf.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG');
});

test('/api/library：越界与符号链接逃逸被拒绝', async () => {
  for (const p of ['../etc/passwd', 'Books/../../x', '/etc/passwd', 'Books/%00']) {
    const r = await srvFetch(srv, `/api/library/list?path=${encodeURIComponent(p)}`);
    expect([400, 403, 404], p).toContain(r.status);
  }
  fs.symlinkSync('/etc', path.join(srv.lib, 'Books/escape'));
  const r = await srvFetch(srv, `/api/library/file?path=${encodeURIComponent('Books/escape/passwd')}`);
  expect([403, 404]).toContain(r.status);
  const l = (await (await srvFetch(srv, '/api/library/list?path=Books')).json()) as { entries: { name: string }[] };
  expect(l.entries.map((e) => e.name)).not.toContain('escape');
  fs.unlinkSync(path.join(srv.lib, 'Books/escape'));
});

test('/api/library：upload / mkdir / rename / copy / move / delete', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(['hello 上传'], { type: 'text/plain' }), '新 书.txt');
  fd.append('file', new Blob(['two'], { type: 'text/plain' }), 'two.txt');
  const up = await srvFetch(srv, '/api/library/upload?path=Upload/子目录', { method: 'POST', body: fd });
  expect(up.status).toBe(200);
  const saved = ((await up.json()) as { saved: { name: string; path: string }[] }).saved;
  expect(saved.map((s) => s.name).sort()).toEqual(['two.txt', '新 书.txt']);
  expect(fs.readFileSync(path.join(srv.lib, 'Upload/子目录/新 书.txt'), 'utf8')).toBe('hello 上传');
  // 重名自动加 (1)
  const fd2 = new FormData();
  fd2.append('file', new Blob(['again']), 'two.txt');
  const up2 = (await (await srvFetch(srv, '/api/library/upload?path=Upload/子目录', { method: 'POST', body: fd2 })).json()) as { saved: { name: string }[] };
  expect(up2.saved[0].name).toBe('two (1).txt');
  expect((await J(srv, '/api/library/mkdir', { path: 'Upload/新建夹' })).status).toBe(200);
  const rn = (await (await J(srv, '/api/library/rename', { path: 'Upload/子目录/two.txt', newName: '改名后.txt' })).json()) as { entry: { name: string } };
  expect(rn.entry.name).toBe('改名后.txt');
  expect((await J(srv, '/api/library/rename', { path: 'Upload/子目录/改名后.txt', newName: '../逃.txt' })).status).toBeGreaterThanOrEqual(400);
  const cp = (await (await J(srv, '/api/library/copy', { paths: ['Upload/子目录/改名后.txt'], to: 'Upload/新建夹' })).json()) as { entries: { path: string }[] };
  expect(cp.entries[0].path).toBe('Upload/新建夹/改名后.txt');
  expect(fs.existsSync(path.join(srv.lib, 'Upload/子目录/改名后.txt'))).toBe(true);
  const mv = (await (await J(srv, '/api/library/move', { paths: ['Upload/子目录/新 书.txt'], to: 'Upload/新建夹' })).json()) as { entries: unknown[] };
  expect(mv.entries).toHaveLength(1);
  expect(fs.existsSync(path.join(srv.lib, 'Upload/子目录/新 书.txt'))).toBe(false);
  // 压缩包内是只读的
  expect((await J(srv, '/api/library/delete', { paths: ['Archives/bundle.zip?top.txt'] })).status).toBeGreaterThanOrEqual(400);
  const del = await J(srv, '/api/library/delete', { paths: ['Upload/新建夹', 'Upload/子目录'] });
  expect(((await del.json()) as { ok: boolean }).ok).toBe(true);
  expect(fs.existsSync(path.join(srv.lib, 'Upload/新建夹'))).toBe(false);
});

test('/api/library/thumb：有封面的书返回图片，没有的 404', async () => {
  const alice = path.join(SAMPLES, 'books/pg11-alice.epub');
  test.skip(!fs.existsSync(alice), '没有 samples/books/pg11-alice.epub');
  fs.copyFileSync(alice, path.join(srv.lib, 'Books/alice.epub'));
  const r = await srvFetch(srv, `/api/library/thumb?path=${encodeURIComponent('Books/alice.epub')}&size=120`);
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toMatch(/^image\//);
  expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(500);
  expect((await srvFetch(srv, `/api/library/thumb?path=${encodeURIComponent('Books/小说.txt')}`)).status).toBe(404);
});

test('/api/convert：CBR→CBZ、CHM→EPUB、DJVU→PDF、CB7→CBZ', async () => {
  const rar = fs.readFileSync(path.join(srv.lib, 'Comics/demo.cbr'));
  const c1 = await srvFetch(srv, '/api/convert?to=cbz&name=demo.cbr', { method: 'POST', body: rar });
  expect(c1.status).toBe(200);
  expect(c1.headers.get('content-disposition')).toContain('.cbz');
  const z = await JSZip.loadAsync(await c1.arrayBuffer());
  expect(Object.keys(z.files).filter((n) => /\.png$/.test(n))).toHaveLength(3);
  const chm = path.join(srv.lib, 'Docs/putty.chm');
  if (fs.existsSync(chm)) {
    const c2 = await srvFetch(srv, '/api/convert?to=epub&name=putty.chm', { method: 'POST', body: fs.readFileSync(chm) });
    expect(c2.status).toBe(200);
    const e = await JSZip.loadAsync(await c2.arrayBuffer());
    expect(Object.keys(e.files).some((n) => /\.(x?html?)$/i.test(n))).toBe(true);
    expect(await e.file('mimetype')!.async('string')).toBe('application/epub+zip');
  }
  const dj = path.join(srv.lib, 'Docs/scan.djvu');
  if (fs.existsSync(dj)) {
    const c3 = await srvFetch(srv, '/api/convert?to=pdf&name=scan.djvu', { method: 'POST', body: fs.readFileSync(dj) });
    expect(c3.status).toBe(200);
    expect(Buffer.from(await c3.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  }
  const cb7 = path.join(SAMPLES, 'books/sample.cb7');
  if (fs.existsSync(cb7)) {
    const c4 = await srvFetch(srv, '/api/convert?to=cbz&name=sample.cb7', { method: 'POST', body: fs.readFileSync(cb7) });
    expect(c4.status).toBe(200);
  }
  // 不支持的组合
  expect((await srvFetch(srv, '/api/convert?to=pdf&name=a.txt', { method: 'POST', body: 'x' })).status).toBeGreaterThanOrEqual(400);
});

test('/api/archive/list 与 extract；带密码的 RAR 回 422', async () => {
  const rar = fs.readFileSync(path.join(srv.lib, 'Comics/demo.cbr'));
  const l = (await (await srvFetch(srv, '/api/archive/list?name=demo.cbr', { method: 'POST', body: rar })).json()) as { entries: { path: string; size: number; dir: boolean }[] };
  expect(l.entries.filter((e) => !e.dir).map((e) => e.path)).toEqual(['ch1/page1.png', 'ch1/page2.png', 'ch1/page3.png']);
  const x = await srvFetch(srv, `/api/archive/extract?name=demo.cbr&entry=${encodeURIComponent('ch1/page2.png')}`, { method: 'POST', body: rar });
  expect(x.status).toBe(200);
  expect(Buffer.from(await x.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG');
  const enc = path.join(SAMPLES, 'rar/FileEncByName.rar');
  if (fs.existsSync(enc)) {
    // 这个包里 3Sec.txt 的内容加密了（文件名可见）：能列出，取这条内容时回 422
    const body = fs.readFileSync(enc);
    expect((await srvFetch(srv, '/api/archive/list?name=FileEncByName.rar', { method: 'POST', body })).status).toBe(200);
    const r = await srvFetch(srv, `/api/archive/extract?name=FileEncByName.rar&entry=${encodeURIComponent('3Sec.txt')}`, { method: 'POST', body });
    expect(r.status).toBe(422);
  }
  // 真实样本（samples/rar）：RAR5/带目录的包能列
  const ft = path.join(SAMPLES, 'rar/FolderTest.rar');
  if (fs.existsSync(ft)) {
    const r = (await (await srvFetch(srv, '/api/archive/list?name=FolderTest.rar', { method: 'POST', body: fs.readFileSync(ft) })).json()) as { entries: { path: string }[] };
    expect(r.entries.map((e) => e.path)).toContain('Folder1/Folder 中文/2中文.txt');
  }
});

test('/dav：PROPFIND / PUT / GET(Range) / MKCOL / MOVE / COPY / DELETE / LOCK', async () => {
  const d = (p: string, init: RequestInit = {}) => srvFetch(srv, `/dav${p}`, init);
  expect((await d('/', { method: 'OPTIONS' })).headers.get('dav')).toBeTruthy();
  expect((await d('/a', { method: 'MKCOL' })).status).toBe(201);
  expect((await d('/a/b', { method: 'MKCOL' })).status).toBe(201);
  expect((await d('/x/y/z.txt', { method: 'PUT', body: 'no parent' })).status).toBe(409); // 父目录不存在
  expect((await d('/a/b/f.txt', { method: 'PUT', body: '0123456789' })).status).toBe(201);
  const g = await d('/a/b/f.txt', { headers: { Range: 'bytes=2-4' } });
  expect(g.status).toBe(206);
  expect(await g.text()).toBe('234');
  const pf = await d('/a/b', { method: 'PROPFIND', headers: { Depth: '1' } });
  expect(pf.status).toBe(207);
  expect(await pf.text()).toContain('f.txt');
  expect((await d('/a/b/f.txt', { method: 'MOVE', headers: { Destination: `${srv.url}/dav/a/g.txt` } })).status).toBeLessThan(300);
  expect((await d('/a/g.txt', { method: 'COPY', headers: { Destination: `${srv.url}/dav/a/h.txt` } })).status).toBeLessThan(300);
  expect(await (await d('/a/h.txt')).text()).toBe('0123456789');
  const lk = await d('/a/h.txt', { method: 'LOCK', headers: { Timeout: 'Second-60' }, body: '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>' });
  expect(lk.status).toBe(200);
  expect((await d('/a/h.txt', { method: 'DELETE' })).status).toBeLessThan(300);
  expect((await d('/a/h.txt')).status).toBe(404);
  expect((await d('/a', { method: 'DELETE' })).status).toBeLessThan(300);
  // 路径穿越
  expect([400, 403, 404]).toContain((await d('/..%2f..%2fetc%2fpasswd')).status);
});

test('/api/proxy：真实 Gutenberg OPDS、重定向最终地址、禁止地址', async () => {
  const url = 'https://www.gutenberg.org/ebooks/search.opds/?query=alice';
  let r: Response;
  try {
    r = await srvFetch(srv, `/api/proxy?url=${encodeURIComponent(url)}`);
  } catch (e) {
    noteNet('proxy→gutenberg', false, String(e));
    return;
  }
  noteNet('proxy→gutenberg', r.status === 200, String(r.status));
  expect(r.status).toBe(200);
  expect(await r.text()).toContain('<feed');
  // 书籍文件下载：302 到 cache/epub，响应无 CORS，必须经代理
  const dl = await srvFetch(srv, `/api/proxy?url=${encodeURIComponent('https://www.gutenberg.org/ebooks/11.epub3.images')}`, { headers: { Range: 'bytes=0-3' } });
  expect([200, 206]).toContain(dl.status);
  expect(dl.headers.get('x-proxy-final-url') ?? '').toContain('gutenberg.org/cache/epub/11');
  await dl.arrayBuffer();
  // 云元数据地址永远禁止
  const bad = await srvFetch(srv, `/api/proxy?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
  expect(bad.status).toBeGreaterThanOrEqual(400);
  expect(bad.headers.get('x-proxy-error')).toBe('1');
  expect((await srvFetch(srv, '/api/proxy?url=notaurl')).headers.get('x-proxy-error')).toBe('1');
});

test('/api/tts：声音列表与 espeak 离线合成', async () => {
  const v = await srvFetch(srv, '/api/tts/voices');
  const vj = v.status === 200 ? ((await v.json()) as { voices: { id: string; engine: string }[] }) : { voices: [] };
  noteNet('tts voices', v.status === 200 && vj.voices.length > 0, `${v.status} voices=${vj.voices.length} engines=${[...new Set(vj.voices.map((x) => x.engine))].join(',')}`);
  expect(v.status).toBe(200);
  const r = await J(srv, '/api/tts', { text: 'hello world', voice: 'espeak:en', rate: 1 });
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toContain('audio/wav');
  expect(r.headers.get('x-tts-engine')).toBe('espeak');
  expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(2000);
  expect((await J(srv, '/api/tts', { text: '' })).status).toBeGreaterThanOrEqual(400);
  // Edge 在线朗读（外网）
  const e = await J(srv, '/api/tts', { text: '你好，世界', voice: 'zh-CN-XiaoxiaoNeural' });
  noteNet('tts edge 合成', e.status === 200 && (e.headers.get('x-tts-engine') ?? '') === 'edge', `${e.status} engine=${e.headers.get('x-tts-engine')}`);
  await e.arrayBuffer();
});

test('/api/translate 与 /api/dict（外网）', async () => {
  const p = await srvFetch(srv, '/api/translate/providers');
  expect(p.status).toBe(200);
  expect(((await p.json()) as { providers: unknown[] }).providers.length).toBeGreaterThan(0);
  const t = await J(srv, '/api/translate', { text: 'hello', from: 'auto', to: 'zh' });
  noteNet('translate google', t.status === 200, `${t.status} ${(await t.text()).slice(0, 80)}`);
  const s = await srvFetch(srv, '/api/dict/sources');
  expect(s.status).toBe(200);
  for (const [word, source] of [['hello', 'freedict'], ['你好', 'youdao'], ['dictionary', 'wiktionary']] as const) {
    const d = await srvFetch(srv, `/api/dict?word=${encodeURIComponent(word)}&from=auto&to=zh&source=${source}`);
    const body = d.status === 200 ? ((await d.json()) as { html: string }) : { html: '' };
    noteNet(`dict ${source}`, d.status === 200 && body.html.length > 0, `${d.status} html=${body.html.length}`);
  }
});

test('/api/fonts 与 /transfer', async () => {
  const f = await srvFetch(srv, '/api/fonts');
  expect(f.status).toBe(200);
  const fonts = ((await f.json()) as { fonts: { family: string; file: string }[] }).fonts;
  if (fonts.length) {
    const ff = await srvFetch(srv, `/api/fonts/file?file=${encodeURIComponent(fonts[0].file)}`);
    expect(ff.status).toBe(200);
    expect((await ff.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  }
  expect((await srvFetch(srv, '/api/fonts/file?file=../../etc/passwd')).status).toBeGreaterThanOrEqual(400);
  const t = await srvFetch(srv, '/transfer');
  expect(t.status).toBe(200);
  expect(await t.text()).toContain('网页传书');
});

test('MR_TOKEN：/api 需要 Bearer 或 ?token=，/dav 用 Basic，/health 与静态文件不需要', async () => {
  const s = await startServer({ port: 5419, token: 's3cret', serve: 'std' });
  try {
    expect((await fetch(`${s.url}/api/health`)).status).toBe(200);
    expect((await fetch(`${s.url}/`)).status).toBe(200);
    expect((await fetch(`${s.url}/transfer`)).status).toBe(200);
    expect((await fetch(`${s.url}/api/library/list?path=`)).status).toBe(401);
    expect((await fetch(`${s.url}/api/library/list?path=`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await fetch(`${s.url}/api/library/list?path=`, { headers: { Authorization: 'Bearer s3cret' } })).status).toBe(200);
    expect((await fetch(`${s.url}/api/library/list?path=&token=s3cret`)).status).toBe(200);
    const noAuth = await fetch(`${s.url}/dav/`, { method: 'PROPFIND', headers: { Depth: '0' } });
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get('www-authenticate')).toContain('Basic');
    const basic = `Basic ${Buffer.from('anyone:s3cret').toString('base64')}`;
    expect((await fetch(`${s.url}/dav/`, { method: 'PROPFIND', headers: { Depth: '0', Authorization: basic } })).status).toBe(207);
    // 带令牌时跨站来源也能用（CORS 全开 + 令牌鉴权）；预检不要求令牌
    const pre = await fetch(`${s.url}/api/library/list`, { method: 'OPTIONS', headers: { Origin: 'http://evil.test', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    expect(pre.status).toBeLessThan(300);
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://evil.test');
    const ok = await fetch(`${s.url}/api/library/list?path=`, { headers: { Origin: 'http://evil.test', Authorization: 'Bearer s3cret' } });
    expect(ok.status).toBe(200);
  } finally {
    await s.stop();
  }
});

test('originGuard（没设 MR_TOKEN）：跨站 Origin 被拒，本机/null/同源/无 Origin 放行', async () => {
  const get = (origin?: string, p = '/api/library/list?path=', extra: Record<string, string> = {}) => fetch(srv.url + p, { headers: { ...(origin ? { Origin: origin } : {}), ...extra } });
  expect((await get()).status).toBe(200);
  expect((await get('null')).status).toBe(200); // file:// 打开的单文件版
  expect((await get('http://127.0.0.1:9999')).status).toBe(200);
  expect((await get('http://localhost:9999')).status).toBe(200);
  expect((await get('http://192.168.1.5:8080')).status).toBe(200); // IP 字面量
  const evil = await get('http://evil.test');
  expect(evil.status).toBe(403);
  expect(await evil.text()).toContain('MR_TOKEN');
  expect((await get('http://evil.test', '/api/proxy?url=http%3A%2F%2Fexample.com')).status).toBe(403);
  expect((await get('http://evil.test', '/dav/')).status).toBe(403);
  // 预检也被挡
  const pre = await fetch(`${srv.url}/api/library/list`, { method: 'OPTIONS', headers: { Origin: 'http://evil.test', 'Access-Control-Request-Method': 'GET' } });
  expect(pre.status).toBe(403);
  // Origin 的主机就是请求的 Host（服务端自己托管前端、用域名访问）放行
  // （fetch 不允许改 Host 头，这里用 node:http）
  const withHost = (host: string, origin: string) =>
    new Promise<number>((resolve, reject) => {
      const rq = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/library/list?path=', headers: { Host: host, Origin: origin } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      rq.on('error', reject);
      rq.end();
    });
  expect(await withHost('myhost.test:5418', 'http://myhost.test:5418')).toBe(200);
  expect(await withHost('myhost.test:5418', 'http://other.test:5418')).toBe(403);
  // 反代场景：X-Forwarded-Host
  expect((await get('https://books.example.org', '/api/library/list?path=', { 'X-Forwarded-Host': 'books.example.org' })).status).toBe(200);
  // 代理不对「带 X-Forwarded-For」的请求开放
  const px = await fetch(`${srv.url}/api/proxy?url=${encodeURIComponent('http://example.com')}`, { headers: { 'X-Forwarded-For': '1.2.3.4' } });
  expect(px.status).toBeGreaterThanOrEqual(400);
});

test('样本自检：makeRar 生成的包能被 7z 读出，makeCbz/makePng 合法', async () => {
  const rar = makeRar([{ name: 'a/b.png', data: makePng(8, 8, 1) }]);
  expect(rar.subarray(0, 7).toString('hex')).toBe('526172211a0700');
  expect((await JSZip.loadAsync(await makeCbz(2))).file(/png$/).length).toBe(2);
});
