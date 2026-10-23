// 固定版式引擎端到端（PDF/漫画）：视图模式、适配、缩放平移、双页、翻页动画、夜间、文字选择与装饰。
import { expect, test, type Page } from '@playwright/test';

const URL = '/src/reader/engine/dev/harness.html';
async function open(page: Page, query = '') {
  await page.goto(`${URL}?fixed=1&${query}`);
  await page.waitForFunction(() => (window as any).__h?.ready || (window as any).__h?.error, null, { timeout: 15000 });
  expect(await page.evaluate(() => (window as any).__h.error)).toBe('');
}
const h = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(async()=>{const h=window.__h;return (${fn})})()`) as Promise<T>;
const st = (page: Page) => h<any>(page, 'h.fstate()');

test('单页：加载、整页适配、翻页、边界', async ({ page }) => {
  await open(page, 'view=1');
  const s = await st(page);
  expect(s.mode).toBe('single');
  expect(s.page).toBe(0);
  expect(s.gw).toBeCloseTo(412, 0); // 600x800 放进 412x915：整页适配 = 按宽度缩放
  await page.screenshot({ path: 'test-results/fixed-single-0.png' });
  await h(page, 'h.reader.next()');
  expect((await st(page)).page).toBe(1);
  const loc = await h<any>(page, 'h.reader.getLocation()');
  expect(loc).toMatchObject({ section: 1, pages: 12, page: 2, atStart: false, atEnd: false });
  expect(loc.progress).toBeCloseTo(1 / 11, 3);
  expect(loc.sectionTitle).toBe('第一部分');
  await h(page, 'h.reader.prev()');
  expect((await st(page)).page).toBe(0);
  expect((await h<any>(page, 'h.reader.getLocation()')).atStart).toBe(true);
  await h(page, 'h.reader.goTo({progress:1})');
  expect((await st(page)).page).toBe(11);
  expect((await h<any>(page, 'h.reader.getLocation()')).atEnd).toBe(true);
  await h(page, '(h.events.length = 0, h.reader.next())');
  expect(await h<string[]>(page, 'h.events.map(e=>e.type)')).toContain('endOfBook');
  await h(page, 'h.reader.goTo({section:5})');
  expect((await h<any>(page, 'h.reader.getLocation()')).sectionTitle).toBe('第二部分');
});

test('适合宽度：长页先在页内滚动，到底再翻页；适合高度', async ({ page }) => {
  await open(page, 'view=1&fit=width&tall=0&fpages=4');
  let s = await st(page);
  expect(s.gw).toBeCloseTo(412, 0);
  expect(s.gh).toBeGreaterThan(915 * 1.5);
  expect(s.ty).toBe(0);
  await h(page, 'h.reader.next()');
  s = await st(page);
  expect(s.page).toBe(0);
  expect(s.ty).toBeLessThan(-500);
  await h(page, 'h.reader.next()'); // 已滚到页底：再翻才换页
  expect((await st(page)).page).toBe(1);
  // 往回翻回到长页：落在页底
  await h(page, 'h.reader.prev()');
  s = await st(page);
  expect(s.page).toBe(0);
  expect(s.ty).toBeCloseTo(915 - s.gh, 0);
  // 适合高度：页比屏窄，左右留边
  await open(page, 'view=1&fit=height');
  s = await st(page);
  expect(s.gh).toBeCloseTo(915, 0);
  expect(s.gw).toBeGreaterThan(412); // 适合高度：比屏宽，需要左右平移
});

test('连续滚动：挂载可见页、滚动换页、goTo', async ({ page }) => {
  await open(page, 'view=2&fpages=30');
  let s = await st(page);
  expect(s.mode).toBe('continuous');
  expect(s.views.length).toBeGreaterThan(0);
  expect(s.views.length).toBeLessThan(10);
  await page.mouse.move(200, 400);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  s = await st(page);
  expect(s.sy).toBeGreaterThan(2000);
  expect(s.page).toBeGreaterThan(2);
  expect(s.views).not.toContain(0);
  await page.screenshot({ path: 'test-results/fixed-continuous.png' });
  await h(page, 'h.reader.goTo({section:20})');
  s = await st(page);
  expect(s.views).toContain(20);
  expect((await h<any>(page, 'h.reader.getLocation()')).locator.section).toBe(20);
  await h(page, 'h.reader.goTo({progress:0})');
  expect((await st(page)).sy).toBe(0);
  // 滚到底：atEnd
  await h(page, 'h.reader.goTo({progress:1})');
  await h(page, 'h.reader.next()');
  expect((await h<any>(page, 'h.reader.getLocation()')).atEnd).toBe(true);
});

test('自动视图：竖屏逐页、横屏连续、长条漫画连续', async ({ page }) => {
  await open(page, 'view=0');
  expect((await st(page)).mode).toBe('single');
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto(`${URL}?fixed=1&view=0`);
  await page.waitForFunction(() => (window as any).__h?.ready);
  expect((await st(page)).mode).toBe('continuous');
  await open(page, 'view=0&comic=1&tall=0,1,2');
  expect((await st(page)).mode).toBe('continuous');
});

test('缩放：双击缩放循环、放大后补高清', async ({ page }) => {
  await open(page, 'view=1');
  const z = async () => (await st(page)).z;
  // 每次双击后轮询到位，再隔开超过双击窗口（260ms），免得相邻两次双击互相干扰
  const dbl = async (expected: number) => {
    await page.mouse.dblclick(380, 450);
    await expect.poll(z).toBeCloseTo(expected, 2);
    await page.waitForTimeout(300);
  };
  await dbl(1.75);
  await dbl(3);
  await dbl(1);
  // 放大后高清重绘：位图密度提高
  await page.mouse.dblclick(380, 450);
  await page.waitForTimeout(700);
  expect(await h<number>(page, 'Math.max(...[...h.reader.views.values()].map(v=>v.renderedD))')).toBeGreaterThan(1.7);
});

test('平移：放大后拖动被夹在页面范围内，拖过边缘翻页', async ({ page, context }) => {
  await open(page, 'view=1');
  await h(page, 'h.reader.zoomTo(2, 206, 450)');
  let s = await st(page);
  expect(s.z).toBeCloseTo(2, 2);
  // 用触屏拖：鼠标按在文字上拖是选择，不是平移
  const cdp = await context.newCDPSession(page);
  const touch = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as never);
  const drag = async (dx: number, dy: number) => {
    await touch('touchStart', 380, 300);
    for (let i = 1; i <= 8; i++) await touch('touchMove', 380 + (dx * i) / 8, 300 + (dy * i) / 8);
    await touch('touchEnd');
    await page.waitForTimeout(150);
  };
  // 往右下拖到头：被夹住，不露空白（页 0 没有上一页，所以也不会翻）
  await drag(300, 300);
  s = await st(page);
  expect(s.page).toBe(0);
  expect(s.tx).toBeCloseTo(0, 0);
  expect(s.ty).toBeCloseTo(0, 0);
  // 往左上拖：先被夹在右下边界内
  await drag(-60, -60);
  s = await st(page);
  expect(s.page).toBe(0);
  expect(s.tx).toBeLessThan(0);
  expect(s.tx + s.gw * s.z).toBeGreaterThanOrEqual(412 - 0.5);
  expect(s.ty + s.gh * s.z).toBeGreaterThanOrEqual(915 - 0.5);
  // 一路拖过右边缘很多：翻到下一页，缩放复位
  await drag(-300, -20);
  await drag(-300, -20);
  await page.waitForFunction(() => (window as any).__h.fstate().page === 1, null, { timeout: 5000 });
  s = await st(page);
  expect(s.page).toBe(1);
  expect(s.z).toBe(1);
});

test('双指缩放（触屏）', async ({ page, context }) => {
  await open(page, 'view=1');
  const cdp = await context.newCDPSession(page);
  const touch = (type: string, pts: Array<{ x: number; y: number; id: number }>) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })) } as never);
  await touch('touchStart', [{ x: 150, y: 450, id: 1 }, { x: 260, y: 450, id: 2 }]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: 150 - i * 12, y: 450, id: 1 }, { x: 260 + i * 12, y: 450, id: 2 }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const s = await st(page);
  expect(s.z).toBeGreaterThan(1.8);
  await page.screenshot({ path: 'test-results/fixed-pinch.png' });
});

test('双页：封面单页，之后并排；漫画右到左反序', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await open(page, 'view=1&dual=on&fpages=9&comic=1');
  let s = await st(page);
  expect(s.dual).toBe(true);
  expect(s.views).toEqual([0]); // 封面单页
  await h(page, 'h.reader.next()');
  s = await st(page);
  expect(s.page).toBe(1);
  expect(s.views.sort()).toEqual([1, 2]);
  await page.screenshot({ path: 'test-results/fixed-dual-ltr.png' });
  const xs = await h<number[]>(page, '[1,2].map(i=>h.reader.views.get(i).x)');
  expect(xs[0]).toBeLessThan(xs[1]);
  await h(page, 'h.reader.next()');
  expect((await st(page)).views.sort()).toEqual([3, 4]);
  await h(page, 'h.reader.prev()');
  expect((await st(page)).page).toBe(1);
  // 右到左：靠前的页在右边
  await open(page, 'view=1&dual=on&fpages=9&comic=1&rtl=1');
  await h(page, 'h.reader.next()');
  const xr = await h<number[]>(page, '[1,2].map(i=>h.reader.views.get(i).x)');
  expect(xr[0]).toBeGreaterThan(xr[1]);
  await page.screenshot({ path: 'test-results/fixed-dual-rtl.png' });
});

test('夜间反色与页边色', async ({ page }) => {
  await open(page, 'view=1&night=1');
  expect(await h<string>(page, '[...h.reader.views.values()][0].canvas.style.filter')).toContain('invert');
  expect(await h<string>(page, 'h.reader.root.style.background')).not.toContain('192, 192, 192');
  await page.screenshot({ path: 'test-results/fixed-night.png' });
  await h(page, "h.settings.fixedSettings.set({ pdfTheme: 0 })");
  await page.waitForTimeout(200);
  expect(await h<string>(page, '[...h.reader.views.values()][0].canvas.style.filter')).toBe('');
  await open(page, 'view=1&comic=1');
  expect(await h<string>(page, 'h.reader.root.style.background')).toContain('255, 255, 255');
});

for (const anim of [1, 2, 3, 4, 5, 6, 7]) {
  test(`翻页动画 ${anim}：定格中间帧、走完翻到下一页`, async ({ page }) => {
    await open(page, `view=1&flip=${anim}&speed=50`);
    expect(await h(page, `h.freeze(1, ${anim}, 0.5)`)).toBe(true);
    await page.screenshot({ path: `test-results/fixed-anim${anim}-mid.png` });
    await h(page, 'h.unfreeze()');
    expect((await st(page)).page).toBe(0);
    await h(page, 'h.reader.next()');
    expect((await st(page)).page).toBe(1);
    await h(page, 'h.reader.prev()');
    expect((await st(page)).page).toBe(0);
  });
}

test('触屏横划：手指跟随翻页（水平切换）与回弹', async ({ page, context }) => {
  await open(page, 'view=1&flip=3&speed=50');
  const cdp = await context.newCDPSession(page);
  const touch = (type: string, x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as never);
  // 拖一小段松手：回弹
  await touch('touchStart', 300, 450);
  for (let i = 1; i <= 5; i++) await touch('touchMove', 300 - i * 10, 450);
  await page.waitForTimeout(400);
  await touch('touchEnd', 250, 450);
  await page.waitForTimeout(700);
  expect((await st(page)).page).toBe(0);
  // 拖过半屏：翻页
  await touch('touchStart', 380, 450);
  for (let i = 1; i <= 10; i++) await touch('touchMove', 380 - i * 30, 450);
  await touch('touchEnd', 80, 450);
  await page.waitForTimeout(900);
  expect((await st(page)).page).toBe(1);
});

test('文字层：鼠标拖选、选区矩形、装饰、点击装饰、setSelection', async ({ page }) => {
  await open(page, 'view=1');
  // 第 1 行文字约在屏幕 y=275，x 28..280
  await page.mouse.move(40, 276);
  await page.mouse.down();
  await page.mouse.move(150, 276, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const sel = await h<any>(page, 'h.reader.getSelection()');
  expect(sel).toBeTruthy();
  expect(sel.range.section).toBe(0);
  expect(sel.text.length).toBeGreaterThan(3);
  expect(sel.text).toMatch(/^P1|1 L1|L1/);
  expect(await h<string[]>(page, 'h.events.map(e=>e.type)')).toContain('selection');
  // 程序化选择第二行
  await h(page, 'h.reader.setSelection({section:0,start:23,end:30})');
  await page.waitForTimeout(100);
  expect((await h<any>(page, 'h.reader.getSelection()')).text).toBe('P1 L2 h');
  await h(page, 'h.reader.setSelection(null)');
  expect(await h(page, 'h.reader.getSelection()')).toBeNull();
  // 装饰
  await h(page, "h.reader.setDecorations('annotations', [{id:'a1', range:{section:0,start:46,end:60}, style:'highlight', color:'rgba(255,200,0,.5)'},{id:'a2', range:{section:0,start:69,end:85}, style:'underline'}])");
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/fixed-deco.png' });
  expect(await h<number>(page, '[...h.reader.views.values()][0].deco.children.length')).toBeGreaterThanOrEqual(2);
  const rects = await h<any[]>(page, 'h.reader.getRangeRects({section:0,start:46,end:60})');
  expect(rects.length).toBe(1);
  expect(await h<boolean>(page, 'h.reader.isRangeVisible({section:0,start:46,end:60})')).toBe(true);
  // 点击装饰
  await h(page, 'h.events.length = 0');
  await page.mouse.click(rects[0].x + rects[0].width / 2, rects[0].y + rects[0].height / 2);
  await page.waitForTimeout(400);
  const ev = await h<any[]>(page, 'h.events.filter(e=>e.type==="decorationClick").map(e=>e.payload)');
  expect(ev[0]).toMatchObject({ layer: 'annotations', id: 'a1' });
  expect(await h<string>(page, 'h.reader.getSectionText(0).then(t=>t.slice(0,11))')).toBe('P1 L1 hello');
});

test('点击上报（延迟一个双击窗口）与长按选词', async ({ page, context }) => {
  await open(page, 'view=1');
  await h(page, 'h.events.length = 0');
  await page.mouse.click(206, 700);
  await page.waitForTimeout(500);
  const taps = await h<any[]>(page, 'h.events.filter(e=>e.type==="tap").map(e=>e.payload)');
  expect(taps.length).toBe(1);
  expect(taps[0].x).toBeCloseTo(0.5, 1);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 60, y: 276, id: 1 }] } as never);
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] } as never);
  await page.waitForTimeout(200);
  const sel = await h<any>(page, 'h.reader.getSelection()');
  expect(sel?.text).toBeTruthy();
});

test('窗口尺寸变化后保持当前页', async ({ page }) => {
  await open(page, 'view=1');
  await h(page, 'h.reader.goTo({section:4})');
  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForTimeout(500);
  const s = await st(page);
  expect(s.page).toBe(4);
  expect(s.boxW).toBeGreaterThan(600);
});

test('自动滚屏（连续模式）：滚动、暂停/继续、横拖停止，事件带 paused', async ({ page, context }) => {
  await open(page, 'view=2&fpages=20');
  await h(page, 'h.settings.autoScrollSettings.set({ autoScrollSpeed: 20 })');
  const last = () => h<any>(page, 'h.events.filter(e=>e.type==="autoScroll").map(e=>e.payload).at(-1)');
  const cdp = await context.newCDPSession(page);
  const t = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as never);
  await h(page, 'h.reader.startAutoScroll()');
  expect(await last()).toMatchObject({ running: true, paused: false });
  const y0 = (await st(page)).sy;
  await page.waitForTimeout(800);
  expect((await st(page)).sy).toBeGreaterThan(y0 + 100);
  // 单击 = 暂停
  await t('touchStart', 200, 500);
  await t('touchEnd');
  await page.waitForTimeout(200);
  expect(await last()).toMatchObject({ running: false, paused: true });
  const y1 = (await st(page)).sy;
  await page.waitForTimeout(400);
  expect((await st(page)).sy).toBe(y1);
  // 再点 = 继续，且不上报 tap
  await h(page, 'h.events.length = 0');
  await t('touchStart', 200, 500);
  await t('touchEnd');
  await page.waitForTimeout(500);
  expect(await last()).toMatchObject({ running: true, paused: false });
  expect((await st(page)).sy).toBeGreaterThan(y1);
  expect(await h<number>(page, 'h.events.filter(e=>e.type==="tap").length')).toBe(0);
  // 横拖 > 80px = 停止
  await t('touchStart', 100, 500);
  for (let i = 1; i <= 6; i++) await t('touchMove', 100 + i * 30, 500);
  await t('touchEnd');
  await page.waitForTimeout(200);
  expect(await last()).toMatchObject({ running: false, paused: false });
  expect(await h<boolean>(page, 'h.reader.isAutoScrolling()')).toBe(false);
  // 停止后的单击是普通点击
  await h(page, 'h.events.length = 0');
  await t('touchStart', 200, 500);
  await t('touchEnd');
  await page.waitForTimeout(500);
  expect(await h<number>(page, 'h.events.filter(e=>e.type==="tap").length')).toBe(1);
  expect(await h<number>(page, 'h.events.filter(e=>e.type==="autoScroll").length')).toBe(0);
});
