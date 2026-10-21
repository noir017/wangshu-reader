// 翻页动画端到端：定格到中间帧截图核对 + 动画走完后位置正确。
import { expect, test, type Page } from '@playwright/test';

const URL = '/src/reader/engine/dev/harness.html';
async function open(page: Page, query = '') {
  await page.goto(`${URL}?${query}`);
  await page.waitForFunction(() => (window as any).__h?.ready || (window as any).__h?.error, null, { timeout: 15000 });
  expect(await page.evaluate(() => (window as any).__h.error)).toBe('');
}
const h = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(async()=>{const h=window.__h;return (${fn})})()`) as Promise<T>;

for (const anim of [3, 4, 5, 6, 7]) {
  test(`动画 ${anim}：中间帧 + 走完提交`, async ({ page }) => {
    await open(page, `flip=${anim}&speed=50`);
    const y0 = (await h<any>(page, 'h.state()')).pos.y;
    expect(await h(page, `h.freeze(1, ${anim}, 0.5)`)).toBe(true);
    await page.screenshot({ path: `test-results/anim${anim}-mid-next.png` });
    await h(page, 'h.unfreeze()');
    expect((await h<any>(page, 'h.state()')).pos.y).toBe(y0);
    await h(page, 'h.reader.next()');
    const s = await h<any>(page, 'h.state()');
    expect(s.pos.y).toBeGreaterThan(y0);
    expect(await h<number>(page, 'h.cutLines()')).toBe(0);
    // 往回翻
    expect(await h(page, `h.freeze(-1, ${anim}, 0.5)`)).toBe(true);
    await page.screenshot({ path: `test-results/anim${anim}-mid-prev.png` });
    await h(page, 'h.unfreeze()');
    await h(page, 'h.reader.prev()');
    expect(Math.abs((await h<any>(page, 'h.state()')).pos.y - y0)).toBeLessThan(1);
  });
}

for (const anim of [1, 2]) {
  for (const p of [0.25, 0.55, 0.85]) {
    test(`仿真翻页 ${anim}：p=${p} 截图`, async ({ page }) => {
      await open(page, `flip=${anim}&speed=50&img=4`);
      expect(await h(page, `h.freeze(1, ${anim}, ${p})`)).toBe(true);
      console.log('renderer', await h(page, 'h.freezeKind()'));
      await page.screenshot({ path: `test-results/curl${anim}-next-${Math.round(p * 100)}.png` });
      await h(page, 'h.unfreeze()');
      await h(page, 'h.reader.next()');
      expect(await h(page, 'h.freeze(-1, ' + anim + ', ' + p + ')')).toBe(true);
      await page.screenshot({ path: `test-results/curl${anim}-prev-${Math.round(p * 100)}.png` });
      await h(page, 'h.unfreeze()');
    });
  }
}
