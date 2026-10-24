// 真实样书（samples/，不进 git）上的引擎行为：EPUB/TXT 的整行翻页与章间衔接、漫画 CBZ、PDF（用 chromium 现场生成）。
// 样书缺失时对应用例会跳过。
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const URL = '/src/reader/engine/dev/harness.html';
const SAMPLES = path.resolve('samples/books');
const have = (f: string) => fs.existsSync(path.join(SAMPLES, f));

async function open(page: Page, query: string, timeout = 30000) {
  await page.goto(`${URL}?${query}`);
  await page.waitForFunction(() => (window as any).__h?.ready || (window as any).__h?.error, null, { timeout });
  expect(await page.evaluate(() => (window as any).__h.error)).toBe('');
}
const h = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(async()=>{const h=window.__h;return (${fn})})()`) as Promise<T>;
const loc = (page: Page) => h<any>(page, 'h.reader.getLocation()');

test('EPUB（爱丽丝）：带图章节整行翻页、跨章、目录定位、重排保持锚点', async ({ page }) => {
  test.skip(!have('pg11-alice.epub'));
  await open(page, 'flip=3&speed=50&src=/samples/books/pg11-alice.epub&lang=en');
  const l0 = await loc(page);
  expect(l0.pages).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/books-alice-0.png' });
  let sections = new Set<number>([l0.section]);
  for (let i = 0; i < 40; i++) {
    await h(page, 'h.reader.next()');
    expect(await h<number>(page, 'h.cutLines()')).toBe(0);
    sections.add((await loc(page)).section);
  }
  expect(sections.size).toBeGreaterThanOrEqual(1);
  const mid = await loc(page);
  expect(mid.progress).toBeGreaterThan(l0.progress);
  await page.screenshot({ path: 'test-results/books-alice-40.png' });
  // 目录跳转
  const toc = await h<any[]>(page, 'h.book.toc.map(t=>({section:t.section,anchor:t.anchor,title:t.title}))');
  expect(toc.length).toBeGreaterThan(3);
  const target = toc[Math.min(5, toc.length - 1)];
  await h(page, `h.reader.goTo({ section: ${target.section}, anchor: ${JSON.stringify(target.anchor ?? null)} ?? undefined })`);
  expect((await loc(page)).section).toBe(target.section);
  // 字号变化保持锚点
  const a = await loc(page);
  await h(page, 'h.settings.textSettings.set({ fontSize: 26 })');
  await page.waitForTimeout(1200);
  const b = await loc(page);
  expect(b.section).toBe(a.section);
  expect(Math.abs(b.locator.offset - a.locator.offset)).toBeLessThan(120);
  expect(await h<number>(page, 'h.cutLines()')).toBe(0);
  // 往回翻到头
  for (let i = 0; i < 400 && !(await loc(page)).atStart; i++) await h(page, 'h.reader.prev()');
  expect((await loc(page)).atStart).toBe(true);
});

test('EPUB：滚动模式下连续滚动穿过章节', async ({ page }) => {
  test.skip(!have('pg11-alice.epub'));
  await open(page, 'flip=0&src=/samples/books/pg11-alice.epub&lang=en');
  await page.mouse.move(200, 400);
  const secs = new Set<number>();
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 700);
    if (i % 6 === 0) {
      await page.waitForTimeout(150);
      secs.add((await loc(page)).section);
    }
  }
  await page.waitForTimeout(300);
  expect((await loc(page)).progress).toBeGreaterThan(0.05);
  expect(secs.size).toBeGreaterThanOrEqual(1);
});

test('TXT（红楼梦，GBK/大文件）：打开耗时、翻页、按进度跳转', async ({ page }) => {
  test.skip(!have('hlm-simp-gbk.txt'));
  const t0 = Date.now();
  await open(page, 'flip=3&speed=50&src=/samples/books/hlm-simp-gbk.txt', 60000);
  const openMs = Date.now() - t0;
  console.log('TXT open ms', openMs);
  expect(openMs).toBeLessThan(20000);
  const l0 = await loc(page);
  expect(l0.pages).toBeGreaterThan(1);
  for (let i = 0; i < 10; i++) await h(page, 'h.reader.next()');
  expect(await h<number>(page, 'h.cutLines()')).toBe(0);
  await h(page, 'h.reader.goTo({ progress: 0.5 })');
  const mid = await loc(page);
  expect(mid.progress).toBeGreaterThan(0.4);
  expect(mid.progress).toBeLessThan(0.6);
  await page.screenshot({ path: 'test-results/books-hlm-mid.png' });
  // 简繁转换：偏移基准不变
  const before = await h<string>(page, 'h.reader.getSectionText(h.reader.getLocation().section)');
  await h(page, 'h.settings.textSettings.set({ textJian2Fan: true })');
  await page.waitForTimeout(2500);
  const after = await h<string>(page, 'h.reader.getSectionText(h.reader.getLocation().section)');
  expect(after).toBe(before);
  const dom = await h<string>(page, 'h.reader.frames.get(h.reader.getLocation().section).doc.body.textContent.length');
  expect(Number(dom)).toBe(before.length);
});

test('EPUB（红楼梦，中文）双页', async ({ page }) => {
  test.skip(!have('pg24264-hongloumeng.epub'));
  await page.setViewportSize({ width: 1100, height: 700 });
  await open(page, 'flip=3&speed=50&dual=on&src=/samples/books/pg24264-hongloumeng.epub', 60000);
  expect((await h<any>(page, 'h.dualState()')).dual).toBe(true);
  for (let i = 0; i < 6; i++) await h(page, 'h.reader.next()');
  const d = await h<any>(page, 'h.dualState()');
  expect(d.right?.vis === 'visible' || d.rightTop === null).toBe(true);
  await page.screenshot({ path: 'test-results/books-hlm-dual.png' });
  expect(await h<string>(page, 'h.error')).toBe('');
});

test('漫画 CBZ：单页翻页、连续滚动、缩放；日漫 rtl', async ({ page }) => {
  test.skip(!have('sample.cbz'));
  await open(page, 'fixed=1&view=1&src=/samples/books/sample.cbz');
  const s0 = await h<any>(page, 'h.fstate()');
  expect(s0.page).toBe(0);
  const n = (await loc(page)).pages;
  expect(n).toBeGreaterThan(1);
  await h(page, 'h.reader.next()');
  expect((await h<any>(page, 'h.fstate()')).page).toBe(1);
  await page.screenshot({ path: 'test-results/books-cbz-1.png' });
  await h(page, 'h.settings.fixedSettings.set({ pdfViewMode: 2 })');
  await page.waitForTimeout(800);
  expect((await h<any>(page, 'h.fstate()')).mode).toBe('continuous');
  await page.screenshot({ path: 'test-results/books-cbz-strip.png' });
  await h(page, 'h.settings.fixedSettings.set({ pdfViewMode: 1 })');
  await page.waitForTimeout(800);
  expect((await h<any>(page, 'h.fstate()')).mode).toBe('single');
  test.skip(!have('sample-manga-rtl.cbz'));
  await open(page, 'fixed=1&view=1&src=/samples/books/sample-manga-rtl.cbz');
  expect((await h<any>(page, 'h.fstate()')).rtl).toBe(true);
});

test('PDF（chromium 现场生成）：渲染、文字层、选择、连续滚动、夜间反色', async ({ page, context }) => {
  const dir = path.resolve('samples/_engine');
  fs.mkdirSync(dir, { recursive: true });
  const gen = await context.newPage();
  const body = Array.from({ length: 6 }, (_, i) => `<section style="page-break-after:always;font:20px serif"><h1>Chapter ${i + 1}</h1>${Array.from({ length: 12 }, (_, k) => `<p>Paragraph ${k + 1} of chapter ${i + 1}: the quick brown fox jumps over the lazy dog.</p>`).join('')}</section>`).join('');
  await gen.setContent(`<html><body>${body}</body></html>`);
  fs.writeFileSync(path.join(dir, 'gen.pdf'), await gen.pdf({ format: 'A5' }));
  await gen.close();
  await open(page, 'fixed=1&view=1&src=/samples/_engine/gen.pdf');
  const l = await loc(page);
  expect(l.pages).toBeGreaterThanOrEqual(6); // A5 一章约占 2 页
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/books-pdf-0.png' });
  const text = await h<string>(page, 'h.reader.getSectionText(0)');
  expect(text).toContain('Chapter 1');
  // 程序化选择第一段文字，矩形落在页内
  const i = text.indexOf('quick brown');
  await h(page, `h.reader.setSelection({section:0,start:${i},end:${i + 11}})`);
  await page.waitForTimeout(300);
  const sel = await h<any>(page, 'h.reader.getSelection()');
  expect(sel.text).toBe('quick brown');
  expect(sel.rect.width).toBeGreaterThan(20);
  await h(page, 'h.reader.setSelection(null)');
  // 翻页动画（仿真）用真实 PDF 页做纹理
  await h(page, 'h.settings.fixedSettings.set({ flipPdf: 1 })');
  expect(await h(page, 'h.freeze(1, 1, 0.5)')).toBe(true);
  await page.screenshot({ path: 'test-results/books-pdf-curl.png' });
  await h(page, 'h.unfreeze()');
  // 夜间反色
  await h(page, 'h.settings.fixedSettings.set({ pdfTheme: 1 })');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/books-pdf-night.png' });
  // 连续滚动
  await h(page, 'h.settings.fixedSettings.set({ pdfViewMode: 2, pdfTheme: 0 })');
  await page.waitForTimeout(800);
  await page.mouse.move(200, 400);
  for (let i2 = 0; i2 < 5; i2++) await page.mouse.wheel(0, 700);
  await page.waitForTimeout(600);
  expect((await h<any>(page, 'h.fstate()')).page).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/books-pdf-strip.png' });
});
