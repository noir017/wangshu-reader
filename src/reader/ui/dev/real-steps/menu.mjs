export default async function menu({ page, ids, open, shot, log }) {
  await open(ids.txt);
  await page.mouse.click(206, 457); // 关点击区示意
  await page.waitForTimeout(400);
  await page.mouse.click(380, 457);
  await page.waitForTimeout(600);
  await page.mouse.click(30, 457);
  await page.waitForTimeout(600);
  await shot('m1-before-center');
  await page.mouse.click(206, 457);
  for (const ms of [100, 500]) {
    await page.waitForTimeout(ms);
    await shot(`m2-center-${ms}`);
  }
  log('menu state', await page.locator('[data-show="true"]').count());
}
