// 固定版式（PDF）界面：用假引擎（?mrdev=1）验证 PDF 选项、缩略图条、滚动锁定、夜间
export default async function fixed({ page, base, shot, log }) {
  await page.goto(`${base}/src/reader/ui/dev/dev.html?mrdev=1#/read/mock-fixed`);
  await page.reload();
  await page.waitForTimeout(1500);
  await page.mouse.click(206, 457); // 点击区示意
  await page.waitForTimeout(400);
  await shot('f01-fixed');
  await page.evaluate(async () => {
    const m = await import('/src/reader/settings.ts');
    m.fixedSettings.set({ pdfShowThumb: true });
  });
  await page.waitForTimeout(800);
  if (await page.locator('[data-show="true"]').count()) {
    await page.mouse.click(206, 457);
    await page.waitForTimeout(500);
  }
  await shot('f02-thumbs');
  await page.evaluate(async () => {
    const { openSettings } = await import('/src/reader/ui/settings/open.tsx');
    openSettings('visual');
  });
  await page.waitForTimeout(500);
  await shot('f03-pdf-options');
  log('pdf options title', await page.locator('[class*="drawerTitle"]').first().innerText());
}
