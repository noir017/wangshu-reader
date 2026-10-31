// Android app 的系统栏：在 Chromium 里假装是 Android 壳（注入 __WANGSHU_HOST__、截获发给原生的消息），检查
// 书架页状态栏取色；阅读页铺满全屏、顶部按状态栏高度留一条；菜单栏收起时隐藏状态栏和导航栏、呼出时显示状态栏且与菜单栏同色。
// 「打开方式」选了望舒：原生发来文件地址，导入后直接进阅读页。
import { expect, test, type Page } from '@playwright/test';
import { appUrl, importViaDialog, makeEpub, seedSettings, startServer, type Shape, type Srv } from './accept.library.helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

let srv: Srv;
test.beforeAll(async () => {
  srv = await startServer({ serve: 'std' });
});
test.afterAll(async () => {
  await srv?.stop();
});

// addEventListener 收原生发给页面的消息：存下监听函数，测试里直接调它
const FAKE_HOST = `(() => {
  window.__WANGSHU_HOST__ = { platform: 'android', mode: 'remote', statusBarHeight: 30 };
  window.__hostMsgs = [];
  window.WangshuAndroid = {
    postMessage: (m) => window.__hostMsgs.push(JSON.parse(m)),
    addEventListener: (type, fn) => { window.__hostListener = fn; },
  };
})();`;

type HostMsg = { type: string; [k: string]: unknown };

/** 最后一条某类型的消息 */
const lastMsg = (page: Page, type: string) =>
  page.evaluate((t) => [...((window as any).__hostMsgs as HostMsg[])].reverse().find((m) => m.type === t) ?? null, type);

/** 元素背景色转 #rrggbb */
const bgHex = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const m = getComputedStyle(document.querySelector(sel)!).backgroundColor.match(/\d+(\.\d+)?/g)!;
    return '#' + m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('');
  }, selector);

test('Android 壳：状态栏取色与阅读页全屏', async ({ browser }) => {
  const shape: Shape = { kind: 'hosted', token: false, srv };
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'zh-CN' });
  const seed = JSON.stringify(seedSettings(shape, { 'library.shelf': { firstShelfShown: true } }));
  await ctx.addInitScript((s) => {
    if (!localStorage.getItem('mr.settings.v1')) localStorage.setItem('mr.settings.v1', s);
  }, seed);
  await ctx.addInitScript(FAKE_HOST);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(appUrl(shape, '#/'));

  // 书架页：状态栏是蓝色标题栏的颜色，配白色图标
  await expect.poll(() => lastMsg(page, 'statusBar')).toEqual({ type: 'statusBar', color: '#1e88e5', light: false });

  await importViaDialog(page, [{ name: 'bars.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('系统栏样书', '测试', { paragraphs: 40 }) }]);
  await page.locator('[role=dialog] [class*=groupRow]').first().click();
  await expect(page.locator('iframe[title^="section-"]').first()).toBeAttached({ timeout: 20_000 });

  // 阅读页：铺满全屏，菜单栏收起时状态栏、导航栏都隐藏；顶部给状态栏留 30px，铺阅读背景
  await expect.poll(() => lastMsg(page, 'reader')).toEqual({ type: 'reader', on: true, hideStatus: true, hideNav: true });
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-night]')!).paddingTop)).toBe('30px');
  const pageBg = await bgHex(page, '[data-night]');
  await expect.poll(async () => (await lastMsg(page, 'statusBar'))?.color).toBe(pageBg);

  // 点屏幕中间呼出菜单栏：显示状态栏，取色是菜单栏的颜色；菜单栏延伸到状态栏底下
  await page.mouse.click(206, 457);
  const TOP = '[data-show="true"]:not([class*=bottom])';
  await expect(page.locator(TOP)).toBeVisible();
  await expect.poll(() => lastMsg(page, 'reader')).toEqual({ type: 'reader', on: true, hideStatus: false, hideNav: true });
  const barBg = await bgHex(page, TOP);
  await expect.poll(async () => (await lastMsg(page, 'statusBar'))?.color).toBe(barBg);
  expect(await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)!).paddingTop, TOP)).toBe('30px');

  // 返回书架：退出阅读页布局
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect.poll(() => lastMsg(page, 'reader')).toEqual({ type: 'reader', on: false, hideStatus: false, hideNav: false });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('Android 壳：夜间纹理主题下状态栏那条、页脚和正文是同一块背景', async ({ browser }) => {
  const shape: Shape = { kind: 'hosted', token: false, srv };
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'zh-CN' });
  // 内置「Night Theme」：夜间磨砂纹理（自带均色 #3A3A3A）+ 主题底色纯黑，以前正文是黑底、状态栏那条和页脚是灰底
  const night = { useBackgroundImage: true, backgroundImage: 'tex:night161', backgroundColor: '#000000', fontColor: '#CCCCCC' };
  const seed = seedSettings(shape, { 'library.shelf': { firstShelfShown: true }, 'reader.text': night, 'reader.theme': { lastTheme: 'Night Theme', nightMode: true } });
  await ctx.addInitScript((s) => localStorage.setItem('mr.settings.v1', s), JSON.stringify(seed));
  await ctx.addInitScript(FAKE_HOST);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(appUrl(shape, '#/'));
  await importViaDialog(page, [{ name: 'night.epub', mimeType: 'application/epub+zip', buffer: await makeEpub('夜间背景样书', '测试', { paragraphs: 40 }) }]);
  await page.locator('[role=dialog] [class*=groupRow]').first().click();
  await expect(page.locator('iframe[title^="section-"]').first()).toBeAttached({ timeout: 20_000 });

  // 整屏背景画在阅读页根节点上，和引擎算出来的一模一样；引擎根节点透明，不另画一层
  const bgs = () =>
    page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-night]')!;
      const eng = document.querySelector<HTMLElement>('.mr-reader')!;
      const ec = getComputedStyle(eng);
      return { root: root.style.background, engine: eng.style.background, enginePaints: `${ec.backgroundColor} ${ec.backgroundImage}` };
    });
  await expect.poll(async () => (await bgs()).engine).toContain('svg');
  const b = await bgs();
  expect(b.root).toBe(b.engine);
  expect(b.enginePaints).toBe('rgba(0, 0, 0, 0) none');
  expect(await bgHex(page, '[data-night]')).toBe('#000000');
  // 顶部那条就是根节点的留白：状态栏取色是纯黑、配浅色图标
  await expect.poll(() => lastMsg(page, 'statusBar')).toEqual({ type: 'statusBar', color: '#000000', light: false });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('Android 壳：「打开方式」选了望舒，导入后直接打开', async ({ browser }) => {
  const shape: Shape = { kind: 'hosted', token: false, srv };
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'zh-CN' });
  await ctx.addInitScript((s) => localStorage.setItem('mr.settings.v1', s), JSON.stringify(seedSettings(shape, { 'library.shelf': { firstShelfShown: true } })));
  await ctx.addInitScript(FAKE_HOST);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 原生把收到的文件挂在页面同源的 /__opened/<编号> 上，文件名在 X-File-Name
  const epub = await makeEpub('打开方式样书', '测试');
  await page.route('**/__opened/1', (route) =>
    route.fulfill({ contentType: 'application/epub+zip', headers: { 'X-File-Name': encodeURIComponent('打开方式样书.epub') }, body: epub }),
  );
  await page.goto(appUrl(shape, '#/'));

  // 页面起来后才告诉原生可以投递
  await expect.poll(() => lastMsg(page, 'ready')).toEqual({ type: 'ready' });
  await page.evaluate(() => (window as any).__hostListener({ data: JSON.stringify({ type: 'openFiles', urls: [`${location.origin}/__opened/1`] }) }));
  await expect(page.getByText(/已导入 1 本/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('iframe[title^="section-"]').first()).toBeAttached({ timeout: 20_000 });
  // 直接进阅读页，没有新书列表盖在上面
  await expect(page.getByText(/新导入的 \d+ 本书/)).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});
