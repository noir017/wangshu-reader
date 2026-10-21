// 桌面宽屏（1280×800）：阅读页、菜单栏、设置抽屉
export default async function wide({ page, ids, open, shot, log }) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(ids.epub);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(500);
  await shot('w01-reading');
  await page.mouse.click(640, 400);
  await page.waitForTimeout(500);
  await shot('w02-menu');
  await page.evaluate(async () => {
    const { openSettings } = await import('/src/reader/ui/settings/open.tsx');
    openSettings('visual');
  });
  await page.waitForTimeout(600);
  await shot('w03-visual');
  await page.setViewportSize({ width: 412, height: 915 });
}
