// 阅读引擎端到端：可重排书的加载、整行翻页、锚点保持。需先起 vite dev（见 src/reader/engine/dev/README 注释）：
//   npx vite --host 127.0.0.1 --port 4173 --strictPort   然后  npx playwright test（baseURL 默认就是 4173）
import { expect, test, type Page } from '@playwright/test';

const URL = '/src/reader/engine/dev/harness.html';

async function open(page: Page, query = '') {
  await page.goto(`${URL}?${query}`);
  await page.waitForFunction(() => (window as any).__h?.ready || (window as any).__h?.error, null, { timeout: 15000 });
  const err = await page.evaluate(() => (window as any).__h.error);
  expect(err).toBe('');
}
const h = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(async()=>{const h=window.__h;return (${fn})})()`) as Promise<T>;

test('加载第一章并发出 relocate / sectionReady', async ({ page }) => {
  await open(page);
  const loc = await h<any>(page, 'h.reader.getLocation()');
  expect(loc.section).toBe(0);
  expect(loc.progress).toBe(0);
  expect(loc.atStart).toBe(true);
  expect(loc.pages).toBeGreaterThan(3);
  const ev = await h<string[]>(page, 'h.events.map(e=>e.type)');
  expect(ev).toContain('relocate');
  expect(ev).toContain('sectionReady');
  await page.screenshot({ path: 'test-results/engine-basic-open.png' });
});

test('分页模式：整行翻页不切行，往返回到原位', async ({ page }) => {
  await open(page, 'flip=1&speed=0');
  const s0 = await h<any>(page, 'h.state()');
  expect(s0.mode).toBe('paged');
  expect(await h<number>(page, 'h.cutLines()')).toBe(0);
  const ys: number[] = [s0.pos.y];
  for (let i = 0; i < 4; i++) {
    await h(page, 'h.reader.next()');
    if ((await h<number>(page, 'h.cutLines()')) !== 0) console.log(JSON.stringify(await h(page, 'h.cutDetail()')));
    expect(await h<number>(page, 'h.cutLines()')).toBe(0);
    ys.push((await h<any>(page, 'h.state()')).pos.y);
  }
  for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  await page.screenshot({ path: 'test-results/engine-basic-page5.png' });
  for (let i = 3; i >= 0; i--) {
    await h(page, 'h.reader.prev()');
    expect(Math.abs((await h<any>(page, 'h.state()')).pos.y - ys[i])).toBeLessThan(1);
  }
});
