// originGuard / MR_TOKEN 在真实浏览器里的行为：
//  - 没设 MR_TOKEN：别的站点（evil.test）的页面读不了书库；服务端自己托管、用域名访问（myhost.test）没问题；file:// 的 null 来源没问题
//  - 设了 MR_TOKEN：任意来源都能用（CORS 全开 + 令牌），没带令牌时界面给出明确提示而不是崩溃
// 用 --host-resolver-rules 把 evil.test / myhost.test 解析到本机，这样 Origin 的主机名不是回环/IP 字面量，才会走到 originGuard 的跨站分支。
// 端口：5415 无令牌服务端、5416「别的站点」（只托管前端）、5417 有令牌服务端。
import { chromium, expect, test, type Browser } from '@playwright/test';
import { BUILD_SINGLE, OUT, ensureBuilt, go, shot, startServer, type Srv } from './accept.library.helpers';

test.describe.configure({ mode: 'serial' });

const TOKEN = 'cross-origin-token';
let open: Srv; // 没设令牌
let other: Srv; // 另一个站点（托管前端，没有书库）
let locked: Srv; // 设了令牌
let browser: Browser;

test.beforeAll(async () => {
  ensureBuilt();
  open = await startServer({ port: 5415, serve: 'std' });
  other = await startServer({ port: 5416, serve: 'single', noLibrary: true });
  locked = await startServer({ port: 5417, token: TOKEN, serve: 'std' });
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? '/usr/bin/chromium',
    args: ['--host-resolver-rules=MAP evil.test 127.0.0.1, MAP myhost.test 127.0.0.1', '--no-sandbox'],
  });
});
test.afterAll(async () => {
  await browser?.close();
  await Promise.all([open?.stop(), other?.stop(), locked?.stop()]);
});

async function page(seed: Record<string, unknown>, url: string) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'zh-CN' });
  await ctx.addInitScript((s) => {
    if (!localStorage.getItem('mr.settings.v1')) localStorage.setItem('mr.settings.v1', s);
  }, JSON.stringify({ app: { language: 'zh', ...seed }, 'reader.ui': { showedReaderClickTip: true } }));
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForSelector('#root > *');
  return { ctx, p, errors };
}

test('没设 MR_TOKEN：服务端自己托管、用域名访问（Origin 主机 = Host）可以用', async () => {
  const { ctx, p, errors } = await page({}, `http://myhost.test:${open.port}/#/files`);
  await expect(p.getByText('Books', { exact: true })).toBeVisible({ timeout: 15_000 });
  await shot(p, 'origin-hosted-by-domain');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('没设 MR_TOKEN：别的站点（evil.test）的页面读不了书库，界面给出提示而不崩溃', async () => {
  const { ctx, p, errors } = await page({ serverUrl: open.url }, `http://evil.test:${other.port}/#/files`);
  await expect(p.getByText(/跨站|MR_TOKEN|403/).first()).toBeVisible({ timeout: 15_000 });
  await shot(p, 'origin-blocked-files');
  // 直接 fetch 也读不到内容
  const r = await p.evaluate(async (u) => {
    const res = await fetch(`${u}/api/library/list?path=`);
    return { status: res.status, body: await res.text() };
  }, open.url);
  expect(r.status).toBe(403);
  expect(r.body).not.toContain('Books');
  // 代理也不能被借用
  const px = await p.evaluate(async (u) => (await fetch(`${u}/api/proxy?url=${encodeURIComponent('http://127.0.0.1:1/')}`)).status, open.url);
  expect(px).toBe(403);
  // 网络书库页同样降级提示
  await go(p, '#/net/gutenberg');
  await expect(p.getByText(/没有找到相关列表|跨站|MR_TOKEN/).first()).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('没设 MR_TOKEN：file:// 单文件版（Origin: null）可以用', async () => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'zh-CN' });
  await ctx.addInitScript((s) => localStorage.setItem('mr.settings.v1', s), JSON.stringify({ app: { language: 'zh', serverUrl: open.url } }));
  const p = await ctx.newPage();
  await p.goto(`file://${BUILD_SINGLE}/index.html#/files`);
  await expect(p.getByText('Books', { exact: true })).toBeVisible({ timeout: 15_000 });
  // 请求头里的 Origin 是 "null"（页面的 location.origin 在 Chromium 里是 "file://"）
  expect(await p.evaluate(() => location.protocol)).toBe('file:');
  await ctx.close();
});

test('设了 MR_TOKEN：别的站点带令牌可以用；没带令牌时给出明确提示，填上令牌后恢复', async () => {
  // 没带令牌
  const a = await page({ serverUrl: locked.url }, `http://evil.test:${other.port}/#/files`);
  await expect(a.p.getByText(/unauthorized|令牌|401/i).first()).toBeVisible({ timeout: 15_000 });
  await shot(a.p, 'token-missing-files');
  expect(a.errors).toEqual([]);
  // 在设置页填上令牌
  await go(a.p, '#/settings/server');
  await a.p.locator('input[type=password]').first().fill(TOKEN);
  await a.p.getByRole('button', { name: '检测连接' }).click();
  await expect(a.p.getByText('服务端连接正常')).toBeVisible({ timeout: 10_000 });
  await go(a.p, '#/files');
  await expect(a.p.getByText('Books', { exact: true })).toBeVisible({ timeout: 15_000 });
  await a.ctx.close();
  // 一开始就带令牌
  const b = await page({ serverUrl: locked.url, serverToken: TOKEN }, `http://evil.test:${other.port}/#/files`);
  await expect(b.p.getByText('Books', { exact: true })).toBeVisible({ timeout: 15_000 });
  await shot(b.p, 'token-cross-origin-ok');
  expect(b.errors).toEqual([]);
  await b.ctx.close();
});

test('设了 MR_TOKEN：令牌填错时「检测连接」要提示令牌不对（不能只因为 /api/health 免鉴权就报连接正常）', async () => {
  const { ctx, p } = await page({ serverUrl: locked.url, serverToken: 'wrong-token' }, `http://evil.test:${other.port}/#/settings/server`);
  await p.getByRole('button', { name: '检测连接' }).click();
  await expect(p.getByText('访问令牌不正确')).toBeVisible({ timeout: 10_000 });
  await expect(p.getByText('服务端连接正常')).toHaveCount(0);
  await shot(p, 'token-wrong-check');
  await ctx.close();
  void OUT;
});
