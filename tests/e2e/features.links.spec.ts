// 脚注气泡、外链确认、内部链接跳转 + 返回栈、看图器。
import { expect, test } from '@playwright/test';
import { f, inSection, openDev, pageErrors, shot } from './features.helpers';

test.afterEach(async ({ page }) => {
  expect(pageErrors(page)).toEqual([]);
});

const inFrame = (page: import('@playwright/test').Page, sel: string, section = 0) => inSection(page, section, sel);

test('点脚注标记：弹气泡显示脚注内容，Esc/点空白关闭', async ({ page }) => {
  await openDev(page);
  await inFrame(page, '#r1').click();
  const pop = page.getByTestId('footnote-popup');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('陋室铭，唐代刘禹锡所作');
  await shot(page, 'footnote');
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  // 再点，点遮罩关闭
  await inFrame(page, '#r1').click();
  await expect(pop).toBeVisible();
  await page.mouse.click(5, 880);
  await expect(pop).toBeHidden();
});

test('外部链接：先弹确认框，取消不打开，确认才新开标签', async ({ page, context }) => {
  await openDev(page);
  await inFrame(page, 'a[href^="https://example.com"]').click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('https://example.com/page');
  await dlg.getByRole('button', { name: '取消' }).click();
  await expect(dlg).toBeHidden();

  await inFrame(page, 'a[href^="https://example.com"]').click();
  const popupP = context.waitForEvent('page');
  await page.getByRole('dialog').getByRole('button', { name: '打开' }).click();
  const popup = await popupP;
  expect(popup.url()).toContain('example.com');
  await popup.close();
});

test('内部链接：跳到目标章并压入返回栈，linkback.back 回到原处', async ({ page }) => {
  await openDev(page);
  const before = await f<any>(page, 'f.controller.getLocation().locator');
  await inFrame(page, 'a[href="ch2.xhtml"]').click();
  await expect.poll(() => f<number>(page, 'f.controller.getLocation().section')).toBe(1);
  await expect.poll(() => f<number>(page, 'f.linkback.getState().stack.length')).toBe(1);
  expect(await f<any>(page, 'f.linkback.getState().stack[0].locator')).toEqual(before);
  await f(page, "f.session.bus.emit('linkback.back', {})");
  await expect.poll(() => f<number>(page, 'f.controller.getLocation().section')).toBe(0);
  await expect.poll(() => f<number>(page, 'f.linkback.getState().stack.length')).toBe(0);
});

test('看图器：点图打开，左右切图，双击放大，Esc 关闭', async ({ page }) => {
  await openDev(page);
  await f(page, 'f.controller.goTo({ section: 1, offset: 0 })');
  // 原版：长按图片才全屏看图（单击图片是普通点击）
  await inFrame(page, '#img1', 1).click({ delay: 900 });
  const viewer = page.getByTestId('image-viewer');
  await expect(viewer).toBeVisible();
  await expect(page.getByTestId('viewer-title')).toContainText('1/2');
  const img = page.getByTestId('viewer-img');
  await expect(img).toBeVisible();
  await shot(page, 'viewer');
  // 点右侧区域 → 下一张
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('viewer-title')).toContainText('2/2');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('viewer-title')).toContainText('1/2');
  // 双击：1 → 1.75
  const before = (await img.boundingBox())!;
  await img.dblclick();
  await expect.poll(async () => ((await img.boundingBox())!.width / before.width)).toBeGreaterThan(1.5);
  // 选项对话框盖在看图器上
  await page.getByRole('button', { name: '菜单选项' }).click();
  await expect(page.getByRole('dialog').filter({ hasText: '播放间隔' })).toBeVisible();
  await page.getByRole('dialog').filter({ hasText: '播放间隔' }).getByRole('button', { name: '确定' }).click();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
});

test('目录「图片」页：缩略图点击定位到图所在章', async ({ page }) => {
  await openDev(page);
  await f(page, "f.session.bus.emit('toc.open', {})");
  await page.getByTestId('tab-images').click();
  await expect(page.getByTestId('image-thumb')).toHaveCount(2);
  await page.getByTestId('image-thumb').first().click();
  await expect.poll(() => f<number>(page, 'f.controller.getLocation().section')).toBe(1);
});
