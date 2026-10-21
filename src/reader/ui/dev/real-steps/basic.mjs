// 基础：打开 TXT、关掉首次点击区示意、点击区翻页（左/右/中）、菜单栏、进度条、位置保存与恢复
const loc = (page) => page.evaluate(() => document.querySelector('[class*="status"]')?.innerText ?? '');
export default async function basic({ page, ids, open, shot, log }) {
  await open(ids.txt);
  await page.mouse.click(206, 457); // 关掉点击区示意
  await page.waitForTimeout(400);
  const pageText = () => page.evaluate(() => (document.querySelector('[class*="status"]')?.textContent ?? '').replace(/\s+/g, ' '));
  log('status0', await pageText());
  // 右侧点击 = 下一页
  await page.mouse.click(380, 457);
  await page.waitForTimeout(600);
  log('after right tap', await pageText());
  await page.mouse.click(30, 457);
  await page.waitForTimeout(600);
  log('after left tap', await pageText());
  // 中间：菜单
  await page.mouse.click(206, 457);
  await page.waitForTimeout(500);
  await shot('b01-menu');
  // 菜单显示时点正文：只收起
  await page.mouse.click(380, 300);
  await page.waitForTimeout(500);
  log('menu hidden by tap?', await page.locator('[data-show="true"]').count());
  // 键盘翻页
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(300);
  }
  log('after 3 PageDown', await pageText());
  await shot('b02-after-keys');
  // 位置保存 → 重开恢复
  await page.waitForTimeout(1200);
  const before = await pageText();
  await page.reload();
  await page.waitForTimeout(1800);
  log('before reload', before);
  log('after reload', await pageText());
  await shot('b03-restored');
  void loc;
}
