// 集成缺口 A5：features 导出的设置入口在阅读页的菜单里都能点到（原版菜单里有入口的都要能到）。
// ⋮ → 其它选项：TTS朗读设置 / 名字替换 / 自定义词典设置；朗读按钮长按：朗读菜单；朗读面板：声音、更多选项；选字工具条：词典历史。
import { expect, test, type Page } from '@playwright/test';
import { APP_URL, FAKE_SPEECH, collectErrors, importFile, menuVisible, openFromShelf, openOptionsMenuItem, selectWord, skipClickTip, tapCenter } from './accept.reader.helpers';

async function closeTopDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

test('阅读页里 features 的设置入口都能打开', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await skipClickTip(page);
  await page.addInitScript(FAKE_SPEECH);
  await importFile(page, 'pg11-alice.txt');
  await openFromShelf(page);

  // ⋮ → 其它选项 里的三个入口
  await openOptionsMenuItem(page, '其它选项');
  for (const [row, expectText] of [
    ['TTS朗读设置', /朗读/],
    ['名字替换', /名字替换/],
    ['自定义词典设置', /词典/],
  ] as const) {
    await page.getByText(row, { exact: true }).click();
    const dlg = page.getByRole('dialog').last();
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(expectText);
    await closeTopDialog(page);
  }
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);

  // 底栏「朗读」长按：朗读菜单（openSpeakMenu）
  if (!(await menuVisible(page))) await tapCenter(page);
  const tts = page.getByRole('button', { name: '朗读', exact: true });
  const b = (await tts.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await expect(page.getByRole('menuitem', { name: /开始朗读 \(\d+ 分钟\)/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '朗读剪贴板文本' })).toBeVisible();
  await page.getByRole('menuitem', { name: '开始朗读', exact: true }).click();
  await expect(page.getByTestId('tts-panel')).toBeVisible();
  // 朗读面板：声音与更多选项
  await page.getByTestId('tts-settings').click();
  await expect(page.getByRole('dialog').last()).toBeVisible();
  await closeTopDialog(page);
  await page.getByTestId('tts-more').click();
  await expect(page.getByRole('dialog').last()).toContainText(/朗读/);
  await closeTopDialog(page);
  await page.getByTestId('tts-stop').click();
  await expect(page.getByTestId('tts-panel')).toBeHidden();
  expect(errors, JSON.stringify(errors)).toEqual([]);
});

test('多本书的压缩包（FMT-020）：打开时列出包里的书让用户选，选中的那本正常打开', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await skipClickTip(page);
  await importFile(page, 'zip-two-books.zip');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (location.hash = '#/shelf'));
  await page.locator('[data-id]').first().click();
  const dlg = page.getByRole('dialog').filter({ hasText: '压缩包里有多本书' });
  await expect(dlg).toBeVisible({ timeout: 20000 });
  await expect(dlg.getByText('a.epub')).toBeVisible();
  await dlg.getByText('b.txt').click();
  await expect.poll(() => page.locator('iframe[title^="section-"]').count(), { timeout: 20000 }).toBeGreaterThan(0);
  expect(errors, JSON.stringify(errors)).toEqual([]);
});

test('开书动画（ANIM-012）：开关打开 + 仿真翻页 + 竖屏时，封面从中缝分开后消失', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await skipClickTip(page);
  await page.addInitScript(() => {
    const k = 'mr.settings.v1';
    const cur = JSON.parse(localStorage.getItem(k) || '{}');
    cur['reader.screen'] = { ...cur['reader.screen'], openBookAnim: true };
    cur['reader.flip'] = { ...cur['reader.flip'], flipAnimation: 1 };
    localStorage.setItem(k, JSON.stringify(cur));
  });
  await importFile(page, 'pg11-alice.epub');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (location.hash = '#/shelf'));
  await page.locator('[data-id]').first().click();
  await expect(page.getByTestId('open-book-anim')).toBeAttached({ timeout: 10000 });
  await expect(page.getByTestId('open-book-anim')).toHaveCount(0, { timeout: 10000 });
  await expect.poll(() => page.locator('iframe[title^="section-"]').count()).toBeGreaterThan(0);
  expect(errors, JSON.stringify(errors)).toEqual([]);
});

test('类型不受支持的文件（LIB-035）：导入时问「是否以纯文本模式打开」，选纯文本就入库并打开', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await skipClickTip(page);
  await page.goto(APP_URL);
  await page.getByText('导入书籍').first().click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('选择文件').click()]);
  await chooser.setFiles({ name: '笔记.dat', mimeType: 'application/octet-stream', buffer: Buffer.concat([Buffer.from([1, 2]), Buffer.from('这是一份用纯文本模式打开的笔记。'.repeat(50))]) }); // 文件头有控制字符：不像文本，不会自动按 TXT
  const ask = page.getByRole('dialog').filter({ hasText: '是否以纯文本模式打开' });
  await expect(ask).toBeVisible({ timeout: 20000 });
  await ask.getByRole('button', { name: '纯文本格式' }).click();
  await expect.poll(() => page.url(), { timeout: 15000 }).toContain('/read/');
  await expect.poll(() => page.locator('iframe[title^="section-"]').count(), { timeout: 20000 }).toBeGreaterThan(0);
  expect(errors, JSON.stringify(errors)).toEqual([]);
});
