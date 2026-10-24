// Android app 的系统栏：在 Chromium 里假装是 Android 壳（注入 __WANGSHU_HOST__、截获发给原生的消息），检查
// 书架页状态栏取色；阅读页铺满全屏、顶部按状态栏高度留一条；菜单栏收起时隐藏状态栏和导航栏、呼出时显示状态栏且与菜单栏同色。
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

const FAKE_HOST = `(() => {
  window.__WANGSHU_HOST__ = { platform: 'android', mode: 'remote', statusBarHeight: 30 };
  window.__hostMsgs = [];
  window.WangshuAndroid = { postMessage: (m) => window.__hostMsgs.push(JSON.parse(m)) };
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
