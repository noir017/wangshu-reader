// 部署形态验收：同一套功能，在「服务端托管整站」与「file:// 打开单文件版（设置里填服务端地址）」两种形态下，
// 分别在服务端没设 / 设了 MR_TOKEN 时都要跑通。服务端是 esbuild 打出来的真实产物，网络书库连真实 Gutenberg。
// 端口：5411 托管/无令牌、5412 托管/令牌、5413 单文件/无令牌、5414 单文件/令牌（5415–5416 给跨源用例）。
import { chromium, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import {
  OUT,
  appUrl,
  go,
  importViaDialog,
  makeCbz,
  makeEpub,
  openApp,
  shapeLabel,
  shot,
  srvFetch,
  startServer,
  type Shape,
  type Srv,
} from './accept.library.helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const TOKEN = 'tok-æ-12345';
const SHAPES: { kind: Shape['kind']; token: boolean; port: number }[] = [
  { kind: 'hosted', token: false, port: 5411 },
  { kind: 'hosted', token: true, port: 5412 },
  { kind: 'single', token: false, port: 5413 },
  { kind: 'single', token: true, port: 5414 },
];

/** IndexedDB 里读一个 store（直接用原生 API，不依赖应用内部模块） */
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

for (const sp of SHAPES) {
  const label = shapeLabel(sp);
  // 调试时可用 SHAPE=hosted,single-token 只跑部分形态
  if (process.env.SHAPE && !process.env.SHAPE.split(',').includes(`${sp.kind}${sp.token ? '-token' : ''}`)) continue;
  test.describe(`部署形态：${label}`, () => {
    let srv: Srv;
    let shape: Shape;
    const tag = `${sp.kind}${sp.token ? '-token' : ''}`;

    test.beforeAll(async () => {
      srv = await startServer({ port: sp.port, token: sp.token ? TOKEN : undefined, serve: sp.kind === 'hosted' ? 'std' : undefined });
      shape = { kind: sp.kind, token: sp.token, srv };
    });
    test.afterAll(async () => {
      await srv.stop();
    });

    test('设置页「服务端」检测通过，/api/health 能力齐全', async ({ browser }) => {
      const { ctx, page, errors } = await openApp(browser, shape, { hash: '#/settings/server' });
      await expect(page.getByText('服务端地址')).toBeVisible();
      await page.getByRole('button', { name: '检测连接' }).click();
      await expect(page.getByText(/服务端连接正常/).first()).toBeVisible({ timeout: 10_000 });
      await shot(page, `deploy-${tag}-settings-server`);
      expect(errors).toEqual([]);
      await ctx.close();
    });

    test('网络书库：真实 Gutenberg 搜索 → 详情 → 下载 → 入书架', async ({ browser }) => {
      const { ctx, page } = await openApp(browser, shape, { hash: '#/net' });
      await page.getByText('Project Gutenberg').first().click();
      const items = page.locator('[class*=_item_]');
      await expect(items.first()).toBeVisible({ timeout: 30_000 });
      await shot(page, `deploy-${tag}-net-root`);
      // 搜索
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await page.locator('input').first().fill('Alice Wonderland');
      await page.keyboard.press('Enter');
      await expect(items.filter({ hasText: /Alice/i }).first()).toBeVisible({ timeout: 30_000 });
      await shot(page, `deploy-${tag}-net-search`);
      // 进入「Alice's Adventures in Wonderland」（搜索结果里同名的有好几本，取第一本有 epub 的）
      await items.filter({ hasText: /Alice's Adventures in Wonderland/i }).first().click();
      // Gutenberg 的搜索结果是「这本书的各个版本」目录，再点一层才是带下载链接的书
      const asBook = items.filter({ hasText: /epub/ }).first();
      await expect(asBook).toBeVisible({ timeout: 30_000 });
      await shot(page, `deploy-${tag}-net-versions`);
      await asBook.click();
      await expect(page.getByRole('dialog').getByText(/可下载格式/)).toBeVisible({ timeout: 30_000 });
      await shot(page, `deploy-${tag}-net-book`);
      await page.getByRole('dialog').getByRole('button', { name: '下载', exact: true }).click();
      // 多个格式时先选格式：取 epub
      const pick = page.getByRole('dialog').getByText(/下载 \d+: epub/).first();
      if (await pick.isVisible().catch(() => false)) await pick.click();
      await expect(page.getByText(/下载完成/).first()).toBeVisible({ timeout: 90_000 });
      await page.keyboard.press('Escape');
      await go(page, '#/shelf');
      await expect(page.getByText(/Alice/i).first()).toBeVisible();
      const books = await idbAll(page, 'books');
      expect(books.some((b) => /alice/i.test(b.title) && b.format === 'epub' && b.size > 20_000)).toBe(true);
      expect(books[0].source?.kind).toBe('opds');
      await shot(page, `deploy-${tag}-net-shelf`);
      await ctx.close();
    });

    test('文件页：浏览 / 面包屑 / 排序 / 搜索 / 新建 / 上传 / 改名 / 删除 / ZIP 包内浏览', async ({ browser }) => {
      const { ctx, page } = await openApp(browser, shape, { hash: '#/files' });
      await expect(page.getByText('Books', { exact: true })).toBeVisible({ timeout: 15_000 });
      await shot(page, `deploy-${tag}-files-root`);
      // 隐藏目录默认不显示
      await expect(page.getByText('.hidden')).toHaveCount(0);
      await page.getByText('Books', { exact: true }).click();
      await expect(page.getByText('验收样书.epub')).toBeVisible();
      // EPUB 缩略图走服务端封面接口（我们的样书没有封面 → 回退成图标，不应该有破图请求被当成错误）
      await expect(page.locator('[class*=crumb]').filter({ hasText: 'Books' }).first()).toBeVisible();
      // 上传：「⋮ → 上传到此处」
      await page.getByRole('button', { name: '更多' }).click();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: '上传到此处' }).click()]);
      await chooser.setFiles([{ name: '上传的书.txt', mimeType: 'text/plain', buffer: Buffer.from('上传内容 '.repeat(50)) }]);
      await expect(page.getByText('上传的书.txt')).toBeVisible({ timeout: 15_000 });
      expect(fs.readFileSync(path.join(srv.lib, 'Books/上传的书.txt'), 'utf8')).toContain('上传内容');
      // 新建目录
      await page.getByRole('button', { name: '更多' }).click();
      await page.getByRole('menuitem', { name: '新建目录' }).click();
      await page.getByRole('dialog').locator('input').fill('子目录A');
      await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
      await expect(page.getByText('子目录A')).toBeVisible();
      expect(fs.statSync(path.join(srv.lib, 'Books/子目录A')).isDirectory()).toBe(true);
      // 改名：右键进入多选 → 改名
      await page.getByText('上传的书.txt').click({ button: 'right' });
      await page.getByRole('button', { name: '改名', exact: true }).click();
      await page.getByRole('dialog').locator('input').fill('改名后的书.txt');
      await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
      await expect(page.getByText('改名后的书.txt')).toBeVisible();
      expect(fs.existsSync(path.join(srv.lib, 'Books/改名后的书.txt'))).toBe(true);
      expect(fs.existsSync(path.join(srv.lib, 'Books/上传的书.txt'))).toBe(false);
      await shot(page, `deploy-${tag}-files-renamed`);
      // 排序：按名称降序后第一项应是目录之外字典序最大的文件
      await page.getByRole('button', { name: '更多' }).click();
      await page.getByRole('menuitem', { name: /排序/ }).click();
      await page.getByRole('dialog').getByText('名称 ↓').click();
      const names = await page.locator('[class*=itemTitle]').allTextContents();
      expect(names.indexOf('子目录A')).toBe(0); // 目录永远在前
      // 搜索（递归文件名）
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await page.locator('input').first().fill('验收');
      await page.keyboard.press('Enter');
      await expect(page.locator('[class*=itemTitle]')).toHaveText(['验收样书.epub']);
      await expect(page.getByText('子目录A')).toHaveCount(0);
      await page.getByRole('button', { name: '返回' }).first().click();
      await expect(page.getByText('子目录A')).toBeVisible();
      // 删除
      await page.getByText('改名后的书.txt').click({ button: 'right' });
      await page.getByRole('button', { name: '删除', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
      await expect(page.getByText('改名后的书.txt')).toHaveCount(0);
      expect(fs.existsSync(path.join(srv.lib, 'Books/改名后的书.txt'))).toBe(false);
      // ZIP 包内浏览，并打开包内的 EPUB
      await go(page, '#/files?path=Archives');
      await page.getByText('bundle.zip').click();
      await expect(page.getByText('inner', { exact: true })).toBeVisible();
      await expect(page.getByText('top.txt')).toBeVisible();
      await page.getByText('inner', { exact: true }).click();
      await expect(page.getByText('内含的书.epub')).toBeVisible();
      await shot(page, `deploy-${tag}-files-zip`);
      await page.getByText('内含的书.epub').click();
      await expect(page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 30_000 });
      await ctx.close();
    });

    test('网页传书 /transfer：上传到书库 Upload/，文件页立刻能看到', async ({ browser }) => {
      const { ctx, page } = await openApp(browser, shape, { hash: '#/files?path=Upload' });
      const tp = await ctx.newPage();
      await tp.goto(`${srv.url}/transfer${sp.token ? `?token=${encodeURIComponent(TOKEN)}` : ''}`);
      await expect(tp.getByText('把电子书拖到这里')).toBeVisible();
      const [chooser] = await Promise.all([tp.waitForEvent('filechooser'), tp.locator('#drop').click()]);
      await chooser.setFiles([{ name: '传书测试.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('传书测试') }]);
      await expect(tp.getByText('完成')).toBeVisible({ timeout: 15_000 });
      await expect(tp.locator('#files').getByText('传书测试.epub')).toBeVisible();
      expect(fs.existsSync(path.join(srv.lib, 'Upload/传书测试.epub'))).toBe(true);
      await shot(tp, `deploy-${tag}-transfer`);
      await page.bringToFront();
      await go(page, '#/files?path=Upload');
      await page.reload();
      await expect(page.getByText('传书测试.epub')).toBeVisible({ timeout: 15_000 });
      if (sp.token) {
        // 令牌页：没有令牌时先出现令牌输入框
        const tp2 = await ctx.newPage();
        await tp2.goto(`${srv.url}/transfer`);
        await tp2.evaluate(() => localStorage.removeItem('mr-token'));
        await tp2.reload();
        await expect(tp2.locator('#login')).toBeVisible();
        await tp2.locator('#tok').fill(TOKEN);
        await tp2.locator('#tokBtn').click();
        await expect(tp2.locator('#app')).toBeVisible();
        await expect(tp2.locator('#files').getByText('传书测试.epub')).toBeVisible();
      }
      await ctx.close();
    });

    // ───────────── WebDAV 同步（内置 /dav）：两个浏览器上下文模拟两台设备 ─────────────
    test('WebDAV 同步：设备 A 的进度与标注经内置 /dav 同步到设备 B；云端备份可在 B 恢复', async ({ browser }) => {
      const epub = { name: '同步测试书.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('同步测试书', '甲') };
      const enableSync = async (page: Page) => {
        await go(page, '#/settings/sync');
        await page.getByRole('button', { name: '验证并保存' }).click();
        await expect(page.getByText('登录成功')).toBeVisible({ timeout: 15_000 });
      };
      // 设备 A：导入 → 开同步 → 读几页 → 回书架 → 标注 → 立即同步
      const A = await openApp(browser, shape);
      await enableSync(A.page);
      await importViaDialog(A.page, [epub]);
      await A.page.keyboard.press('Escape');
      await go(A.page, '#/shelf');
      await A.page.getByText('同步测试书').first().click();
      await expect(A.page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 30_000 });
      await expect.poll(() => A.page.locator('iframe[title="section-0"]').boundingBox().then((b) => b?.height ?? 0)).toBeGreaterThan(300);
      const vp = A.page.viewportSize()!;
      for (let i = 0; i < 4; i++) {
        await A.page.mouse.click(vp.width * 0.92, vp.height * 0.55);
        await A.page.waitForTimeout(500);
      }
      await A.page.waitForTimeout(1200);
      const posA = (await idbAll(A.page, 'positions'))[0];
      expect(posA, 'A 读了几页后应有进度记录').toBeTruthy();
      expect(posA.locator.offset + posA.locator.section * 1e6).toBeGreaterThan(0);
      await go(A.page, '#/shelf');
      const bookId = posA.bookId as string;
      await idbPut(A.page, 'annotations', {
        id: 'acc-hl-1', bookId, kind: 'highlight', range: { section: 0, start: 10, end: 20 }, text: '同步的高亮', color: '#ffeb3b', style: 'highlight', createdAt: Date.now(), updatedAt: Date.now(),
      });
      await go(A.page, '#/settings/sync');
      await A.page.getByRole('button', { name: '立即同步全部进度' }).click();
      await expect(A.page.getByText(/已同步 \d+ 本书的进度/)).toBeVisible({ timeout: 15_000 });
      const davDir = path.join(srv.dataDir, 'dav/Apps/Books/.Moon+/Cache');
      expect(fs.existsSync(path.join(davDir, '同步测试书.epub.po'))).toBe(true);
      expect(fs.existsSync(path.join(davDir, '同步测试书.epub.an'))).toBe(true);
      expect(fs.readFileSync(path.join(davDir, '同步测试书.epub.po'), 'utf8')).toMatch(/\*\d+@?\d*#\d+/);
      await shot(A.page, `deploy-${tag}-sync-A`);

      // 设备 B：同一本书（内容相同 → 同一个 id）→ 开同步 → 打开 → 询问「云端有新进度」→ 同意
      const B = await openApp(browser, shape);
      await enableSync(B.page);
      await importViaDialog(B.page, [epub]);
      await B.page.keyboard.press('Escape');
      await go(B.page, '#/shelf');
      expect(await idbAll(B.page, 'positions')).toHaveLength(0);
      await B.page.getByText('同步测试书').first().click();
      await expect(B.page.getByText(/云端有本书新的阅读进度/)).toBeVisible({ timeout: 15_000 });
      await shot(B.page, `deploy-${tag}-sync-B-confirm`);
      await B.page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
      await expect(B.page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 30_000 });
      const posB = (await idbAll(B.page, 'positions')).find((p) => p.bookId === bookId);
      expect(posB, 'B 应拿到 A 的进度').toBeTruthy();
      expect(posB.locator).toEqual(posA.locator);
      expect(posB.deviceId).toBe(posA.deviceId);
      await expect.poll(async () => (await idbAll(B.page, 'annotations')).filter((a) => a.text === '同步的高亮').length, { timeout: 10_000 }).toBe(1);

      // 云端备份：A 备份到 WebDAV，B 从云端恢复
      await go(A.page, '#/settings/backup');
      await A.page.getByText('备份', { exact: true }).first().click();
      await A.page.getByRole('dialog').getByRole('radio', { name: /WebDAV 云端/ }).click();
      await A.page.getByRole('dialog').locator('input').first().fill('acc-cloud');
      await A.page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
      await expect(A.page.getByText(/已备份到云端/)).toBeVisible({ timeout: 20_000 });
      expect(fs.readdirSync(path.join(srv.dataDir, 'dav/Apps/Books/.Moon+/Backup')).some((f) => f.startsWith('acc-cloud'))).toBe(true);
      await go(B.page, '#/settings/backup');
      await B.page.getByText('恢复', { exact: true }).first().click();
      await B.page.getByRole('dialog').getByRole('radio', { name: /WebDAV 云端/ }).click();
      await B.page.getByText(/acc-cloud/).first().click();
      await expect(B.page.getByText(/备份时间/)).toBeVisible({ timeout: 15_000 });
      await B.page.getByRole('dialog').first().getByRole('button', { name: '确定' }).click();
      await B.page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click(); // 确认「恢复 …?」
      await expect(B.page.getByText(/恢复成功/)).toBeVisible({ timeout: 20_000 });
      expect(A.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
      expect(B.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
      await A.ctx.close();
      await B.ctx.close();
    });

    // ───────────── 备份与恢复（本地文件） ─────────────
    test('备份恢复：本地 .mrweb 备份（含书籍文件）在全新浏览器里恢复，书、进度、标注都在，书能打开', async ({ browser }) => {
      const epub = { name: '备份测试书.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('备份测试书', '乙') };
      const A = await openApp(browser, shape);
      await importViaDialog(A.page, [epub]);
      await A.page.keyboard.press('Escape');
      const bookId = (await idbAll(A.page, 'books'))[0].id as string;
      await idbPut(A.page, 'positions', { bookId, locator: { section: 1, offset: 123 }, progress: 0.55, updatedAt: Date.now(), deviceId: 'dev-A' });
      await idbPut(A.page, 'annotations', { id: 'bk-1', bookId, kind: 'bookmark', range: { section: 1, start: 5, end: 5 }, text: '书签文字', title: '我的书签', color: '#e53935', style: 'highlight', createdAt: 1, updatedAt: 1 });
      await go(A.page, '#/settings/backup');
      await A.page.getByText('备份', { exact: true }).first().click();
      await A.page.getByRole('dialog').getByText('包含书籍文件与字体').click();
      const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('dialog').getByRole('button', { name: '确定' }).click()]);
      expect(dl.suggestedFilename()).toMatch(/\.mrweb$/);
      const file = path.join(OUT, `run/${sp.port}/backup.mrweb`);
      await dl.saveAs(file);
      expect(fs.statSync(file).size).toBeGreaterThan(5000);
      // 备份里不能有令牌与口令
      const z = await JSZip.loadAsync(fs.readFileSync(file));
      const allText = (await Promise.all(Object.values(z.files).filter((f) => !f.dir && /\.(json|txt)$/.test(f.name)).map((f) => f.async('string')))).join('\n');
      expect(allText).not.toContain(TOKEN);
      await A.ctx.close();

      const C = await openApp(browser, shape);
      expect(await idbAll(C.page, 'books')).toHaveLength(0);
      await go(C.page, '#/settings/backup');
      await C.page.getByText('恢复', { exact: true }).first().click();
      const [chooser] = await Promise.all([C.page.waitForEvent('filechooser'), C.page.getByRole('button', { name: '选择本地备份文件' }).click()]);
      await chooser.setFiles(file);
      await expect(C.page.getByText(/书 1 本/)).toBeVisible({ timeout: 15_000 });
      await C.page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
      await C.page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
      await expect(C.page.getByText(/恢复成功/)).toBeVisible({ timeout: 20_000 });
      expect((await idbAll(C.page, 'books')).map((b) => b.title)).toEqual(['备份测试书']);
      expect((await idbAll(C.page, 'positions'))[0].locator).toEqual({ section: 1, offset: 123 });
      expect((await idbAll(C.page, 'annotations')).map((a) => a.title)).toEqual(['我的书签']);
      expect((await idbAll(C.page, 'files')).length).toBe(1);
      await go(C.page, '#/shelf');
      await C.page.getByText('备份测试书').first().click();
      await expect(C.page.locator('iframe[title="section-1"]')).toBeAttached({ timeout: 30_000 });
      expect(C.errors.filter((e) => !/favicon/.test(e))).toEqual([]);
      await C.ctx.close();
    });

    // ───────────── CHM / CBR / DJVU：经服务端转换后导入并打开 ─────────────
    test('CHM / CBR / DJVU：文件页导入 → 服务端转换 → 打开阅读页', async ({ browser }) => {
      test.skip(!fs.existsSync(path.join(srv.lib, 'Docs/putty.chm')) || !fs.existsSync(path.join(srv.lib, 'Docs/scan.djvu')), '缺 samples/chm 或 c44');
      const { ctx, page, errors } = await openApp(browser, shape, { hash: '#/files?path=Comics' });
      // CBR：点开 → 下载到浏览器 → 服务端 cbr→cbz → 阅读页出图
      await page.getByText('demo.cbr').click();
      await expect(page.locator('canvas, img[src^="blob:"]').first()).toBeVisible({ timeout: 40_000 });
      await shot(page, `deploy-${tag}-open-cbr`);
      await go(page, '#/files?path=Docs');
      // CHM → epub：阅读页有章节 iframe
      await page.getByText('putty.chm').click();
      await expect(page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 40_000 });
      await shot(page, `deploy-${tag}-open-chm`);
      await go(page, '#/files?path=Docs');
      // DJVU → pdf
      await page.getByText('scan.djvu').click();
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: 40_000 });
      await shot(page, `deploy-${tag}-open-djvu`);
      // 三本书都记入最近阅读、格式识别正确
      const books = await idbAll(page, 'books');
      expect(books.map((b) => b.format).sort()).toEqual(['cbr', 'chm', 'djvu']);
      expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
      await ctx.close();
    });
  });
}

test('占位：保证文件在没有 SHAPES 时也能被收集', () => {
  void appUrl;
  void chromium;
  void srvFetch;
  void JSZip;
  void makeCbz;
  void importViaDialog;
  void OUT;
});
