// EPUB：章节切换、进度条、百分比跳转、↩ 回退、阅读时长入库
const LB = '回退';
const status = (page) => page.evaluate(() => (document.querySelector('[class*="status"]')?.textContent ?? '').replace(/\s+/g, ' '));
export default async function epub({ page, ids, open, shot, log }) {
  await open(ids.epub);
  await page.mouse.click(206, 457);
  await page.waitForTimeout(500);
  log('epub status0', await status(page));
  await page.mouse.click(206, 457); // 菜单
  await page.waitForTimeout(500);
  await shot('e01-menu');
  const next = page.getByLabel('下一章节');
  await next.click();
  await page.waitForTimeout(800);
  log('after next chapter', await status(page));
  await next.click();
  await page.waitForTimeout(800);
  log('after next chapter 2', await status(page));
  const back = page.locator('button[aria-label="'+LB+'"]').first();
  log('back enabled', await back.isEnabled().catch(() => 'n/a'));
  await page.getByLabel('上一章节').click();
  await page.waitForTimeout(800);
  log('after prior chapter', await status(page));
  // 百分比跳转
  await page.locator('[class*="pct"]').first().click();
  await page.waitForTimeout(400);
  await shot('e02-go-percent');
  await page.locator('[role="dialog"] input').fill('50');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  log('after 50%', await status(page));
  // ↩ 回到跳转前
  await back.click();
  await page.waitForTimeout(800);
  log('after back', await status(page));
  // 进度条拖到 90%
  const seek = page.locator('input[type=range]').first();
  await seek.fill('900');
  await page.waitForTimeout(1200);
  log('after seek 900', await status(page));
  await shot('e03-seek');

  // 阅读时长：离开阅读页触发 flush
  await page.waitForTimeout(1500);
  await page.evaluate(() => (location.hash = '#/'));
  await page.waitForTimeout(800);
  const stat = await page.evaluate(async (id) => {
    const { getStats, getPosition, getBook } = await import('/src/storage/db.ts');
    return { stat: await getStats(id), pos: await getPosition(id), prog: (await getBook(id))?.progress };
  }, ids.epub);
  log('stats', JSON.stringify({ usedMs: stat.stat?.usedMs, words: stat.stat?.words, pos: stat.pos?.locator, progress: stat.pos?.progress, bookProg: stat.prog }));
}
