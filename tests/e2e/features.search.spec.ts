// 书内搜索：对话框、结果摘要、跳转 + 全文高亮、导航面板、历史、选项、选中文字搜索。
import { expect, test, type Page } from '@playwright/test';
import { decoList, f, indexOfText, openDev, pageErrors, select, shot } from './features.helpers';

test.afterEach(async ({ page }) => {
  expect(pageErrors(page)).toEqual([]);
});

const dialog = (page: Page) => page.getByTestId('search-dialog');
const searchFor = async (page: Page, key: string) => {
  await f(page, "f.session.bus.emit('search.open', {})");
  await expect(dialog(page)).toBeVisible();
  await page.getByTestId('search-input').fill(key);
  await page.getByTestId('search-input').press('Enter');
};
const decoIds = async (page: Page, layer: string) => (await decoList(page, layer)).map((d) => d.id);

test('搜索：结果数、摘要里命中词加粗、带进度百分比', async ({ page }) => {
  await openDev(page, 'long=0');
  await searchFor(page, '苔痕上阶绿');
  await expect(page.getByTestId('search-count')).toContainText('搜索结果: 4');
  const first = page.getByTestId('search-result').first();
  await expect(first.locator('b')).toHaveText('苔痕上阶绿');
  await expect(first).toContainText(/\(\d+\.\d%\)/);
  await shot(page, 'search-results');
});

test('点结果：关对话框、跳转、全文高亮、导航面板翻上一个/下一个，返回回到搜索前的位置', async ({ page }) => {
  await openDev(page, 'long=0');
  const before = await f<any>(page, 'f.controller.getLocation().locator');
  await searchFor(page, '苔痕上阶绿');
  await expect(page.getByTestId('search-result')).toHaveCount(4);
  await page.getByTestId('search-result').nth(1).click();
  await expect(dialog(page)).toBeHidden();
  const nav = page.getByTestId('search-nav');
  await expect(nav).toBeVisible();
  await expect(page.getByTestId('nav-count')).toHaveText('2/4');
  expect((await decoIds(page, 'search')).length).toBe(4);
  await shot(page, 'search-nav');

  await page.getByTestId('nav-next').click();
  await expect(page.getByTestId('nav-count')).toHaveText('3/4');
  await page.getByTestId('nav-prev').click();
  await page.getByTestId('nav-prev').click();
  await expect(page.getByTestId('nav-count')).toHaveText('1/4');
  // 回到列表
  await page.getByTestId('nav-list').click();
  await expect(dialog(page)).toBeVisible();
  await page.getByTestId('search-dialog').getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('nav-back').click();
  await expect.poll(() => f<number>(page, 'f.controller.getLocation().locator.offset')).toBe(before.offset);

  await page.getByTestId('nav-close').click();
  await expect(nav).toBeHidden();
  await expect.poll(async () => (await decoIds(page, 'search')).length).toBe(0);
});

test('跨章结果：点第二章的结果会换章', async ({ page }) => {
  await openDev(page, 'long=0');
  await searchFor(page, 'fox');
  await expect(page.getByTestId('search-result')).toHaveCount(3);
  await page.getByTestId('search-result').first().click();
  await expect.poll(() => f<number>(page, 'f.controller.getLocation().section')).toBe(1);
});

test('选项：区分大小写、正则语法错误给提示、历史记录', async ({ page }) => {
  await openDev(page, 'long=0');
  await searchFor(page, 'FOX');
  await expect(page.getByTestId('search-count')).toContainText('搜索结果: 3');
  // 区分大小写 → 没结果
  await page.getByRole('button', { name: '搜索选项' }).click();
  await page.getByRole('dialog').getByText('区分大小写').click();
  await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
  await page.getByTestId('search-input').press('Enter');
  await expect(page.getByText('没有找到“FOX”')).toBeVisible();
  // 坏正则
  await page.getByTestId('search-input').fill('(');
  await page.getByTestId('search-input').press('Enter');
  await expect(page.getByText(/正则表达式有误/)).toBeVisible();
  // 历史
  await page.getByRole('button', { name: '历史记录' }).click();
  const hist = page.getByRole('dialog').filter({ hasText: '历史记录' });
  await expect(hist.getByText('FOX')).toBeVisible();
  await hist.getByText('FOX').click();
  await expect(page.getByTestId('search-input')).toHaveValue('FOX');
});

test('只搜已读（向后）：只搜当前位置之前，后面的章不搜', async ({ page }) => {
  await openDev(page, 'long=0');
  await f(page, 'f.controller.goTo({ section: 1, offset: 0 })');
  await f(page, "f.session.bus.emit('search.open', {})");
  await page.getByRole('button', { name: '搜索选项' }).click();
  await page.getByRole('dialog').getByText('只搜索已读的(向后搜索)').click();
  await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
  await page.getByTestId('search-input').fill('苔痕上阶绿');
  await page.getByTestId('search-input').press('Enter');
  // 第一章的 4 处都在当前位置之前；再搜第二章里的词应该没有结果
  await expect(page.getByTestId('search-count')).toContainText('搜索结果: 4');
  await page.getByTestId('search-input').fill('fox');
  await page.getByTestId('search-input').press('Enter');
  await expect(page.getByText('没有找到“fox”')).toBeVisible();
});

test('选中文字 →「更多」→ 搜索：直接带着关键词开搜', async ({ page }) => {
  await openDev(page, 'long=0');
  const i = await indexOfText(page, 0, '天行健');
  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-more').click();
  await page.getByRole('menuitem', { name: '搜索', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByTestId('search-input')).toHaveValue('天行健');
  await expect(page.getByTestId('search-count')).toContainText('搜索结果: 2');
});
