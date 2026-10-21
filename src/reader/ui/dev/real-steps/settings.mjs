// 设置对话框：⋮ → 可视/控制/其它选项，逐屏截图并核对设置真的作用到引擎
export default async function settings({ page, ids, open, shot, log }) {
  await open(ids.txt);
  await page.mouse.click(206, 457);
  await page.waitForTimeout(400);
  await page.mouse.click(206, 457);
  await page.waitForTimeout(500);
  await page.getByLabel('更多').click().catch(async () => page.mouse.click(390, 28));
  await page.waitForTimeout(400);
  await shot('s01-options-menu');
  await page.getByText('可视选项').first().click();
  await page.waitForTimeout(500);
  await shot('s02-visual-0');
  const scroller = page.locator('[class*="drawerBody"], [class*="Drawer"] [class*="body"]').first();
  log('scroller count', await scroller.count());
  for (let i = 1; i <= 7; i++) {
    await page.evaluate(() => {
      const els = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 40 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) && e.clientWidth > 200);
      els.forEach((e) => (e.scrollTop += 700));
    });
    await page.waitForTimeout(250);
    await shot(`s02-visual-${i}`);
  }
}
