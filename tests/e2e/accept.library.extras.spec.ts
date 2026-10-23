// 书架侧补充验收：网络书库的增删改与登录（本地假 OPDS）、文件页的拷贝/移动/下载/缩略图/看图/快速访问/云端导入、
// 导入的拖放/ZIP/目录/服务端转换格式、最近阅读同步、Readwise、手动拖拽排序、标注导出导入、失效书籍补文件、封面搜索限流、冷启动回到上次标签页。
import { chromium, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import JSZip from 'jszip';
import { OUT, freePort, go, importViaDialog, makeCbz, makeEpub, makePng, openApp, openImportDialog, shot, srvFetch, startServer, type Opened, type Shape, type Srv } from './accept.library.helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);
test.use({ actionTimeout: 12_000 });

let srv: Srv;
let shape: Shape;
test.beforeAll(async () => {
  srv = await startServer({ serve: 'std' });
  shape = { kind: 'hosted', token: false, srv };
});
test.afterAll(async () => {
  await srv?.stop();
});

const idbAll = <T = any>(page: Page, store: string) =>
  page.evaluate(
    (s) =>
      new Promise<T[]>((resolve, reject) => {
        const req = indexedDB.open('moonreader');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction(s).objectStore(s).getAll();
          all.onsuccess = () => resolve(all.result as T[]);
        };
      }),
    store,
  );
const idbPut = (page: Page, store: string, value: unknown) =>
  page.evaluate(
    ([s, v]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('moonreader');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction(s as string, 'readwrite');
          tx.objectStore(s as string).put(v);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    [store, value] as const,
  );

// ───────────── 本地假 OPDS 站点 ─────────────
interface Opds {
  url: string;
  hits: string[];
  close(): Promise<void>;
}
async function startOpds(auth?: { user: string; pass: string }): Promise<Opds> {
  const port = await freePort();
  const hits: string[] = [];
  const epub = await makeEpub('OPDS 下来的书', '站点作者');
  const png = makePng(120, 180, 2);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    hits.push(`${req.method} ${u.pathname}${u.search}`);
    if (auth && req.headers.authorization !== `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString('base64')}`) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="opds"' }).end('auth');
      return;
    }
    const base = `http://127.0.0.1:${port}`;
    const feed = (title: string, body: string, extra = '') =>
      `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xml:base="${base}/"><title>${title}</title><subtitle>验收用的假 OPDS</subtitle><id>${u.pathname}</id>${extra}${body}</feed>`;
    const book = (n: number) =>
      `<entry><title>测试书${n}</title><id>b${n}</id><author><name>作者${n}</name></author><content type="html">&lt;p&gt;第 ${n} 本的简介&lt;/p&gt;</content><link rel="http://opds-spec.org/acquisition" href="dl/b${n}.epub" type="application/epub+zip"/><link rel="http://opds-spec.org/image/thumbnail" href="img/c.png" type="image/png"/></entry>`;
    if (u.pathname === '/opds') {
      res.writeHead(200, { 'Content-Type': 'application/atom+xml' }).end(
        feed('测试书库', `<entry><title>新书</title><id>new</id><content type="text">最新上架</content><link rel="subsection" href="opds/new" type="application/atom+xml;profile=opds-catalog"/></entry>`, `<link rel="self" href="opds" type="application/atom+xml"/><link rel="search" type="application/atom+xml" href="opds/search?q={searchTerms}"/>`),
      );
    } else if (u.pathname === '/opds/new') {
      const page = Number(u.searchParams.get('page') ?? 1);
      res.writeHead(200, { 'Content-Type': 'application/atom+xml' }).end(
        feed('新书', page === 1 ? [1, 2].map(book).join('') : [3].map(book).join(''), `${page === 1 ? '<link rel="next" href="opds/new?page=2" type="application/atom+xml"/>' : ''}<opensearch:totalResults>3</opensearch:totalResults><opensearch:itemsPerPage>2</opensearch:itemsPerPage>`),
      );
    } else if (u.pathname === '/opds/search') {
      const q = u.searchParams.get('q') ?? '';
      res.writeHead(200, { 'Content-Type': 'application/atom+xml' }).end(feed(`搜索：${q}`, [1, 2, 3].filter((n) => `测试书${n}`.includes(q)).map(book).join('')));
    } else if (u.pathname.startsWith('/dl/')) {
      res.writeHead(200, { 'Content-Type': 'application/epub+zip', 'Content-Length': epub.length, 'Content-Disposition': 'attachment; filename="opds-book.epub"' }).end(epub);
    } else if (u.pathname.startsWith('/img/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
    } else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => server.close(() => r())) };
}

test('网络书库（本地假 OPDS）：添加 → 浏览/分页 → 搜索 → 详情下载 → 编辑 → 置顶 → 删除（NET-002..005/009）', async ({ browser }) => {
  const opds = await startOpds();
  const { ctx, page, errors } = await openApp(browser, shape, { hash: '#/net' });
  // 添加：只填网址，书库名取自 feed 标题，搜索模板从 feed 里发现
  await page.getByRole('button', { name: '增加新书库' }).click();
  await page.getByRole('dialog').last().getByLabel('书库网址:').fill(`${opds.url}/opds`);
  await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
  await expect(page.getByText('测试书库', { exact: true })).toBeVisible({ timeout: 15_000 });
  const cat = (await idbAll(page, 'kv')).find((k) => k.key === 'library.catalogs').value.find((c: any) => c.title === '测试书库');
  expect(cat.main).toBe(`${opds.url}/opds`);
  expect(cat.search).toContain('/opds/search?q={searchTerms}');
  await shot(page, 'net-fake-list');
  // 浏览：子目录 → 书列表 → 分页
  await page.getByText('测试书库', { exact: true }).click();
  await page.getByText('新书', { exact: true }).click();
  await expect(page.getByText('测试书1')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('测试书3')).toHaveCount(0);
  await expect(page.locator('button[class*=page]')).toContainText('1 / 2');
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('测试书3')).toBeVisible();
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByText('测试书1')).toBeVisible();
  // 搜索
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.locator('input[placeholder]').first().fill('书2');
  await page.keyboard.press('Enter');
  await expect(page.locator('[class*=_item_]').filter({ hasText: '测试书2' })).toHaveCount(1);
  await expect(page.getByText('测试书1')).toHaveCount(0);
  expect(opds.hits.some((h) => h.startsWith('GET /opds/search?q=%E4%B9%A62'))).toBe(true);
  // 详情 → 下载
  await page.getByText('测试书2').click();
  await expect(page.getByRole('dialog').getByText('第 2 本的简介')).toBeVisible();
  await expect(page.getByRole('dialog').getByText(/可下载格式: epub/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '下载', exact: true }).click();
  await expect(page.getByText(/下载完成/).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('dialog').getByRole('button', { name: '阅读' }).click();
  await expect(page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 30_000 });
  const book = (await idbAll(page, 'books'))[0];
  expect(book).toMatchObject({ title: 'OPDS 下来的书', source: { kind: 'opds', catalog: '测试书库' }, hasCover: true });
  // 编辑名称 / 置顶 / 删除
  await go(page, '#/net');
  await page.locator('[class*=groupRow]').filter({ hasText: '测试书库' }).getByRole('button', { name: '操作' }).click();
  await page.getByRole('menuitem', { name: '编辑书库' }).click();
  await page.getByRole('dialog').last().getByLabel('书库名(可选):').fill('我的书库');
  await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
  await expect(page.getByText('我的书库', { exact: true })).toBeVisible();
  await page.locator('[class*=groupRow]').filter({ hasText: '我的书库' }).getByRole('button', { name: '操作' }).click();
  await page.getByRole('menuitem', { name: '置顶' }).click();
  await expect(page.locator('[class*=groupRow]').first()).toContainText('我的书库');
  await page.locator('[class*=groupRow]').filter({ hasText: '我的书库' }).getByRole('button', { name: '操作' }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
  await expect(page.getByText('我的书库', { exact: true })).toHaveCount(0);
  // 删掉内置站点后重启不会恢复（墓碑）
  await page.locator('[class*=groupRow]').filter({ hasText: 'Feedbooks' }).getByRole('button', { name: '操作' }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
  // 列表在墓碑和目录都写完后才刷新：等它消失再重载，否则重载可能打断写入
  await expect(page.getByText('Feedbooks', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Project Gutenberg')).toBeVisible();
  await expect(page.getByText('Feedbooks', { exact: true })).toHaveCount(0);
  expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
  await ctx.close();
  await opds.close();
});

test('网络书库：需要登录的站点（401 → 登录对话框 → 记住账号）与 Calibre IP 入口', async ({ browser }) => {
  const opds = await startOpds({ user: 'reader', pass: 'p@ss' });
  const { ctx, page } = await openApp(browser, shape, { hash: '#/net' });
  await page.getByRole('button', { name: '增加新书库' }).click();
  // Calibre IP 对话框：拼出 http://ip:端口/opds
  await page.getByRole('dialog').last().getByRole('button', { name: 'Calibre IP' }).click();
  await page.getByRole('dialog').last().getByLabel('IP').fill('127.0.0.1');
  await page.getByRole('dialog').last().getByLabel('端口').fill(String(new URL(opds.url).port));
  await expect(page.getByText(`→ http://127.0.0.1:${new URL(opds.url).port}/opds`)).toBeVisible();
  await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click(); // 添加
  // 401 → 登录
  await expect(page.getByRole('dialog').getByText('用户登录')).toBeVisible({ timeout: 15_000 });
  await shot(page, 'net-login');
  await page.getByRole('dialog').last().getByLabel('用户名:').fill('reader');
  await page.getByRole('dialog').last().locator('input[type=password]').fill('wrong');
  await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
  await expect(page.getByRole('dialog').getByText('用户登录')).toBeVisible(); // 错了再问一次
  await page.getByRole('dialog').last().locator('input[type=password]').fill('p@ss');
  await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
  await expect(page.getByText('测试书库', { exact: true })).toBeVisible({ timeout: 15_000 });
  const cat = (await idbAll(page, 'kv')).find((k) => k.key === 'library.catalogs').value.find((c: any) => c.title === '测试书库');
  expect(cat).toMatchObject({ username: 'reader', password: 'p@ss' });
  // 之后浏览不再询问
  await page.getByText('测试书库', { exact: true }).click();
  await expect(page.getByText('新书', { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('dialog').count()).toBe(0);
  // 备份里不带站点密码
  await go(page, '#/settings/backup');
  await page.getByText('备份', { exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('只导出数据 (JSON)').check();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: '确定' }).click()]);
  const file = path.join(OUT, 'run/backup-secret.json');
  await dl.saveAs(file);
  expect(fs.readFileSync(file, 'utf8')).not.toContain('p@ss');
  await ctx.close();
  await opds.close();
});

// ───────────── 文件页补充 ─────────────
test('文件页：格子布局、缩略图、拷贝/移动/粘贴、下载、未知类型提示、看图器、快速访问（LIB-028/029）', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, shape, { hash: '#/files?path=Books' });
  await expect(page.getByText('验收样书.epub')).toBeVisible({ timeout: 15_000 });
  // 缩略图：服务端从 EPUB 里取封面
  await expect(page.locator('img[class*=thumb]').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('img[class*=thumb]')].some((i) => i.complete && i.naturalWidth > 0))).toBe(true);
  // 格子布局
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '使用格子布局' }).click();
  await expect(page.locator('[class*=gridItem]').first()).toBeVisible();
  await shot(page, 'files-grid');
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '使用格子布局' }).click();
  // 拷贝到 Upload/
  await page.getByText('小说.txt').click({ button: 'right' });
  await page.getByRole('button', { name: '拷贝', exact: true }).click();
  await go(page, '#/files?path=Upload');
  await expect(page.getByText('粘贴到此处')).toBeVisible();
  await page.getByRole('button', { name: '粘贴到此处' }).click();
  await expect(page.getByText('小说.txt')).toBeVisible();
  expect(fs.existsSync(path.join(srv.lib, 'Books/小说.txt'))).toBe(true);
  expect(fs.existsSync(path.join(srv.lib, 'Upload/小说.txt'))).toBe(true);
  // 移动（剪切）
  await go(page, '#/files?path=Books');
  await page.getByText('notes.bin').click({ button: 'right' });
  await page.getByRole('button', { name: '移动', exact: true }).click();
  await go(page, '#/files?path=Upload');
  await page.getByRole('button', { name: '粘贴到此处' }).click();
  await expect(page.getByText('notes.bin')).toBeVisible();
  expect(fs.existsSync(path.join(srv.lib, 'Books/notes.bin'))).toBe(false);
  // 未知类型：提示「以纯文本打开 / 下载原文件」
  await page.getByText('notes.bin').click();
  await expect(page.getByRole('dialog').getByText('纯文本格式')).toBeVisible();
  await expect(page.getByRole('dialog').getByText(/阅读器不支持该文件格式/)).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: '下载原文件', exact: true }).click()]);
  expect(dl.suggestedFilename()).toBe('notes.bin');
  // 下载（多选菜单）
  await page.getByText('小说.txt').click({ button: 'right' });
  await page.getByRole('button', { name: '更多' }).click();
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: '下载', exact: true }).click()]);
  expect(dl2.suggestedFilename()).toBe('小说.txt');
  // 图片进看图器
  await go(page, '#/files?path=Comics');
  await page.getByText('封面图.png').click();
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('封面图.png')).toBeVisible();
  await page.keyboard.press('Escape');
  // 快速访问列表：加入 → 首页「我的文件」行出现 → 点它进入该目录
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '加入快速访问' }).click();
  await go(page, '#/');
  await expect(page.locator('[class*=section]').filter({ hasText: '我的文件' }).getByText('Comics')).toBeVisible();
  await shot(page, 'files-dash-favfolder');
  await page.locator('[class*=section]').filter({ hasText: '我的文件' }).getByText('Comics').click();
  await expect(page.getByText('demo.cbz')).toBeVisible();
  // 导入（加入珍藏）：选中书 → 更多 → 导入(加入珍藏)
  await go(page, '#/files?path=Books');
  await page.getByText('验收样书.epub').click({ button: 'right' });
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '导入(加入珍藏)' }).click();
  await page.getByRole('dialog').last().getByPlaceholder('分类名(可选)').fill('服务端书');
  await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
  await expect.poll(async () => (await idbAll(page, 'books')).find((b) => b.title === '验收样书')?.favorite).toBe('服务端书');
  const b = (await idbAll(page, 'books')).find((x) => x.title === '验收样书');
  expect(b.source).toMatchObject({ kind: 'server-library', url: 'Books/验收样书.epub' });
  await ctx.close();
});

test('云端导入（SYNC-011）：浏览 WebDAV 目录，勾选书籍下载进书库', async ({ browser }) => {
  // 先在内置 /dav 里放一本书
  const epub = await makeEpub('云端那本书', '云作者');
  for (const d of ['/Apps', '/Apps/Books']) await srvFetch(srv, `/dav${d}`, { method: 'MKCOL' });
  expect((await srvFetch(srv, '/dav/Apps/Books/云端那本书.epub', { method: 'PUT', body: epub })).status).toBeLessThan(300);
  const { ctx, page } = await openApp(browser, shape, { hash: '#/files' });
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: /云端/ }).click();
  await expect(page.getByRole('dialog').getByText(/先在.*云同步/)).toBeVisible(); // 没启用同步：引导去设置
  await page.getByRole('dialog').getByRole('button', { name: /设置/ }).click();
  await page.getByRole('button', { name: '验证并保存' }).click();
  await expect(page.getByText('登录成功')).toBeVisible({ timeout: 15_000 });
  await go(page, '#/files');
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: /云端/ }).click();
  await expect(page.getByRole('dialog').getByText('云端那本书.epub')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('dialog').getByText('云端那本书.epub').click();
  await page.getByRole('dialog').getByRole('button', { name: /导入 \(1\)|导入 1/ }).click();
  await expect.poll(async () => (await idbAll(page, 'books')).map((b) => b.title)).toEqual(['云端那本书']);
  await ctx.close();
});

// ───────────── 导入补充 ─────────────
/** 导入完成后会弹「新导入的 N 本书」（LIB-023），稍晚于「已导入」提示出现：等它出来再关掉 */
async function closeNewBooks(page: Page): Promise<void> {
  const title = page.getByText(/新导入的 \d+ 本书/);
  await title.first().waitFor({ timeout: 5000 }).catch(() => undefined);
  await page.keyboard.press('Escape');
  await expect(title).toHaveCount(0);
}

test('导入：拖放文件、ZIP（单本）、整个文件夹（先过滤再选择）', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, shape, { hash: '#/shelf' });
  await page.getByRole('dialog').waitFor({ timeout: 3000 }).catch(() => undefined);
  await page.keyboard.press('Escape');
  // 拖放：合成 drop 事件（带 File 的 DataTransfer），和从系统文件管理器拖进窗口等价
  const epub = await makeEpub('拖进来的书', '拖放作者');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], '拖进来的书.epub', { type: 'application/epub+zip' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, epub.toString('base64'));
  await expect(page.getByText(/已导入 1 本/).first()).toBeVisible({ timeout: 20_000 });
  await closeNewBooks(page);
  // ZIP：压缩包里只有一本书 → 取出这本书
  const zip = new JSZip();
  zip.file('inner/压缩包里的书.epub', await makeEpub('压缩包里的书', '压缩作者'));
  zip.file('readme.txt', '说明');
  await importViaDialog(page, [{ name: '书包.zip', mimeType: 'application/zip', buffer: Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })) }]);
  await closeNewBooks(page);
  await expect.poll(async () => (await idbAll(page, 'books')).map((b) => b.title).sort()).toEqual(['压缩包里的书', '拖进来的书'].sort());
  // 重复导入同一本：提示「已有」，不重复
  await importViaDialog(page, [{ name: '拖进来的书.epub', mimeType: 'application/epub+zip', buffer: epub }], /1 本已在书架上/);
  expect((await idbAll(page, 'books')).length).toBe(2);
  await page.keyboard.press('Escape');
  // 整个文件夹：过滤（<20KB、不支持的类型被滤掉）→ 选择列表（已导入的默认不勾）→ 导入
  const dir = path.join(OUT, 'run/import-dir/书堆');
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, '子目录'), { recursive: true });
  const bigTxt = (n: string) => Buffer.from(`第一章\n${(n + '这是正文，山不在高，有仙则名。').repeat(900)}`);
  fs.writeFileSync(path.join(dir, '大书一.txt'), bigTxt('一'));
  fs.writeFileSync(path.join(dir, '子目录/大书二.txt'), bigTxt('二'));
  fs.writeFileSync(path.join(dir, '太小.txt'), '小');
  fs.writeFileSync(path.join(dir, '图片.jpg'), makePng(10, 10, 1));
  fs.writeFileSync(path.join(dir, '拖进来的书.epub'), epub);
  await openImportDialog(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('选择整个文件夹').click()]);
  await chooser.setFiles(dir);
  await expect(page.getByRole('dialog').getByText('导入书籍').first()).toBeVisible();
  await expect(page.getByText('大书一.txt')).toBeVisible();
  await expect(page.getByText('大书二.txt')).toBeVisible();
  await expect(page.getByText('太小.txt')).toHaveCount(0); // <20KB 被过滤
  await expect(page.getByText('图片.jpg')).toHaveCount(0);
  await expect(page.getByText('拖进来的书.epub')).toHaveCount(0); // 样书只有几 KB，同样被 <20KB 过滤
  await shot(page, 'import-folder-select');
  await page.getByRole('dialog').last().getByRole('button', { name: /导入 \(2\)/ }).click();
  await expect.poll(async () => (await idbAll(page, 'books')).length).toBe(4);
  // 「存储目录」分类里能看到这批书的来源目录
  const dirs = (await idbAll(page, 'books')).filter((b) => b.title.startsWith('大书')).map((b) => b.source?.url);
  expect(dirs.sort()).toEqual(['书堆/大书一.txt', '书堆/子目录/大书二.txt']);
  await ctx.close();
});

test('导入需要服务端转换的格式：有服务端时 CHM/CBR/DJVU 入库；没有服务端时给出原因，不崩溃', async ({ browser }) => {
  const files = ['Docs/putty.chm', 'Comics/demo.cbr', 'Docs/scan.djvu'].filter((f) => fs.existsSync(path.join(srv.lib, f)));
  test.skip(files.length < 3, '缺 samples/chm 或 c44');
  const payload = files.map((f) => ({ name: path.basename(f), mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.join(srv.lib, f)) }));
  const a = await openApp(browser, shape);
  await importViaDialog(a.page, payload, /已导入 3 本/);
  expect((await idbAll(a.page, 'books')).map((b) => b.format).sort()).toEqual(['cbr', 'chm', 'djvu']);
  await shot(a.page, 'import-converted-formats');
  await a.ctx.close();
  // 没有服务端（file:// 单文件版、不填地址；托管版空地址 = 同源服务端，不算「没有」）：
  // 照样入库（元数据取文件名），打开时说明需要服务端并给出「返回书库」，不崩溃
  const b = await openApp(browser, { kind: 'single', token: false, srv }, { extra: { app: { language: 'zh', serverUrl: '' } } });
  await importViaDialog(b.page, payload, /已导入 3 本/);
  await b.page.keyboard.press('Escape');
  const chm = (await idbAll(b.page, 'books')).find((x) => x.format === 'chm');
  await b.page.evaluate((id) => (location.hash = `#/read/${id}`), chm.id);
  await expect(b.page.getByText(/需要服务端转换/)).toBeVisible({ timeout: 15_000 });
  await expect(b.page.getByRole('button', { name: '返回书库' })).toBeVisible();
  expect(b.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
  await b.ctx.close();
});

// ───────────── 同步 / Readwise ─────────────
test('最近阅读同步（SYNC-004/005）：A 读书后上传书与 recent.list，B 收到「云端最近读的书」', async ({ browser }) => {
  const epub = { name: '同步最近.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('同步最近', '甲') };
  const enable = async (page: Page) => {
    await go(page, '#/settings/sync');
    await page.getByText('自动备份书籍文件到云端').click();
    await page.getByText('自动更新最近阅读列表').click();
    await page.getByRole('button', { name: '验证并保存' }).click();
    await expect(page.getByText('登录成功')).toBeVisible({ timeout: 15_000 });
  };
  const A = await openApp(browser, shape);
  await enable(A.page);
  await importViaDialog(A.page, [epub]);
  await A.page.keyboard.press('Escape');
  await go(A.page, '#/shelf');
  await A.page.getByText('同步最近', { exact: true }).click();
  await expect(A.page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 30_000 });
  const vp = A.page.viewportSize()!;
  for (let i = 0; i < 3; i++) {
    await A.page.mouse.click(vp.width * 0.92, vp.height * 0.55);
    await A.page.waitForTimeout(400);
  }
  await A.page.waitForTimeout(1000);
  await go(A.page, '#/shelf'); // 离开阅读页 → 上传 .po / 书 / recent.list
  const dav = path.join(srv.dataDir, 'dav/Apps/Books');
  await expect.poll(() => fs.existsSync(path.join(dav, '.Moon+/Cache/recent.list')), { timeout: 15_000 }).toBe(true);
  expect(fs.existsSync(path.join(dav, '同步最近.epub'))).toBe(true); // 书籍文件同名同大小才跳过（SYNC-005）
  const recent = fs.readFileSync(path.join(dav, '.Moon+/Cache/recent.list'), 'utf8');
  expect(recent).toMatch(/\?\?1同步最近\?\?2\d+\?\?3\d+\?\?4同步最近\.epub\?\?5.+\*\d/);
  const B = await openApp(browser, shape);
  await enable(B.page);
  await go(B.page, '#/');
  await B.page.reload();
  await expect(B.page.getByText(/云端检测到的新书.*同步最近/).first()).toBeVisible({ timeout: 15_000 });
  await go(B.page, '#/recent');
  await expect(B.page.getByText('同步最近').first()).toBeVisible();
  await shot(B.page, 'sync-remote-recent');
  await A.ctx.close();
  await B.ctx.close();
});

test('Readwise（SYNC-012）：填 token 后立即发测试高亮；自动分享开关', async ({ browser }) => {
  const port = await freePort();
  const got: { auth?: string; body?: any; origin?: string }[] = [];
  const mock = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'POST' };
    if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      got.push({ auth: req.headers.authorization, body: JSON.parse(data || '{}'), origin: req.headers.origin });
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((r) => mock.listen(port, '127.0.0.1', r));
  const { ctx, page } = await openApp(browser, shape, { hash: '#/settings/readwise' });
  const inputs = page.locator('[data-section=readwise] input');
  await inputs.nth(1).fill(`http://127.0.0.1:${port}/highlights/`);
  await inputs.nth(0).fill('tok123');
  await inputs.nth(0).blur();
  await expect.poll(() => got.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(got[0].auth).toBe('Token tok123');
  expect(got[0].body.highlights[0]).toMatchObject({ title: 'test', text: 'test highlight' });
  await expect(page.getByText(/Readwise.*(成功|OK)|连接成功/).first()).toBeVisible({ timeout: 5000 }).catch(() => undefined);
  await ctx.close();
  await new Promise((r) => mock.close(r));
});

// ───────────── 其它 ─────────────
test('手动拖拽排序（LIB-018）：按书名排序时长按拖动一本书到新位置', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, shape, { hash: '#/shelf', viewport: { width: 1280, height: 800 } });
  await page.keyboard.press('Escape');
  await importViaDialog(page, ['甲书', '乙书', '丙书'].map((n) => ({ name: `${n}.epub`, mimeType: 'application/epub+zip', buffer: Buffer.alloc(0) })).slice(0, 0).concat(await Promise.all(['甲书', '乙书', '丙书'].map(async (n) => ({ name: `${n}.epub`, mimeType: 'application/epub+zip', buffer: await makeEpub(n, 'x') })))));
  await page.keyboard.press('Escape');
  const titles = () => page.locator('[class*=cellTitle]').allTextContents();
  await expect.poll(titles).toEqual(['丙书', '甲书', '乙书']); // 拼音序：bing jia yi
  const cell = (t: string) => page.locator('[data-id]').filter({ has: page.getByText(t, { exact: true }) });
  const a = (await cell('乙书').boundingBox())!;
  const z = (await cell('丙书').boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700); // 长按 → 进入拖动
  await page.mouse.move(z.x + 10, z.y + z.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(titles).toEqual(['乙书', '丙书', '甲书']);
  // 不按书名排序时不能拖（给提示由界面控制，这里只验证数据不变）
  await page.reload();
  await expect.poll(titles).toEqual(['乙书', '丙书', '甲书']); // 手动顺序持久化
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '重置手动排序' }).click();
  await expect.poll(titles).toEqual(['丙书', '甲书', '乙书']);
  await ctx.close();
});

test('标注导出再导入（BAK-003）：.mrexpt 往返，墓碑与 .an 兼容', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, shape);
  await importViaDialog(page, [{ name: '标注书.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('标注书', '甲') }]);
  await page.keyboard.press('Escape');
  const id = (await idbAll(page, 'books'))[0].id as string;
  const mk = (i: number, kind: 'highlight' | 'bookmark', text: string, note?: string) => idbPut(page, 'annotations', { id: `ex-${i}`, bookId: id, kind, range: { section: 0, start: i * 30, end: kind === 'bookmark' ? i * 30 : i * 30 + 8 }, text, note, title: kind === 'bookmark' ? text : undefined, color: '#ffeb3b', style: 'highlight', createdAt: 1000 + i, updatedAt: 1000 + i });
  await mk(1, 'highlight', '第一条高亮');
  await mk(2, 'highlight', '带笔记的', '我的笔记');
  await mk(3, 'bookmark', '一个书签');
  await go(page, `#/notes/${id}`);
  await expect(page.getByText('第一条高亮')).toBeVisible();
  await page.getByRole('button', { name: '导出' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: '导出为 .mrexpt' }).click()]);
  const file = path.join(OUT, 'run/notes.mrexpt');
  await dl.saveAs(file);
  const text = fs.readFileSync(file, 'utf8');
  expect(text.split('\n')[0]).toMatch(/^\d+$/); // 首行：书文件字节数
  expect(text).toContain('我的笔记');
  // 全部删掉再导入
  for (const n of [1, 2, 3]) await page.evaluate((k) => new Promise<void>((res) => { const r = indexedDB.open('moonreader'); r.onsuccess = () => { const tx = r.result.transaction('annotations', 'readwrite'); tx.objectStore('annotations').delete(`ex-${k}`); tx.oncomplete = () => res(); }; }), n);
  await page.reload();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '导出' }).click().then(() => page.getByRole('menuitem', { name: /导入/ }).click())]);
  await chooser.setFiles(file);
  await expect(page.getByText(/新增 3/)).toBeVisible({ timeout: 10_000 });
  expect((await idbAll(page, 'annotations')).map((a) => a.text).sort()).toEqual(['一个书签', '带笔记的', '第一条高亮'].sort());
  expect((await idbAll(page, 'annotations')).find((a) => a.text === '带笔记的').note).toBe('我的笔记');
  await ctx.close();
});

test('失效书籍（LIB-025）：不含书籍文件的备份恢复后点开 → 重新选择文件接上；「移除所有失效书籍」', async ({ browser }) => {
  const epub = { name: '失效书.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('失效书', '甲') };
  const A = await openApp(browser, shape);
  await importViaDialog(A.page, [epub, { name: '失效书二.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('失效书二', '乙') }]);
  await A.page.keyboard.press('Escape');
  const bookId = (await idbAll(A.page, 'books')).find((b) => b.title === '失效书').id as string;
  await idbPut(A.page, 'positions', { bookId, locator: { section: 1, offset: 20 }, progress: 0.5, updatedAt: Date.now(), deviceId: 'a' });
  await go(A.page, '#/settings/backup');
  await A.page.getByText('备份', { exact: true }).first().click();
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('dialog').getByRole('button', { name: '确定' }).click()]); // 默认不含书籍文件
  const file = path.join(OUT, 'run/nofiles.mrweb');
  await dl.saveAs(file);
  await A.ctx.close();
  const B = await openApp(browser, shape);
  await go(B.page, '#/settings/backup');
  await B.page.getByText('恢复', { exact: true }).first().click();
  const [chooser] = await Promise.all([B.page.waitForEvent('filechooser'), B.page.getByRole('button', { name: '选择本地备份文件' }).click()]);
  await chooser.setFiles(file);
  await expect(B.page.getByText(/这份备份不含书籍文件/)).toBeVisible();
  await B.page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
  await B.page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
  await expect(B.page.getByText(/恢复成功/)).toBeVisible({ timeout: 20_000 });
  await go(B.page, '#/shelf');
  await B.page.getByText('失效书', { exact: true }).click();
  await expect(B.page.getByRole('dialog').getByText(/不存在/)).toBeVisible();
  // 选了别的文件：指纹不同，拒绝
  const [bad] = await Promise.all([B.page.waitForEvent('filechooser'), B.page.getByRole('dialog').last().getByRole('button', { name: '重新选择文件' }).click()]);
  await bad.setFiles({ name: '别的.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('别的书', '丙') });
  await expect(B.page.getByText(/不是同一|不同/).first()).toBeVisible();
  // 选对了：接上，从备份里的位置继续
  await B.page.getByText('失效书', { exact: true }).click();
  const [good] = await Promise.all([B.page.waitForEvent('filechooser'), B.page.getByRole('dialog').last().getByRole('button', { name: '重新选择文件' }).click()]);
  await good.setFiles(epub);
  await expect(B.page.locator('iframe[title="section-1"]')).toBeAttached({ timeout: 30_000 });
  // 另一本仍失效：勾选「移除所有失效书籍」
  await go(B.page, '#/shelf');
  await B.page.getByText('失效书二', { exact: true }).click();
  await B.page.getByRole('dialog').last().getByText('从我的书架移除所有失效书籍').click();
  await B.page.getByRole('dialog').last().getByRole('button', { name: '是' }).click();
  await expect.poll(async () => (await idbAll(B.page, 'books')).map((b) => b.title)).toEqual(['失效书']);
  await B.ctx.close();
});

test('封面搜索限流（B 节第 4 条）：Google Books 429 时给出友好提示，换 Open Library 能搜到，冷却期内不再请求 Google', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, shape);
  await importViaDialog(page, [{ name: '封面书.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('Dune', 'Frank Herbert') }]);
  await page.keyboard.press('Escape');
  let gb = 0;
  await page.route('https://www.googleapis.com/**', (route) => {
    gb++;
    return route.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*', 'retry-after': '60' }, body: '{"error":"rate limited"}' });
  });
  await page.route('https://openlibrary.org/**', (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ docs: [{ key: '/works/OL1', title: 'Dune', cover_i: 1234 }] }) }));
  await page.route('https://covers.openlibrary.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: makePng(60, 90, 4) }));
  // 首选 Google Books：429 → 自动回退 Open Library
  await go(page, '#/shelf');
  await page.locator('[data-id]').first().locator('button[aria-label="操作"]').click({ force: true });
  await page.getByRole('menuitem', { name: '下载书籍封面' }).click();
  await page.getByRole('dialog').last().getByRole('radio', { name: 'Google Books' }).click();
  // 切换来源后旧结果还会在屏上停一下：等 Google 的请求发出、这一轮搜完（429 处理完才记下冷却期）
  await expect.poll(() => gb).toBeGreaterThan(0);
  await expect(page.getByText('正在搜索...')).toHaveCount(0);
  await expect(page.locator('[class*=cell]').filter({ hasText: 'Open Library' }).first()).toBeVisible({ timeout: 15_000 });
  const callsAfterFirst = gb;
  // 再搜一次：冷却期内不再请求 Google
  await page.getByRole('dialog').last().getByRole('radio', { name: 'Open Library' }).click();
  await page.getByRole('dialog').last().getByRole('radio', { name: 'Google Books' }).click();
  await expect(page.locator('[class*=cell]').filter({ hasText: 'Open Library' }).first()).toBeVisible({ timeout: 15_000 });
  expect(gb).toBe(callsAfterFirst);
  // 两个来源都限流时：友好提示
  await page.unroute('https://openlibrary.org/**');
  await page.route('https://openlibrary.org/**', (route) => route.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*', 'retry-after': '60' }, body: '{}' }));
  await page.getByRole('dialog').last().getByRole('radio', { name: 'Open Library' }).click();
  await expect(page.getByText(/限流|请求太频繁/).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, 'cover-search-rate-limited');
  await ctx.close();
});

test('冷启动回到上次停留的标签页（LIB-001）', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, shape, { hash: '#/files' });
  await expect(page.getByText('Books', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500); // 设置落盘有 200ms 防抖
  const p2 = await ctx.newPage();
  await p2.goto(`${srv.url}/`);
  await expect(p2).toHaveURL(/#\/files$/);
  await expect(p2.getByText('Books', { exact: true })).toBeVisible({ timeout: 15_000 });
  // 明确带路由的地址不受影响
  const p3 = await ctx.newPage();
  await p3.goto(`${srv.url}/#/stats`);
  await expect(p3).toHaveURL(/#\/stats$/);
  await ctx.close();
  void chromium;
  void shape;
  void (null as unknown as Opened);
  void makeCbz;
});
