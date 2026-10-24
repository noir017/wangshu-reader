// 路由的两级页面：抽屉里的顶级页互相切换不进历史，返回键从顶级页回首页、从次级页一层层退。
// 托管版和 file:// 单文件版各跑一遍（单文件版的 pushState 走 file:// 地址）。
import { expect, test, type Page } from '@playwright/test';
import { go, openApp, startServer, type Shape, type Srv } from './accept.library.helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

let srv: Srv;
test.beforeAll(async () => {
  srv = await startServer({ serve: 'std' });
});
test.afterAll(async () => {
  await srv?.stop();
});

const hashOf = (page: Page) => page.evaluate(() => location.hash || '#/');
// 书架是空的时第一次进书架会弹导入对话框，这里标成已弹过
const extra = { 'library.shelf': { firstShelfShown: true } };

/** 窄屏先点「菜单」拉出抽屉；宽屏抽屉是常驻侧栏 */
async function drawerGo(page: Page, label: string): Promise<void> {
  const menu = page.getByRole('button', { name: '菜单' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(200);
}

async function backTo(page: Page, hash: string): Promise<void> {
  await page.goBack();
  await expect.poll(() => hashOf(page)).toBe(hash);
}

for (const kind of ['hosted', 'single'] as const) {
  test(`顶级页来回切换不进历史，返回键先回首页（${kind}）`, async ({ browser }) => {
    const shape: Shape = { kind, token: false, srv };
    const { ctx, page, errors } = await openApp(browser, shape, { extra });
    for (let i = 0; i < 3; i++) {
      await drawerGo(page, '我的书架');
      await expect.poll(() => hashOf(page)).toBe('#/shelf');
      await drawerGo(page, '最近阅读');
      await expect.poll(() => hashOf(page)).toBe('#/');
    }
    await drawerGo(page, '我的书架');
    await drawerGo(page, '阅读统计');
    await drawerGo(page, '设置选项');
    expect(await hashOf(page)).toBe('#/settings');
    await backTo(page, '#/');
    expect(await page.evaluate(() => history.state?.mrDepth)).toBe(0);

    // 次级页照常压栈：书签 → 某本书的书签 → 返回回到书签 → 再返回回到首页
    await drawerGo(page, '书签');
    await go(page, '#/notes/no-such-book');
    await backTo(page, '#/notes');
    await backTo(page, '#/');
    expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
    await ctx.close();
  });
}

test('从次级页经侧栏去别的顶级页：次级页不留在历史里', async ({ browser }) => {
  const { ctx, page, errors } = await openApp(browser, { kind: 'hosted', token: false, srv }, { extra, viewport: { width: 1280, height: 800 } });
  await drawerGo(page, '书签');
  await go(page, '#/notes/no-such-book');
  await drawerGo(page, '阅读统计');
  await expect.poll(() => hashOf(page)).toBe('#/stats');
  await backTo(page, '#/');
  expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
  await ctx.close();
});

test('直接打开某一页：返回键回到首页', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, { kind: 'hosted', token: false, srv }, { extra, hash: '#/stats' });
  expect(await hashOf(page)).toBe('#/stats');
  await backTo(page, '#/');
  await ctx.close();
});
