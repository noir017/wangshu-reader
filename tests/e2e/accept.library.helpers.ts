// 书架侧/服务端验收（accept.library.*）的公共辅助：构建、起真实服务端、生成样本、开页面。
// 用法（容器里）：npx playwright test tests/e2e/accept.library. --workers=1
// 约定：端口 5411–5419 归这组用例；构建产物与截图都在 out/accept-library/（tools/sync 不会清掉；test-results 会被别人的运行清空）。
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import JSZip from 'jszip';

export const ROOT = process.cwd();
export const OUT = path.join(ROOT, 'out/accept-library');
export const BUILD_STD = path.join(OUT, 'build');
export const BUILD_SINGLE = path.join(OUT, 'build-single');
export const SERVER_JS = path.join(OUT, 'server/index.mjs');
export const SAMPLES = path.join(ROOT, 'samples');

export const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, 'shots', `${name}.png`) });

// ───────────── 构建 ─────────────
let built = false;
/** 构建前端（标准 + 单文件）与服务端到 out/accept-library；每个进程只做一次，flock 防止并行 worker 互相覆盖 */
export function ensureBuilt(): void {
  if (built) return;
  built = true;
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  const cmd = [
    `npx vite build --outDir ${BUILD_STD} --emptyOutDir`,
    `npx vite build --mode single --outDir ${BUILD_SINGLE} --emptyOutDir`,
    `npx esbuild server/src/index.ts --bundle --platform=node --format=esm --packages=external --outfile=${SERVER_JS}`,
  ].join(' >/dev/null && ');
  execFileSync('flock', [path.join(OUT, 'build.lock'), 'bash', '-c', `${cmd} >/dev/null`], { cwd: ROOT, stdio: 'pipe', timeout: 180_000 });
}

// ───────────── 服务端 ─────────────
export interface Srv {
  port: number;
  url: string;
  token: string;
  /** 书库根目录 */
  lib: string;
  dataDir: string;
  stop(): Promise<void>;
  /** 服务端日志（排错用） */
  log(): string;
}

const usedPorts = new Set<number>();
/** 在 5411–5419 里找一个当前没被占用的端口（并行跑多个 spec 时避免撞车） */
export async function freePort(): Promise<number> {
  for (let p = 5411; p <= 5419; p++) {
    if (usedPorts.has(p)) continue;
    const ok = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
    if (ok) {
      usedPorts.add(p);
      return p;
    }
  }
  throw new Error('5411–5419 都被占用了');
}

export interface SrvOpts {
  /** 缺省自动在 5411–5419 里挑一个空闲的 */
  port?: number;
  token?: string;
  /** 托管哪个前端构建；缺省不托管 */
  serve?: 'std' | 'single';
  /** 不要书库目录 */
  noLibrary?: boolean;
  env?: Record<string, string>;
}

export async function startServer(opts: SrvOpts): Promise<Srv> {
  ensureBuilt();
  const o = { ...opts, port: opts.port ?? (await freePort()) };
  usedPorts.add(o.port);
  const run = path.join(OUT, 'run', String(o.port));
  fs.rmSync(run, { recursive: true, force: true });
  const lib = path.join(run, 'lib');
  const dataDir = path.join(run, 'data');
  fs.mkdirSync(lib, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  if (!o.noLibrary) await makeLibraryFixtures(lib);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MR_PORT: String(o.port),
    MR_HOST: '127.0.0.1',
    MR_DATA_DIR: dataDir,
    MR_TOKEN: o.token ?? '',
    MR_STATIC_DIR: o.serve ? (o.serve === 'std' ? BUILD_STD : BUILD_SINGLE) : path.join(run, 'no-static'),
    MR_LIBRARY_DIR: o.noLibrary ? '' : lib,
    ...o.env,
  };
  const proc: ChildProcess = spawn('node', [SERVER_JS], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout!.on('data', (d) => (log += d));
  proc.stderr!.on('data', (d) => (log += d));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`服务端 ${o.port} 没有启动：\n${log}`)), 15_000);
    const tick = setInterval(() => {
      if (log.includes('listening')) {
        clearInterval(tick);
        clearTimeout(t);
        resolve();
      }
    }, 50);
    proc.once('exit', (c) => {
      clearInterval(tick);
      clearTimeout(t);
      reject(new Error(`服务端 ${o.port} 退出 ${c}：\n${log}`));
    });
  });
  return {
    port: o.port,
    url: `http://127.0.0.1:${o.port}`,
    token: o.token ?? '',
    lib,
    dataDir,
    log: () => log,
    stop: () =>
      new Promise<void>((resolve) => {
        usedPorts.delete(o.port);
        if (proc.exitCode !== null) return resolve();
        proc.once('exit', () => resolve());
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 3000);
      }),
  };
}

/** 直接对服务端发请求（带令牌），验证用 */
export async function srvFetch(srv: Srv, p: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (srv.token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${srv.token}`);
  return fetch(srv.url + p, { ...init, headers });
}

// ───────────── 样本生成 ─────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 纯色 + 页码条纹的 PNG（不依赖图像库）。seed 决定颜色 */
export function makePng(w: number, h: number, seed: number): Buffer {
  const row = 1 + w * 3;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * row + 1 + x * 3;
      const stripe = Math.floor((y * 8) / h) === seed % 8;
      raw[o] = stripe ? 255 : (40 + seed * 37) & 0xff;
      raw[o + 1] = stripe ? 255 : (120 + x / 3 + seed * 11) & 0xff;
      raw[o + 2] = stripe ? 255 : (200 - y / 4 + seed * 53) & 0xff;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const para = (i: number) => `山不在高，有仙则名。水不在深，有龙则灵。斯是陋室，惟吾德馨。苔痕上阶绿，草色入帘青。第${i}段。`;

/** 两章的小 EPUB */
export async function makeEpub(title = '验收样书', author = 'Moon Dev', opts: { cover?: boolean; subject?: string; paragraphs?: number } = {}): Promise<Buffer<ArrayBuffer>> {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:acc-${title}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>zh</dc:language>${opts.subject ? `<dc:subject>${opts.subject}</dc:subject>` : ''}${opts.cover ? '<meta name="cover" content="cover"/>' : ''}</metadata><manifest>${opts.cover ? '<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>' : ''}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  );
  z.file('OEBPS/nav.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章</a></li><li><a href="c2.xhtml">第二章</a></li></ol></nav></body></html>');
  if (opts.cover) z.file('OEBPS/cover.png', makePng(200, 300, [...title].reduce((a, c) => a + c.charCodeAt(0), 0)));
  const body = (n: number) => Array.from({ length: opts.paragraphs ?? 40 }, (_, i) => `<p>${para(i + n)}</p>`).join('');
  z.file('OEBPS/c1.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body><h1>第一章</h1>${body(0)}</body></html>`);
  z.file('OEBPS/c2.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c2</title></head><body><h1>第二章</h1>${body(500)}</body></html>`);
  return Buffer.from(await z.generateAsync({ type: 'nodebuffer' }));
}

/** n 页 PNG 的 CBZ */
export async function makeCbz(n = 4): Promise<Buffer<ArrayBuffer>> {
  const z = new JSZip();
  for (let i = 1; i <= n; i++) z.file(`page${String(i).padStart(2, '0')}.png`, makePng(240, 360, i));
  return Buffer.from(await z.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
}

/**
 * 手写 RAR4（存储方式、不压缩）：容器里没有 rar 压缩器，样本目录 samples/rar 里的包又只有 txt。
 * 格式：标记块 + 主头 + 每个文件一个文件头（STORE=0x30）+ 数据 + 结束块。
 */
export function makeRar(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])];
  const withCrc = (hdr: Buffer) => {
    hdr.writeUInt16LE(crc32(hdr.subarray(2)) & 0xffff, 0);
    return hdr;
  };
  const main = Buffer.alloc(13);
  main[2] = 0x73;
  main.writeUInt16LE(0, 3);
  main.writeUInt16LE(13, 5);
  parts.push(withCrc(main));
  const now = new Date();
  const dosTime = ((now.getFullYear() - 1980) << 25) | ((now.getMonth() + 1) << 21) | (now.getDate() << 16) | (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const hdr = Buffer.alloc(32 + name.length);
    hdr[2] = 0x74;
    hdr.writeUInt16LE(0x8000, 3); // 带附加数据大小
    hdr.writeUInt16LE(hdr.length, 5);
    hdr.writeUInt32LE(f.data.length, 7); // 压缩后大小
    hdr.writeUInt32LE(f.data.length, 11); // 原大小
    hdr[15] = 3; // Unix
    hdr.writeUInt32LE(crc32(f.data), 16);
    hdr.writeUInt32LE(dosTime >>> 0, 20);
    hdr[24] = 20; // 解压所需版本
    hdr[25] = 0x30; // STORE
    hdr.writeUInt16LE(name.length, 26);
    hdr.writeUInt32LE(0o644, 28);
    name.copy(hdr, 32);
    parts.push(withCrc(hdr), f.data);
  }
  parts.push(Buffer.from([0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00]));
  return Buffer.concat(parts);
}

/** 用容器里的 c44/djvm 生成 n 页 DJVU；缺命令返回 null */
export function makeDjvu(dir: string, n = 3): Buffer | null {
  try {
    execFileSync('c44', ['-help'], { stdio: 'ignore' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
  }
  fs.mkdirSync(dir, { recursive: true });
  const pages: string[] = [];
  for (let i = 1; i <= n; i++) {
    const w = 300;
    const h = 420;
    const ppm = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 3;
        const bar = Math.floor(y / 52) % 2 === 0 && x > 40 && x < 260;
        ppm[o] = bar ? 20 : 240 - i * 20;
        ppm[o + 1] = bar ? 20 : 235 - x / 4;
        ppm[o + 2] = bar ? 20 : 220 - y / 6;
      }
    const ppmFile = path.join(dir, `p${i}.ppm`);
    fs.writeFileSync(ppmFile, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), ppm]));
    const dj = path.join(dir, `p${i}.djvu`);
    execFileSync('c44', [ppmFile, dj], { stdio: 'ignore' });
    pages.push(dj);
  }
  const out = path.join(dir, 'book.djvu');
  execFileSync('djvm', ['-c', out, ...pages], { stdio: 'ignore' });
  return fs.readFileSync(out);
}

/** 服务端书库的样本目录结构 */
export async function makeLibraryFixtures(lib: string): Promise<void> {
  const w = (rel: string, data: Buffer | string) => {
    const f = path.join(lib, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  };
  w('Books/验收样书.epub', await makeEpub('验收样书', '张三'));
  w('Books/小说.txt', Array.from({ length: 120 }, (_, i) => para(i)).join('\n\n'));
  w('Books/notes.bin', Buffer.from([1, 2, 3, 4, 5]));
  w('Books/带封面.epub', await makeEpub('带封面的书', '封面作者', { cover: true }));
  w('Comics/封面图.png', makePng(200, 300, 5));
  w('Comics/demo.cbz', await makeCbz(4));
  const rar = makeRar(Array.from({ length: 3 }, (_, i) => ({ name: `ch1/page${i + 1}.png`, data: makePng(240, 360, i + 3) })));
  w('Comics/demo.cbr', rar);
  const bundle = new JSZip();
  bundle.file('inner/内含的书.epub', await makeEpub('包内的书', '李四'));
  bundle.file('inner/readme.txt', '这是压缩包里的说明文件。\n');
  bundle.file('top.txt', '顶层文件');
  w('Archives/bundle.zip', Buffer.from(await bundle.generateAsync({ type: 'nodebuffer' })));
  w('Upload/旧文件.txt', '已有的上传文件');
  w('.hidden/secret.txt', 'hidden');
  const chm = path.join(SAMPLES, 'chm/putty.chm');
  if (fs.existsSync(chm)) w('Docs/putty.chm', fs.readFileSync(chm));
  const dj = makeDjvu(path.join(path.dirname(lib), 'djvu-tmp'));
  if (dj) w('Docs/scan.djvu', dj);
}

// ───────────── 页面 ─────────────
export type ShapeKind = 'hosted' | 'single';

export interface Shape {
  kind: ShapeKind;
  token: boolean;
  srv: Srv;
}

export const shapeLabel = (s: { kind: ShapeKind; token: boolean }) => `${s.kind === 'hosted' ? '服务端托管' : 'file:// 单文件版'}${s.token ? ' + MR_TOKEN' : ''}`;

/** 阅读页首次进入的「点击区示意」蒙层，先标记为已看过；其余设置 patch 可经 extra 传入 */
export function seedSettings(shape: Shape | undefined, extra: Record<string, Record<string, unknown>> = {}) {
  const app: Record<string, unknown> = {};
  if (shape) {
    // file:// 打开单文件版：用户在设置里填服务端地址；托管形态默认同源，带令牌时要填令牌
    if (shape.kind === 'single') app.serverUrl = shape.srv.url;
    if (shape.token) app.serverToken = shape.srv.token;
  }
  return { app: { language: 'zh', ...app }, 'reader.ui': { showedReaderClickTip: true }, ...extra };
}

export function appUrl(shape: Shape, hash = ''): string {
  return shape.kind === 'hosted' ? `${shape.srv.url}/${hash}` : `file://${BUILD_SINGLE}/index.html${hash}`;
}

export interface Opened {
  ctx: BrowserContext;
  page: Page;
  errors: string[];
}

/** 新建隔离的浏览器上下文并打开应用（设置经 localStorage 预置，等价于用户在设置页填过） */
export async function openApp(browser: Browser, shape: Shape, opts: { hash?: string; viewport?: { width: number; height: number }; extra?: Record<string, Record<string, unknown>>; acceptDownloads?: boolean } = {}): Promise<Opened> {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 412, height: 915 }, locale: 'zh-CN', acceptDownloads: opts.acceptDownloads ?? true });
  const seed = JSON.stringify(seedSettings(shape, opts.extra));
  await ctx.addInitScript((s) => {
    // 只在这个 origin 第一次加载时种设置，之后以应用自己写的为准（否则会盖掉测试里改过的设置）
    if (!localStorage.getItem('mr.settings.v1')) localStorage.setItem('mr.settings.v1', s);
  }, seed);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // 浏览器对 4xx 的资源请求（WebDAV 的 404/405 是协议正常交互）自己会打一条 error，不是应用的错
    if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text().slice(0, 300)}`);
  });
  await page.goto(appUrl(shape, opts.hash ?? '#/'));
  await page.waitForSelector('#root > *', { timeout: 15_000 });
  return { ctx, page, errors };
}

/** 页面路由跳转（hash），file:// 与 http 通用 */
export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => (location.hash = h), hash.startsWith('#') ? hash : `#${hash}`);
  await page.waitForTimeout(300);
}

/** 打开「导入书籍」对话框：空书架第一次进书架会自动弹出（LIB-001），已经弹出就直接用 */
export async function openImportDialog(page: Page): Promise<void> {
  await go(page, '#/shelf');
  const choose = page.getByText('选择文件');
  await choose.waitFor({ timeout: 1500 }).catch(() => undefined);
  if (await choose.isVisible()) return;
  const openBtn = page.getByRole('button', { name: '导入书籍' });
  if (await openBtn.count()) await openBtn.first().click();
  else {
    await page.getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: '导入书籍' }).click();
  }
}

/** 通过「导入书籍」对话框选文件导入（走真实的文件选择器） */
export async function importViaDialog(page: Page, files: { name: string; mimeType?: string; buffer: Buffer }[] | string[], expectText: RegExp | string = /已导入 \d+ 本|已导入|已有/): Promise<void> {
  await openImportDialog(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('选择文件').click()]);
  await chooser.setFiles(files as never);
  await expect(page.getByText(expectText).first()).toBeVisible({ timeout: 60_000 });
}

/** 书架上能看到某本书的标题 */
export async function shelfHasBook(page: Page, title: string | RegExp): Promise<boolean> {
  await go(page, '#/shelf');
  await page.waitForTimeout(400);
  return (await page.getByText(title).count()) > 0;
}

export function srvBooks(srv: Srv): string[] {
  return fs.readdirSync(srv.lib);
}
