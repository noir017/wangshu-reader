// 界面语言：英文浏览器（locale en-US）首次打开、或老用户（存过设置但没手动选过语言）都是简体中文；
// 只有在设置里手动选了 English 才是英文，选回中文立刻恢复。
import { expect, test, type Page } from '@playwright/test';
import { APP_URL } from './accept.reader.helpers';

test.use({ locale: 'en-US' });

const langSelect = (page: Page) => page.locator('select').filter({ has: page.locator('option[value="en"]') });

test('英文浏览器默认简体中文，手动选英文后才是英文', async ({ page }) => {
  await page.goto(APP_URL);
  expect(await page.evaluate(() => navigator.language)).toBe('en-US');
  await expect(page.locator('body')).toContainText('最近阅读', { timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('Recent');

  // 设置选项 → 界面语言 选 English
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByText('界面语言', { exact: true })).toBeVisible();
  await expect(langSelect(page)).toHaveValue('zh');
  await langSelect(page).selectOption('en');
  await expect(page.getByText('Language', { exact: true })).toBeVisible();
  // 手动选过的会持久化：刷新后仍是英文（设置写盘有 200ms 去抖）
  await page.waitForTimeout(400);
  await page.reload();
  await expect(langSelect(page)).toHaveValue('en');
  await expect(page.getByText('Language', { exact: true })).toBeVisible();
  await langSelect(page).selectOption('zh');
  await expect(page.getByText('界面语言', { exact: true })).toBeVisible();
});

test('老用户：存过别的设置、没选过语言 → 中文', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('__seeded')) {
      localStorage.setItem('mr.settings.v1', JSON.stringify({ 'library.shelf': { sortBy: 2 }, 'reader.ui': { showedReaderClickTip: true } }));
      sessionStorage.setItem('__seeded', '1');
    }
  });
  await page.goto(APP_URL);
  await expect(page.locator('body')).toContainText('最近阅读', { timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('Recent');
});
