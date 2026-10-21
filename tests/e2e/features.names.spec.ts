// 名字替换设置界面：规则写进引擎的 nameSettings（reader.names），引擎订阅后应用。
import { expect, test } from '@playwright/test';
import { f, openDev, pageErrors, shot } from './features.helpers';

test.afterEach(async ({ page }) => {
  expect(pageErrors(page)).toEqual([]);
});

test('名字替换：添加规则、切正则/作用域、坏正则提示、导入导出、清空', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDev(page);
  await f(page, 'f.openNames()');
  const dlg = page.getByRole('dialog').filter({ hasText: '名字替换' });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('还没有规则');

  await dlg.getByRole('button', { name: '添加规则' }).click();
  await dlg.getByTestId('names-from').fill('苔痕');
  await dlg.getByTestId('names-to').fill('青苔');
  const rules = () => f<any[]>(page, "JSON.parse(localStorage.getItem('mr.settings.v1') || '{}')['reader.names']?.rules ?? []");
  await expect.poll(rules).toEqual([{ from: '苔痕', to: '青苔' }]);

  // 作用域 → 仅本书（按书名，引擎按这个字段过滤）
  await dlg.getByTestId('names-scope').click();
  await expect.poll(rules).toEqual([{ from: '苔痕', to: '青苔', book: '开发样书' }]);

  // 正则 + 坏正则
  await dlg.getByRole('switch', { name: '正则' }).check();
  await dlg.getByTestId('names-from').fill('(');
  await expect(dlg).toContainText('正则表达式有误');
  await shot(page, 'names');
  await dlg.getByTestId('names-from').fill('苔+痕');
  await expect(dlg).not.toContainText('正则表达式有误');
  await expect(dlg).toContainText('对本书生效 1 条');

  // 导出（复制逐行格式）与导入
  await dlg.getByRole('button', { name: '导出（复制）' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('苔+痕#->#青苔');
  await dlg.getByRole('button', { name: '导入（每行 原文#->#替换）' }).click();
  await page.getByTestId('names-import-text').fill('甲#->#乙\n没有分隔符的行\n丙#->#');
  await page.getByRole('dialog').filter({ hasText: '粘贴规则' }).getByRole('button', { name: '确定' }).click();
  await expect(dlg.getByTestId('names-rule')).toHaveCount(3);

  // 清空只清本书和全局，不动别的书的规则
  await f(page, "f.nameSettings.set({ rules: [...f.nameSettings.get().rules, { from: 'x', to: 'y', book: '别的书' }] })");
  await dlg.getByRole('button', { name: '清空' }).click();
  await page.getByRole('dialog').filter({ hasText: '清空全部名字替换规则' }).getByRole('button', { name: '确定' }).click();
  await expect.poll(rules).toEqual([{ from: 'x', to: 'y', book: '别的书' }]);
});
