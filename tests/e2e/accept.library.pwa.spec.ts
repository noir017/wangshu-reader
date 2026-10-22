// PWA（MISC-008）：manifest（图标、file_handlers、share_target）、service worker（离线打开、分享目标）、
// launchQueue 打开文件、?open= 链接下载；file:// 单文件版不注册 SW、不报错。
import { expect, test } from '@playwright/test';
import { importViaDialog, makeEpub, openApp, shot, startServer, appUrl, type Shape, type Srv } from './accept.library.helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);
test.use({ actionTimeout: 15_000 });

let srv: Srv;
let shape: Shape;

test.beforeAll(async () => {
  srv = await startServer({ serve: 'std' });
  shape = { kind: 'hosted', token: false, srv };
});
test.afterAll(async () => {
  await srv?.stop();
});

const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

test('manifest：必填字段、图标尺寸、file_handlers、share_target，Chromium 解析无错误', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, shape);
  const m = (await (await fetch(`${srv.url}/manifest.webmanifest`)).json()) as any;
  expect(m).toMatchObject({ name: '望舒 Wangshu Reader', short_name: '望舒', display: 'standalone', start_url: './', scope: './' });
  const icons = m.icons as { src: string; sizes: string; type: string; purpose?: string }[];
  for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']] as const) {
    const ic = icons.find((i) => i.sizes === size && i.purpose === purpose);
    expect(ic, `${size} ${purpose}`).toBeTruthy();
    const buf = Buffer.from(await (await fetch(`${srv.url}/${ic!.src}`)).arrayBuffer());
    expect(pngSize(buf)).toEqual({ w: Number(size.split('x')[0]), h: Number(size.split('x')[0]) });
  }
  const exts = Object.values(m.file_handlers[0].accept).flat() as string[];
  expect(exts).toEqual(expect.arrayContaining(['.epub', '.pdf', '.txt', '.mobi', '.fb2', '.cbz', '.cbr', '.chm', '.djvu', '.docx', '.md']));
  expect(m.share_target).toMatchObject({ action: './share-target', method: 'POST', enctype: 'multipart/form-data' });
  expect(m.share_target.params.files[0].name).toBe('files');
  // Chromium 自己对清单的解析结果（有错误会列在 errors 里）与可安装性
  const cdp = await ctx.newCDPSession(page);
  const { errors, url } = await cdp.send('Page.getAppManifest');
  expect(url).toContain('/manifest.webmanifest');
  expect(errors.filter((e) => e.critical)).toEqual([]);
  // Playwright 的上下文是无痕模式，Chromium 会报「in-incognito」；除此以外不能有任何不可安装的原因
  await expect
    .poll(async () => (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.map((e: { errorId: string }) => e.errorId).filter((id: string) => id !== 'in-incognito'), { timeout: 15_000 })
    .toEqual([]);
  await ctx.close();
});

test('service worker：注册、接管页面、断网后仍能打开应用并读到本机的书', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, shape);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated');
  // 页面发给 SW 的资源清单被缓存（首次访问时页面还没被接管）
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('mr-v2-shell')).keys()).map((r) => new URL(r.url).pathname)), { timeout: 15_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/\/assets\/index-.*\.js$/)]));
  // 导入一本书，再断网刷新
  const epub = { name: '离线书.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('离线书', '离线作者') };
  await page.goto(appUrl(shape, '#/shelf'));
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await importViaDialog(page, [epub]);
  await page.keyboard.press('Escape');
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#root > *', { timeout: 15_000 });
  await page.evaluate(() => (location.hash = '#/shelf'));
  await expect(page.getByText('离线书', { exact: true })).toBeVisible({ timeout: 10_000 });
  await shot(page, 'pwa-offline-shelf');
  await page.getByText('离线书', { exact: true }).click();
  await expect(page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 20_000 });
  // /api 不被 SW 拦截：离线时请求直接失败，而不是返回缓存的网页
  const apiFailed = await page.evaluate(async () => fetch('/api/health').then(() => false, () => true));
  expect(apiFailed).toBe(true);
  await ctx.setOffline(false);
  await ctx.close();
});

test('分享目标：把文件 POST 到 /share-target → 导入并打开；分享链接 → 走下载', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, shape);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // 让页面被 SW 接管
  const epub = await makeEpub('分享来的书', '分享者');
  // 浏览器发起的 multipart POST（和系统分享面板选了本应用后发出的请求一样）
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], '分享来的书.epub', { type: 'application/epub+zip' }));
    const form = document.createElement('form');
    form.method = 'post';
    form.enctype = 'multipart/form-data';
    form.action = './share-target';
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.name = 'files';
    inp.files = dt.files;
    form.append(inp);
    document.body.append(form);
    form.submit();
  }, epub.toString('base64'));
  await expect(page.getByText(/已导入 1 本/).first()).toBeVisible({ timeout: 20_000 });
  expect(page.url()).not.toContain('shared='); // 导入后清掉地址里的标记
  await shot(page, 'pwa-share-target');
  // 单文件分享后直接进阅读页
  await expect(page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 20_000 });
  await ctx.close();

  // 分享的是链接：SW 重定向到 ?open=<链接>，应用把它交给下载队列（链接指向服务端书库里的一本书，走 /api/proxy）
  const c2 = await openApp(browser, shape);
  await c2.page.evaluate(() => navigator.serviceWorker.ready);
  await c2.page.reload();
  const link = `${srv.url}/api/library/file?path=${encodeURIComponent('Books/验收样书.epub')}`;
  await c2.page.evaluate((l) => {
    const form = document.createElement('form');
    form.method = 'post';
    form.enctype = 'multipart/form-data';
    form.action = './share-target';
    for (const [k, v] of [['title', '一本书'], ['text', `看看这个 ${l} 不错`], ['url', '']]) {
      const i = document.createElement('input');
      i.name = k;
      i.value = v;
      form.append(i);
    }
    document.body.append(form);
    form.submit();
  }, link);
  await expect(c2.page.getByText(/下载完成/).first()).toBeVisible({ timeout: 30_000 });
  await go2(c2.page);
  await c2.ctx.close();
});

async function go2(page: import('@playwright/test').Page) {
  await page.evaluate(() => (location.hash = '#/shelf'));
  await expect(page.getByText('验收样书').first()).toBeVisible({ timeout: 10_000 });
}

test('launchQueue（file_handlers 打开文件）：安装后的 PWA 用本应用打开 .epub', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'zh-CN' });
  // 假的 launchQueue：应用启动时注册 consumer，测试里再喂文件进去
  await ctx.addInitScript(() => {
    // Chromium 里 window.launchQueue 是只读属性，要用 defineProperty 才能替换
    Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer: (fn: unknown) => ((window as any).__lq = fn) } });
    localStorage.setItem('mr.settings.v1', JSON.stringify({ app: { language: 'zh' }, 'reader.ui': { showedReaderClickTip: true } }));
  });
  const page = await ctx.newPage();
  await page.goto(`${srv.url}/#/shelf`);
  await page.waitForFunction(() => !!(window as any).__lq);
  const epub = await makeEpub('文件关联打开', '甲');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await (window as any).__lq({ files: [{ getFile: async () => new File([bytes], '文件关联打开.epub') }] });
  }, epub.toString('base64'));
  await expect(page.getByText(/已导入 1 本/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 20_000 });
  await ctx.close();
});

test('file:// 单文件版：不注册 service worker，控制台没有 manifest/SW 相关错误', async ({ browser }) => {
  const single: Shape = { kind: 'single', token: false, srv };
  const { ctx, page, errors } = await openApp(browser, single);
  await page.waitForTimeout(1500);
  // file:// 的来源是 null，浏览器连查询注册都会抛 SecurityError：抛了也说明没有注册
  expect(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.().catch(() => []))?.length ?? 0)).toBe(0);
  expect(errors).toEqual([]);
  await ctx.close();
});
