// 可重排引擎端到端：滚动模式、字符锚点、装饰、链接/图片事件、选择、双页、自动滚屏、书内 CSS、显示性变换、背景。
import { expect, test, type Page } from '@playwright/test';

const URL = '/src/reader/engine/dev/harness.html';
async function open(page: Page, query = '') {
  await page.goto(`${URL}?${query}`);
  await page.waitForFunction(() => (window as any).__h?.ready || (window as any).__h?.error, null, { timeout: 15000 });
  expect(await page.evaluate(() => (window as any).__h.error)).toBe('');
}
const h = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(async()=>{const h=window.__h;return (${fn})})()`) as Promise<T>;
const st = (page: Page) => h<any>(page, 'h.state()');
const loc = (page: Page) => h<any>(page, 'h.reader.getLocation()');
const evs = (page: Page, type: string) => h<any[]>(page, `h.events.filter(e=>e.type==="${type}").map(e=>e.payload)`);
const wait = (page: Page, ms: number) => page.waitForTimeout(ms);

test('滚动模式：滚轮滚动、跨章无缝衔接、位置单调', async ({ page }) => {
  await open(page, 'flip=0&chapters=3&paras=8');
  expect((await st(page)).mode).toBe('scroll');
  await page.mouse.move(200, 400);
  let last = -1;
  let maxSection = 0;
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 500);
    await wait(page, 120);
    const l = await loc(page);
    expect(l.progress).toBeGreaterThanOrEqual(last);
    last = l.progress;
    maxSection = Math.max(maxSection, l.section);
  }
  expect(maxSection).toBeGreaterThanOrEqual(1);
  expect(last).toBeGreaterThan(0.3);
  const s = await st(page);
  // 相邻章已预载，章与章首尾相接
  expect(s.frames.length).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: 'test-results/reflow-scroll.png' });
  // 往回滚到书首
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -800);
  await wait(page, 300);
  const l0 = await loc(page);
  expect(l0.atStart).toBe(true);
  expect(l0.progress).toBe(0);
});

test('字号变化后保持字符锚点；窗口缩放后保持', async ({ page }) => {
  await open(page, 'flip=1&speed=0');
  await h(page, 'h.reader.goTo({section:1, offset:700})');
  const a = await loc(page);
  expect(a.locator.section).toBe(1);
  expect(a.locator.offset).toBeGreaterThan(300);
  await h(page, 'h.settings.textSettings.set({ fontSize: 28 })');
  await wait(page, 700);
  const b = await loc(page);
  expect(b.locator.section).toBe(1);
  expect(Math.abs(b.locator.offset - a.locator.offset)).toBeLessThan(40);
  expect(b.pages).toBeGreaterThan(a.pages);
  expect(await h<number>(page, 'h.cutLines()')).toBe(0);
  await h(page, 'h.settings.textSettings.set({ fontSize: 12, leftMargin: 40, rightMargin: 40 })');
  await wait(page, 700);
  const c = await loc(page);
  expect(Math.abs(c.locator.offset - b.locator.offset)).toBeLessThan(60);
  await page.setViewportSize({ width: 600, height: 700 });
  await wait(page, 800);
  const d = await loc(page);
  expect(d.locator.section).toBe(1);
  expect(Math.abs(d.locator.offset - c.locator.offset)).toBeLessThan(80);
  expect(await h<number>(page, 'h.cutLines()')).toBe(0);
});

test('装饰：高亮/下划线/方框、区间矩形、可见性、点击装饰', async ({ page }) => {
  await open(page, 'flip=1&speed=0');
  await h(page, `h.reader.setDecorations('annotations', [
    {id:'h1', range:{section:0,start:20,end:40}, style:'highlight', color:'rgba(255,200,0,.5)'},
    {id:'u1', range:{section:0,start:60,end:75}, style:'underline'},
    {id:'b1', range:{section:0,start:100,end:110}, style:'box'},
    {id:'far', range:{section:0,start:2500,end:2520}, style:'highlight'}])`);
  await wait(page, 200);
  expect(await h<number>(page, 'h.reader.frames.get(0).win.CSS.highlights.size')).toBeGreaterThanOrEqual(2);
  expect(await h<number>(page, "h.reader.frames.get(0).doc.getElementById('mr-deco-overlay').children.length")).toBeGreaterThan(0);
  const rects = await h<any[]>(page, 'h.reader.getRangeRects({section:0,start:20,end:40})');
  expect(rects.length).toBeGreaterThanOrEqual(1);
  expect(await h<boolean>(page, 'h.reader.isRangeVisible({section:0,start:20,end:40})')).toBe(true);
  expect(await h<boolean>(page, 'h.reader.isRangeVisible({section:0,start:2500,end:2520})')).toBe(false);
  expect(await h<any[]>(page, 'h.reader.getRangeRects({section:0,start:2500,end:2520})')).toHaveLength(0);
  await page.screenshot({ path: 'test-results/reflow-deco.png' });
  await h(page, 'h.events.length = 0');
  await page.mouse.click(rects[0].x + 6, rects[0].y + rects[0].height / 2);
  await wait(page, 300);
  expect((await evs(page, 'decorationClick'))[0]).toMatchObject({ layer: 'annotations', id: 'h1' });
  // 清掉图层
  await h(page, "h.reader.setDecorations('annotations', [])");
  expect(await h<number>(page, 'h.reader.frames.get(0).win.CSS.highlights.size')).toBe(0);
  // 翻到装饰所在的远处：goTo + flash
  await h(page, 'h.reader.goTo({range:{section:0,start:2500,end:2520}, flash:true})');
  await wait(page, 200);
  expect(await h<boolean>(page, 'h.reader.isRangeVisible({section:0,start:2500,end:2520})')).toBe(true);
});

test('链接事件：书内锚点、脚注、外链、跨章；图片事件', async ({ page }) => {
  await open(page, 'flip=1&speed=0&paras=12');
  const click = async (id: string) => {
    let r = await h<any>(page, `h.rectOf('${id}')`);
    if (r.y < 0 || r.y > 850) {
      await h(page, `h.reader.goTo({ section: 0, anchor: '${id}' })`);
      r = await h<any>(page, `h.rectOf('${id}')`);
    }
    expect(r.y).toBeGreaterThan(0);
    expect(r.y).toBeLessThan(900);
    await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    await wait(page, 300);
  };
  // 脚注链接（notes.xhtml#n1）→ 弹窗事件，不跳转
  const y0 = (await st(page)).pos.y;
  await click('fn');
  let ev = await evs(page, 'link');
  expect(ev.at(-1)).toMatchObject({ internal: true });
  expect(ev.at(-1).footnoteHtml).toContain('脚注');
  expect((await st(page)).pos.y).toBe(y0);
  // 外链：只上报
  await click('ext');
  ev = await evs(page, 'link');
  expect(ev.at(-1)).toMatchObject({ href: 'http://example.com/', internal: false });
  // 章内锚点 #p10：跳转并上报
  await click('lnk');
  ev = await evs(page, 'link');
  expect(ev.at(-1)).toMatchObject({ href: '#p10', internal: true });
  expect((await st(page)).pos.y).toBeGreaterThan(y0);
  expect(await h<string>(page, "h.reader.frames.get(0).doc.getElementById('lnk').className")).toContain('mr-visited');
  // 跨章链接
  await h(page, "h.reader.goTo({href:'ch2.xhtml#p2'})");
  expect((await loc(page)).section).toBe(2);
});

test('图片事件：点击图片上报 src/alt/rect', async ({ page }) => {
  await open(page, 'flip=1&speed=0&img=1');
  const r = await h<any>(page, "h.rectOf('img1')");
  expect(r.y).toBeLessThan(800);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await wait(page, 300);
  const im = await evs(page, 'image');
  expect(im.at(-1).src).toContain('data:image/svg');
  expect(im.at(-1).alt).toBe('示意图1');
  expect(im.at(-1).rect.width).toBeGreaterThan(50);
});

test('选择：程序化选区与鼠标选字', async ({ page }) => {
  await open(page, 'flip=1&speed=0');
  const text = await h<string>(page, 'h.reader.getSectionText(0)');
  await h(page, 'h.reader.setSelection({section:0,start:10,end:22})');
  await wait(page, 100);
  const sel = await h<any>(page, 'h.reader.getSelection()');
  expect(sel.text).toBe(text.slice(10, 22));
  expect(sel.rect.width).toBeGreaterThan(10);
  expect((await evs(page, 'selection')).at(-1).range).toEqual({ section: 0, start: 10, end: 22 });
  await h(page, 'h.reader.setSelection(null)');
  expect(await h(page, 'h.reader.getSelection()')).toBeNull();
  expect((await evs(page, 'selection')).at(-1)).toBeNull();
  // 鼠标双击选词（原生选择；无头 Chromium 里沙箱 iframe 内的拖选会卡死 CDP 的鼠标事件，所以不用拖选测）
  const r = await h<any>(page, "h.rectOf('p1')");
  await page.mouse.dblclick(r.x + 80, r.y + 14);
  await wait(page, 500);
  const sel2 = await h<any>(page, 'h.reader.getSelection()');
  expect(sel2).toBeTruthy();
  expect(sel2.text).toBe(text.slice(sel2.range.start, sel2.range.end));
  expect(sel2.range.end - sel2.range.start).toBeGreaterThanOrEqual(1);
  expect(sel2.rect.width).toBeGreaterThan(5);
  // 点空白处取消
  await h(page, 'h.reader.setSelection(null)');
});

test('触屏：点击上报、长按选词、上下滑动滚动、横划翻页', async ({ page, context }) => {
  await open(page, 'flip=0&speed=0');
  const cdp = await context.newCDPSession(page);
  const t = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as never);
  await h(page, 'h.events.length = 0');
  await t('touchStart', 206, 600);
  await t('touchEnd');
  await wait(page, 100);
  const tap = (await evs(page, 'tap'))[0];
  expect(tap.x).toBeCloseTo(0.5, 1);
  expect(tap.y).toBeCloseTo(600 / 915, 1);
  // 长按文字：选词（CJK 单字）
  const r = await h<any>(page, "h.rectOf('p1')");
  await t('touchStart', r.x + 60, r.y + 14);
  await wait(page, 700);
  await t('touchEnd');
  await wait(page, 200);
  const sel = await h<any>(page, 'h.reader.getSelection()');
  expect(sel?.text.length).toBeGreaterThanOrEqual(1);
  await h(page, 'h.reader.setSelection(null)');
  // 长按空白处：longPress
  await t('touchStart', 206, 880);
  await wait(page, 700);
  await t('touchEnd');
  expect((await evs(page, 'longPress')).length).toBeGreaterThanOrEqual(0);
  // 上滑：滚动模式滚动
  const y0 = (await st(page)).pos.y;
  await t('touchStart', 200, 700);
  for (let i = 1; i <= 8; i++) await t('touchMove', 200, 700 - i * 40);
  await t('touchEnd', 200, 380);
  await wait(page, 800);
  expect((await st(page)).pos.y).toBeGreaterThan(y0 + 250);
});

test('触屏：分页模式（水平切换）手指跟随翻页', async ({ page, context }) => {
  await open(page, 'flip=3&speed=50');
  const cdp = await context.newCDPSession(page);
  const t = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as never);
  const y0 = (await st(page)).pos.y;
  await t('touchStart', 380, 450);
  for (let i = 1; i <= 10; i++) await t('touchMove', 380 - i * 30, 450);
  await t('touchEnd');
  await wait(page, 900);
  expect((await st(page)).pos.y).toBeGreaterThan(y0);
  expect(await h<number>(page, 'h.cutLines()')).toBe(0);
  // 向右拖回
  await t('touchStart', 60, 450);
  for (let i = 1; i <= 10; i++) await t('touchMove', 60 + i * 30, 450);
  await t('touchEnd');
  await wait(page, 900);
  expect(Math.abs((await st(page)).pos.y - y0)).toBeLessThan(1);
});

test('双页：左右两页窗口、一次翻两页、往返、动画', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await open(page, 'dual=on&flip=0&speed=50&fs=16');
  // flip=0 是滚动模式：双页只在分页模式下生效
  expect((await h<any>(page, 'h.dualState()')).dual).toBe(false);
  await open(page, 'dual=on&flip=3&speed=50&fs=16');
  let d = await h<any>(page, 'h.dualState()');
  expect(d.dual).toBe(true);
  expect(d.right.vis).toBe('visible');
  expect(d.right.x).toBeGreaterThan(d.left.x + d.W);
  expect(d.rightTop).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/reflow-dual.png' });
  const l0 = await loc(page);
  expect(l0.visible.end).toBeGreaterThan(l0.visible.start);
  const y0 = d.pos.y;
  const rt0 = d.rightTop;
  await h(page, 'h.reader.next()');
  d = await h<any>(page, 'h.dualState()');
  expect(d.pos.y).toBeGreaterThan(rt0); // 一次翻两页：新左页在旧右页之后
  const l1 = await loc(page);
  expect(l1.visible.start).toBeGreaterThanOrEqual(l0.visible.end - 40);
  await h(page, 'h.reader.prev()');
  d = await h<any>(page, 'h.dualState()');
  expect(Math.abs(d.pos.y - y0)).toBeLessThan(1);
  // 一路翻过章末：新章从左页开始
  for (let i = 0; i < 30 && (await loc(page)).section === 0; i++) await h(page, 'h.reader.next()');
  const lc = await loc(page);
  expect(lc.section).toBe(1);
  d = await h<any>(page, 'h.dualState()');
  expect(d.pos.y).toBe(0);
  await h(page, 'h.reader.prev()');
  expect((await loc(page)).section).toBe(0);
  expect((await h<any>(page, 'h.dualState()')).rightTop).not.toBeNull();
});

for (const anim of [1, 2, 4, 5, 6, 7]) {
  test(`双页翻页动画 ${anim}`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await open(page, `dual=on&flip=${anim}&speed=50&fs=16`);
    const y0 = (await h<any>(page, 'h.dualState()')).pos.y;
    expect(await h(page, `h.freeze(1, ${anim}, 0.5)`)).toBe(true);
    await page.screenshot({ path: `test-results/reflow-dual-anim${anim}.png` });
    await h(page, 'h.unfreeze()');
    expect((await h<any>(page, 'h.dualState()')).pos.y).toBe(y0);
    await h(page, 'h.reader.next()');
    expect((await h<any>(page, 'h.dualState()')).pos.y).toBeGreaterThan(y0);
    await h(page, 'h.reader.prev()');
    expect(Math.abs((await h<any>(page, 'h.dualState()')).pos.y - y0)).toBeLessThan(1);
  });
}

for (const [mode, name] of [[0, '卷帘·像素'], [1, '卷帘·行'], [2, '像素'], [3, '逐行'], [4, '逐页']] as const) {
  test(`自动滚屏 ${mode} ${name}：开始、前进、暂停/停止`, async ({ page }) => {
    await open(page, 'flip=1&speed=0');
    await h(page, `h.settings.autoScrollSettings.set({ autoScrollMode: ${mode}, autoScrollSpeed: ${mode === 2 ? 30 : 0} })`);
    const p0 = (await loc(page)).progress;
    await h(page, 'h.reader.startAutoScroll()');
    await wait(page, mode === 3 ? 1500 : 2200);
    expect(await h<boolean>(page, 'h.reader.isAutoScrolling()')).toBe(true);
    const p1 = (await loc(page)).progress;
    expect(p1).toBeGreaterThan(p0);
    await page.screenshot({ path: `test-results/reflow-auto${mode}.png` });
    await h(page, 'h.reader.stopAutoScroll()');
    await wait(page, 300);
    expect(await h<boolean>(page, 'h.reader.isAutoScrolling()')).toBe(false);
    const p2 = (await loc(page)).progress;
    await wait(page, 500);
    expect((await loc(page)).progress).toBe(p2);
    const ev = await h<any[]>(page, 'h.events.filter(e=>e.type==="autoScroll").map(e=>e.payload.running)');
    expect(ev[0]).toBe(true);
    expect(ev.at(-1)).toBe(false);
  });
}

test('自动滚屏：触摸暂停/继续与调速', async ({ page, context }) => {
  await open(page, 'flip=1&speed=0');
  await h(page, 'h.settings.autoScrollSettings.set({ autoScrollMode: 2, autoScrollSpeed: 40 })');
  await h(page, 'h.reader.startAutoScroll()');
  await wait(page, 500);
  const cdp = await context.newCDPSession(page);
  const t = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as never);
  const last = () => h<any>(page, 'h.events.filter(e=>e.type==="autoScroll").map(e=>e.payload).at(-1)');
  // 单击 = 暂停：running=false 且 paused=true
  await t('touchStart', 200, 500);
  await t('touchEnd');
  await wait(page, 200);
  expect(await h<boolean>(page, 'h.reader.isAutoScrolling()')).toBe(false);
  expect(await last()).toMatchObject({ running: false, paused: true });
  // 暂停中再点一下 = 继续（不上报 tap）
  await h(page, 'h.events.length = 0');
  await t('touchStart', 200, 500);
  await t('touchEnd');
  await wait(page, 200);
  expect(await h<boolean>(page, 'h.reader.isAutoScrolling()')).toBe(true);
  expect(await last()).toMatchObject({ running: true, paused: false });
  expect((await evs(page, 'tap')).length).toBe(0);
  // 上拖 100px：speed 值 −5（变快）
  const s0 = await h<number>(page, 'h.settings.autoScrollSettings.get().autoScrollSpeed');
  await t('touchStart', 200, 600);
  for (let i = 1; i <= 5; i++) await t('touchMove', 200, 600 - i * 20);
  await t('touchEnd');
  expect(await h<number>(page, 'h.settings.autoScrollSettings.get().autoScrollSpeed')).toBeLessThan(s0);
  // 横拖 > 80px = 停止
  await t('touchStart', 100, 500);
  for (let i = 1; i <= 6; i++) await t('touchMove', 100 + i * 30, 500);
  await t('touchEnd');
  await wait(page, 200);
  expect(await h<boolean>(page, 'h.reader.isAutoScrolling()')).toBe(false);
  // 真正停止：paused 必须是 false，界面据此不再把下一次单击当作「继续」
  expect(await last()).toMatchObject({ running: false, paused: false });
  await h(page, 'h.events.length = 0');
  await t('touchStart', 200, 500);
  await t('touchEnd');
  await wait(page, 300);
  expect(await h<boolean>(page, 'h.reader.isAutoScrolling()')).toBe(false);
  expect((await evs(page, 'autoScroll')).length).toBe(0);
  expect((await evs(page, 'tap')).length).toBe(1); // 停止之后的单击回到普通点击
});

test('书内 CSS：默认采纳，禁用分项时剔除对应属性', async ({ page }) => {
  const css = encodeURIComponent('p{font-size:40px;color:#ff0000;text-indent:3em} h1{font-weight:300}');
  await open(page, `flip=1&css=${css}`);
  expect(await h<string>(page, "h.styleOf('#p1','fontSize')")).toBe('40px');
  expect(await h<string>(page, "h.styleOf('#p1','color')")).toBe('rgb(255, 0, 0)');
  await h(page, 'h.settings.cssSettings.set({ disableCSS: true, cssFontSize: true })');
  await wait(page, 600);
  expect(await h<string>(page, "h.styleOf('#p1','fontSize')")).toBe('18px');
  expect(await h<string>(page, "h.styleOf('#p1','color')")).toBe('rgb(255, 0, 0)');
  await h(page, 'h.settings.cssSettings.set({ cssFontColor: true, cssIndent: true })');
  await wait(page, 600);
  expect(await h<string>(page, "h.styleOf('#p1','color')")).not.toBe('rgb(255, 0, 0)');
  expect(await h<string>(page, "h.styleOf('#p1','textIndent')")).not.toBe('54px');
});

test('显示性变换：简繁（等长）、名字替换、去空行、缩进，偏移基准不变', async ({ page }) => {
  await open(page, 'flip=1&speed=0');
  const text0 = await h<string>(page, 'h.reader.getSectionText(0)');
  await h(page, 'h.settings.textSettings.set({ textJian2Fan: true })');
  await wait(page, 1200);
  const dom = await h<string>(page, 'h.reader.frames.get(0).doc.body.textContent');
  expect(dom).toContain('談笑有鴻儒');
  expect(dom.length).toBe(text0.length);
  expect(await h<string>(page, 'h.reader.getSectionText(0)')).toBe(text0);
  // 选区按原文偏移，显示的是转换后的字
  const i = text0.indexOf('谈笑有鸿儒');
  await h(page, `h.reader.setSelection({section:0,start:${i},end:${i + 5}})`);
  expect((await h<any>(page, 'h.reader.getSelection()')).text).toBe('談笑有鴻儒');
  await h(page, 'h.reader.setSelection(null)');
  await h(page, 'h.settings.textSettings.set({ textJian2Fan: false })');
  // 名字替换：变长也不影响偏移基准
  await h(page, "h.settings.nameSettings.set({ rules: [{ from: '孔子', to: '孔夫子大人' }] })");
  await wait(page, 800);
  const dom2 = await h<string>(page, 'h.reader.frames.get(0).doc.body.textContent');
  expect(dom2).toContain('孔夫子大人云');
  expect(await h<string>(page, 'h.reader.getSectionText(0)')).toBe(text0);
  const k = text0.indexOf('孔子云');
  await h(page, `h.reader.setSelection({section:0,start:${k},end:${k + 3}})`);
  expect((await h<any>(page, 'h.reader.getSelection()')).text).toBe('孔夫子大人云');
  await h(page, "h.settings.nameSettings.set({ rules: [] })");
  await h(page, 'h.reader.setSelection(null)');
  // 首行缩进
  await h(page, 'h.settings.textSettings.set({ indentParagraph: true, indentLength: 3 })');
  await wait(page, 600);
  expect(await h<string>(page, "h.styleOf('#p1','textIndent')")).toBe('54px');
  await h(page, 'h.settings.textSettings.set({ indentParagraph: false })');
  await wait(page, 600);
  expect(await h<string>(page, "h.styleOf('#p1','textIndent')")).toBe('0px');
});

test('主题：颜色、字体样式、行距/段距/页边距生效', async ({ page }) => {
  await open(page, 'flip=1&speed=0');
  await h(page, "h.settings.textSettings.set({ fontColor: '#00ff00', fontBold: true, fontItalic: true, lineSpace: 8, fontSpace: 4, topMargin: 60 })");
  await wait(page, 700);
  expect(await h<string>(page, "h.styleOf('#p1','color')")).toBe('rgb(0, 255, 0)');
  expect(await h<string>(page, "h.styleOf('#p1','fontWeight')")).toBe('700');
  expect(await h<string>(page, "h.styleOf('#p1','fontStyle')")).toBe('italic');
  expect(parseFloat(await h<string>(page, "h.styleOf('#p1','letterSpacing')"))).toBeCloseTo(3.6, 1);
  const lh = parseFloat(await h<string>(page, "h.styleOf('#p1','lineHeight')"));
  expect(lh).toBeGreaterThan(18 * 1.5);
  expect(await h<number>(page, 'h.reader.stage.getBoundingClientRect().top')).toBe(60);
});

test('背景：纯色、内置纹理、用户图片（小图平铺/大图拉伸）', async ({ page }) => {
  await open(page, 'flip=1&speed=0');
  expect(await h<number>(page, 'h.textureCount')).toBeGreaterThanOrEqual(30);
  await h(page, "h.settings.textSettings.set({ backgroundColor: '#112233' })");
  await wait(page, 300);
  expect(await h<string>(page, 'h.reader.root.style.backgroundColor')).toBe('rgb(17, 34, 51)');
  await h(page, "h.settings.textSettings.set({ useBackgroundImage: true, backgroundImage: 'tex:readbg_12' })");
  await wait(page, 400);
  expect(await h<string>(page, 'h.reader.root.style.background')).toContain('radial-gradient');
  await page.screenshot({ path: 'test-results/reflow-texture.png' });
  const mk = (w: number, hgt: number) => `(async()=>{const c=document.createElement('canvas');c.width=${w};c.height=${hgt};const g=c.getContext('2d');g.fillStyle='#8a5';g.fillRect(0,0,${w},${hgt});const b=await new Promise(r=>c.toBlob(r));await h.setKV('test.bg${w}', b);})()`;
  await h(page, mk(200, 300));
  await h(page, mk(40, 40));
  await h(page, "h.settings.textSettings.set({ backgroundImage: 'img:test.bg200' })");
  await wait(page, 500);
  expect(await h<string>(page, 'h.reader.root.style.background')).toContain('100% 100%');
  await h(page, "h.settings.textSettings.set({ backgroundImage: 'img:test.bg40' })");
  await wait(page, 500);
  expect(await h<string>(page, 'h.reader.root.style.background')).toContain('repeat');
  await h(page, "h.settings.textSettings.set({ backgroundImage: 'img:missing' })");
  await wait(page, 500);
  expect(await h<string>(page, 'h.reader.root.style.backgroundColor')).toBe('rgb(17, 34, 51)');
});

test('章节导航：非主线章跳过、nextSection/prevSection、endOfBook、goTo 各形态', async ({ page }) => {
  await open(page, 'flip=1&speed=0&chapters=4&nonlinear=1');
  await h(page, 'h.reader.nextSection()');
  expect((await loc(page)).section).toBe(2); // 章 1 不在阅读主线
  await h(page, 'h.reader.prevSection()');
  expect((await loc(page)).section).toBe(0);
  await h(page, "h.reader.goTo({ section: 1, anchor: 'p3' })"); // 非主线章可以直接跳
  expect((await loc(page)).section).toBe(1);
  await h(page, 'h.reader.goTo({ progress: 0.5 })');
  const mid = await loc(page);
  expect(mid.progress).toBeGreaterThan(0.3);
  expect(mid.progress).toBeLessThan(0.7);
  await h(page, 'h.reader.goTo({ progress: 1 })');
  await h(page, 'h.events.length = 0');
  for (let i = 0; i < 60 && !(await loc(page)).atEnd; i++) await h(page, 'h.reader.next()');
  const end = await loc(page);
  expect(end.atEnd).toBe(true);
  expect(end.progress).toBe(1);
  await h(page, 'h.reader.next()');
  expect((await evs(page, 'endOfBook')).length).toBeGreaterThanOrEqual(1);
  await h(page, 'h.reader.goTo({ section: 3, offset: 0 })');
  await h(page, 'h.reader.prev()');
  expect((await loc(page)).section).toBe(2);
});

test('键盘事件上报、章末提示、纯图章、页底注解', async ({ page }) => {
  await open(page, 'flip=1&speed=0&paras=12');
  await h(page, 'h.reader.root.focus()');
  await page.keyboard.press('PageDown');
  await page.keyboard.press('ArrowLeft');
  const keys = (await evs(page, 'key')).map((k) => k.key);
  expect(keys).toEqual(expect.arrayContaining(['PageDown', 'ArrowLeft']));
  await h(page, 'h.settings.cssSettings.set({ chapterEndPrompt: true, footnoteOnBottom: true })');
  await wait(page, 800);
  expect(await h<number>(page, "h.reader.frames.get(0).doc.querySelectorAll('.mr-end').length")).toBe(1);
  expect(await h<number>(page, "h.reader.frames.get(0).doc.querySelectorAll('.mr-note').length")).toBeGreaterThanOrEqual(1);
  // 附加元素不改变文本偏移基准
  const t = await h<string>(page, 'h.reader.getSectionText(0)');
  const dom = await h<string>(page, 'h.reader.frames.get(0).doc.body.textContent');
  expect(dom).toBe(t);
});

test('长按/拖动的页边与防误触：边缘上下滑上报 verticalDrag', async ({ page, context }) => {
  await open(page, 'flip=1&speed=0');
  const cdp = await context.newCDPSession(page);
  const t = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as never);
  await h(page, 'h.events.length = 0');
  await t('touchStart', 10, 600);
  for (let i = 1; i <= 6; i++) await t('touchMove', 12, 600 - i * 25);
  await t('touchEnd');
  const vd = await evs(page, 'verticalDrag');
  expect(vd.length).toBeGreaterThanOrEqual(2);
  expect(vd.at(-1).phase).toBe('end');
  expect(vd[0].dy).toBeLessThan(0);
});

test('从指定位置打开：落在该字符所在行', async ({ page }) => {
  await open(page, 'flip=1&speed=0&section=1&offset=900');
  const l = await loc(page);
  expect(l.locator.section).toBe(1);
  expect(l.locator.offset).toBeLessThanOrEqual(900);
  expect(900 - l.locator.offset).toBeLessThan(60);
  expect(l.visible.end).toBeGreaterThan(900);
  expect(await h<number>(page, 'h.cutLines()')).toBe(0);
});

test('触屏手势：竖滑翻页（动画 4）、滚动模式下横向快划翻页、disableMove', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  const t = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as never);
  // 动画 4（上下滚动）：竖向位移 >20 且横向 <40 = 翻一页
  await open(page, 'flip=4&speed=50');
  const y0 = (await st(page)).pos.y;
  await t('touchStart', 200, 600);
  for (let i = 1; i <= 5; i++) await t('touchMove', 200, 600 - i * 30);
  await t('touchEnd');
  await wait(page, 900);
  const y1 = (await st(page)).pos.y;
  expect(y1).toBeGreaterThan(y0);
  expect(await h<number>(page, 'h.cutLines()')).toBe(0);
  // 禁止触摸滑动后竖滑不再翻页
  await h(page, 'h.settings.flipSettings.set({ disableMove: true })');
  await t('touchStart', 200, 600);
  for (let i = 1; i <= 5; i++) await t('touchMove', 200, 600 - i * 30);
  await t('touchEnd');
  await wait(page, 900);
  expect((await st(page)).pos.y).toBe(y1);
  // 滚动模式：快速横划 = 按 horiFlingAnimation 翻页
  await open(page, 'flip=0');
  await h(page, 'h.settings.flipSettings.set({ horiFlingAnimation: 3, flipSpeed: 50 })');
  const s0 = (await st(page)).pos.y;
  await t('touchStart', 380, 450);
  await t('touchMove', 300, 452);
  await t('touchMove', 200, 452);
  await t('touchMove', 100, 452);
  await t('touchEnd');
  await wait(page, 1000);
  expect((await st(page)).pos.y).toBeGreaterThan(s0 + 300);
});

test('双指缩放改字号（multTouch）：上报 pinch，阈值内不重排', async ({ page, context }) => {
  await open(page, 'flip=1&speed=0');
  await h(page, 'h.settings.controlSettings.set({ multTouch: true })');
  const cdp = await context.newCDPSession(page);
  const t = (type: string, pts: Array<{ x: number; y: number; id: number }>) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts } as never);
  await t('touchStart', [{ x: 150, y: 450, id: 1 }, { x: 250, y: 450, id: 2 }]);
  for (let i = 1; i <= 6; i++) await t('touchMove', [{ x: 150 - i * 15, y: 450, id: 1 }, { x: 250 + i * 15, y: 450, id: 2 }]);
  await t('touchEnd', []);
  await wait(page, 200);
  const pinches = await evs(page, 'pinch');
  expect(pinches.length).toBeGreaterThanOrEqual(3);
  expect(pinches.some((p) => p.phase === 'move' && p.scale > 1.5)).toBe(true);
  expect(pinches.at(-1).phase).toBe('end');
});

test('防边缘误触：边缘带内的触摸整体忽略', async ({ page, context }) => {
  await open(page, 'flip=0');
  await h(page, 'h.settings.controlSettings.set({ disableEdgeTouch: true, leftEdge: 30 })');
  const cdp = await context.newCDPSession(page);
  const t = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as never);
  await h(page, 'h.events.length = 0');
  await t('touchStart', 10, 500);
  await t('touchEnd');
  await wait(page, 100);
  expect((await evs(page, 'tap')).length).toBe(0);
  await t('touchStart', 200, 500);
  await t('touchEnd');
  await wait(page, 100);
  expect((await evs(page, 'tap')).length).toBe(1);
});

test('open 之前 / destroy 之后：查询类方法不抛错，返回 null/false/空', async ({ page }) => {
  for (const q of ['noopen=1&flip=1', 'noopen=1&fixed=1']) {
    await page.goto(`${URL}?${q}`);
    await page.waitForFunction(() => (window as any).__h?.ready);
    const probe = `(async () => {
      const r = h.reader; const out = {};
      out.loc = r.getLocation(); out.sel = r.getSelection(); out.auto = r.isAutoScrolling();
      out.rects = r.getRangeRects({ section: 0, start: 0, end: 5 }); out.vis = r.isRangeVisible({ section: 0, start: 0, end: 5 });
      r.setSelection(null); r.setSelection({ section: 0, start: 0, end: 3 }); r.setSelection(null);
      r.setDecorations('x', []); r.stopAutoScroll(); r.startAutoScroll(); r.stopAutoScroll();
      await r.next(); await r.prev(); await r.nextSection(); await r.prevSection(); await r.goTo({ section: 1 }); await r.relayout();
      out.text = await r.getSectionText(0); out.bad = await r.getSectionText(999);
      out.wb = await r.getSectionTextWithBreaks(999);
      return out; })()`;
    const before = await h<any>(page, probe);
    expect(before).toMatchObject({ loc: null, sel: null, auto: false, rects: [], vis: false });
    expect(before.bad).toBe('');
    expect(before.wb).toEqual({ text: '', breaks: [] });
    await h(page, 'h.open()');
    expect(await h<string>(page, 'h.error')).toBe('');
    expect((await loc(page)).section).toBe(0);
    await h(page, 'h.reader.destroy()');
    const after = await h<any>(page, probe);
    expect(after).toMatchObject({ loc: null, sel: null, auto: false, rects: [], vis: false });
    await h(page, 'h.reader.destroy()'); // 重复 destroy 也不抛错
  }
});
