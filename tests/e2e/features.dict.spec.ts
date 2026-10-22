// 词典/翻译：无服务端时退回新标签与网站；有服务端（假）时内联卡片；生词本；设置对话框。
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { f, indexOfText, openDev, pageErrors, select, shot } from './features.helpers';

test.afterEach(async ({ page }) => {
  expect(pageErrors(page)).toEqual([]);
});

/** 外站一律返回空页面，只看地址 */
async function stubExternal(context: BrowserContext) {
  await context.route(/^https:\/\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }));
}

async function fakeServer(page: Page) {
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, name: 'wangshu-reader-server', version: 't', features: { dict: true, translate: true, tts: true } } }));
  await page.route('**/api/dict/sources', (r) => r.fulfill({ json: { sources: [{ id: 'a', name: '源A', langs: ['en'] }, { id: 'b', name: '源B', langs: ['en'] }] } }));
  await page.route(/\/api\/dict\?/, (r) => {
    const u = new URL(r.request().url());
    r.fulfill({ json: { word: u.searchParams.get('word'), source: 'a', html: `<p data-x="1">释义：${u.searchParams.get('word')}</p><script>alert(1)</script>`, phonetic: '/fəʊ/' } });
  });
  await page.route('**/api/translate/providers', (r) => r.fulfill({ json: { providers: [{ id: 'p', name: '假翻译' }] } }));
  await page.route('**/api/translate', (r) => r.fulfill({ json: { text: '这是译文', provider: 'fake' } }));
}

test('无服务端：点「词典」弹卡片，提示改用网站，链接新标签打开', async ({ page, context }) => {
  await stubExternal(context);
  await openDev(page);
  const i = await indexOfText(page, 0, '地势坤');
  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-dict').click();
  const card = page.getByTestId('lookup-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('地势坤');
  await expect(card).toContainText('未连接服务端，无法使用内置词典');
  await shot(page, 'dict-card-noserver');
  const popupP = context.waitForEvent('page');
  await card.getByRole('button', { name: '有道词典' }).click();
  const popup = await popupP;
  await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
  expect(popup.url()).toContain('dict.youdao.com');
  expect(decodeURIComponent(popup.url())).toContain('地势坤');
});

test('无服务端：翻译直接开翻译网站（带源/目标语言）', async ({ page, context }) => {
  await stubExternal(context);
  await openDev(page);
  const popupP = context.waitForEvent('page');
  await f(page, "f.session.bus.emit('translate.open', { text: 'hello world' })");
  const popup = await popupP;
  await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
  const u = new URL(popup.url());
  expect(u.host).toBe('translate.google.com');
  expect(u.searchParams.get('text')).toBe('hello world');
  expect(u.searchParams.get('sl')).toBe('auto');
});

test('有服务端：内联词典卡片（释义经清洗，脚本去掉）、切到翻译出译文', async ({ page }) => {
  await fakeServer(page);
  await openDev(page, 'server=1');
  const i = await indexOfText(page, 1, 'Ishmael').catch(() => -1);
  void i;
  const j = await indexOfText(page, 0, '地势坤');
  await select(page, 0, j, j + 3);
  await page.getByTestId('sel-dict').click();
  const card = page.getByTestId('lookup-card');
  await expect(card).toContainText('释义：地势坤');
  await expect(card).toContainText('/fəʊ/');
  expect(await card.locator('script').count()).toBe(0);
  await expect(card.locator('select')).toBeVisible(); // 多个来源时可切换
  await shot(page, 'dict-card-server');
  // 切到翻译
  await card.getByRole('button', { name: '翻译' }).click();
  await expect(page.getByTestId('translate-result')).toHaveText('这是译文');
});

test('有服务端：dict.lookup 命令；点遮罩/Esc 关卡片', async ({ page }) => {
  await fakeServer(page);
  await openDev(page, 'server=1');
  await f(page, "f.session.bus.emit('dict.lookup', { text: 'serendipity' })");
  const card = page.getByTestId('lookup-card');
  await expect(card).toContainText('释义：serendipity');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});

test('生词本：查过的词记下来；在「设置...」里把「生词本」加进选择条后能打开', async ({ page }) => {
  await openDev(page);
  const i = await indexOfText(page, 0, '地势坤');
  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-dict').click();
  await expect(page.getByTestId('lookup-card')).toBeVisible();
  await page.keyboard.press('Escape');

  // 选择条定制：打开「设置...」，勾上「生词本」
  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-more').click();
  await page.getByRole('menuitem', { name: '设置...' }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: '自定义词典设置' });
  await expect(dlg).toBeVisible();
  await shot(page, 'dict-settings');
  // 选择条 11 项：拷贝 高亮 标注 词典 朗读 分享 搜索 翻译 维基 网络搜索 生词本（最后一项）
  await dlg.locator('input[type=checkbox]').nth(10).check();
  await dlg.getByRole('button', { name: '确定' }).click();

  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-more').click();
  await page.getByRole('menuitem', { name: '生词本' }).click();
  const hist = page.getByRole('dialog').filter({ hasText: '生词本' });
  await expect(hist).toContainText('地势坤');
});

test('词典设置：词典1 选自定义要求 %s 模板；选择条里前 4 项不能取消勾选', async ({ page }) => {
  await openDev(page);
  const i = await indexOfText(page, 0, '地势坤');
  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-more').click();
  await page.getByRole('menuitem', { name: '设置...' }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: '自定义词典设置' });
  const switches = dlg.locator('input[type=checkbox]');
  for (let k = 0; k < 4; k++) await expect(switches.nth(k)).toBeDisabled();
  await dlg.locator('select').first().selectOption('custom');
  await dlg.getByRole('textbox').fill('https://x.test/no-placeholder');
  await expect(dlg).toContainText('请输入以 http');
});
