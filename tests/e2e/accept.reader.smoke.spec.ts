// 阶段 4 整站冒烟：真页面 + 真引擎 + 真 formats + 真样书。
// 每种格式各取一本，手机 412×915 与桌面 1280×800 两种尺寸，走完整路径：
// 书架导入 → 打开 → 翻页（几种动画）→ 目录跳转 → 选字 → 高亮/笔记 → 书内搜索 → 朗读 → 改主题/字号 → 退出再进，进度恢复。
import { expect, test, type Page } from '@playwright/test';
import {
  FAKE_SPEECH,
  collectErrors,
  errorsOf,
  idbAll,
  importFile,
  leaveAndReopen,
  menuVisible,
  openFromShelf,
  openOptionsMenuItem,
  progressPct,
  selectWord,
  shot,
  skipClickTip,
  statusChapter,
  tapCenter,
  turn,
} from './accept.reader.helpers';

const SIZES = { phone: { width: 412, height: 915 }, desktop: { width: 1280, height: 800 } } as const;

interface Fmt {
  file: string;
  /** 搜索词（书里确实有） */
  q: string;
  /** 多页（翻页后进度必须前进） */
  multi?: boolean;
  /** 目录至少两项 */
  toc?: boolean;
}
const TEXT_FORMATS: Fmt[] = [
  { file: 'pg11-alice.epub', q: 'Rabbit', multi: true, toc: true },
  { file: 'pg11-alice.txt', q: 'Rabbit', multi: true, toc: true },
  { file: 'pg11-alice.kf8.mobi', q: 'Rabbit', multi: true, toc: true },
  { file: 'pg11-alice.mobi', q: 'Rabbit', multi: true },
  { file: 'pg11-alice.html', q: 'Rabbit', multi: true, toc: true },
  { file: 'sample.fb2', q: 'Rabbit', multi: true, toc: true },
  { file: 'sample.md', q: '第', toc: true },
  { file: 'sample.docx', q: '第', toc: true },
  { file: 'sample.odt', q: '第', toc: true },
  { file: 'sample.rtf', q: 'RTF' },
  { file: 'sample.umd', q: '第', toc: true },
];

/** ⋮ → 可视选项，改翻页动画（原生 select），再关掉抽屉 */
async function setFlipAnimation(page: Page, label: string): Promise<void> {
  await openOptionsMenuItem(page, '可视选项');
  await page.locator('select').filter({ has: page.locator('option', { hasText: '水平切换' }) }).selectOption({ label });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
}

async function flow(page: Page, f: Fmt, tag: string): Promise<void> {
  const errors = collectErrors(page);
  await skipClickTip(page);
  await page.addInitScript(FAKE_SPEECH);
  await importFile(page, f.file);
  await openFromShelf(page);
  const name = `${tag}-${f.file}`;
  await shot(page, `${name}-1-open`);

  // 翻页：键盘；多页书位置必须变化（页码/进度），PageUp 精确退回（VIEW-001 历史栈）
  const sig = async () => `${await statusChapter(page)} @${await progressPct(page)}`;
  const p0 = await progressPct(page);
  const s0 = await sig();
  if (f.multi) {
    await turn(page, 1);
    const s1 = await sig();
    expect(s1, '翻页后位置变化').not.toBe(s0);
    await turn(page, -1);
    expect(await sig(), 'PageUp 精确退回').toBe(s0);
    // 点击区：右侧点击 = 下一页（默认左右模式，右 = 下一页）
    const vp = page.viewportSize()!;
    await page.mouse.click(vp.width * 0.92, vp.height * 0.55);
    await page.waitForTimeout(700);
    expect(await sig(), '点右侧翻页').not.toBe(s0);
    await turn(page, -1);
  }

  // 目录跳转
  if (f.toc) {
    await tapCenter(page);
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await expect(page.getByTestId('toc-panel')).toBeVisible();
    const rows = page.getByTestId('toc-row');
    const n = await rows.count();
    expect(n).toBeGreaterThanOrEqual(2);
    const target = rows.nth(Math.min(n - 1, 3));
    const label = ((await target.textContent()) ?? '').replace('√', '').trim();
    await target.click();
    await expect(page.getByTestId('toc-panel')).toBeHidden();
    await page.waitForTimeout(700);
    if (f.multi) expect(await progressPct(page), `目录跳转到「${label}」`).toBeGreaterThan(p0);
    await shot(page, `${name}-2-toc`);
    // 跳转前的位置压入了回退栈（TOC-005/VIEW-017）：右下角「回退」按钮回到原处
    const floatBack = page.locator('button[aria-label="回退"][class*=linkBack]');
    await floatBack.click();
    await page.waitForTimeout(700);
    expect(await sig(), '回退到目录跳转前').toBe(s0);
    await expect(floatBack).toHaveCount(0);
  }

  // 选字 → 高亮 → 笔记
  await selectWord(page);
  await shot(page, `${name}-3-selection`);
  await page.getByTestId('tpl-style-highlight').click();
  await expect.poll(async () => (await idbAll(page, 'annotations')).filter((a) => a.kind === 'highlight' && !a.deletedAt).length).toBe(1);
  // 再选一处加笔记（点工具条「标注」，输入，保存）
  await turn(page, 1);
  await selectWord(page, f.multi ? 2 : 1); // 换一个词，免得点到刚高亮的那个（有的书前两章开头相同）
  await page.getByTestId('sel-note').click();
  await page.locator('textarea').first().fill('验收笔记');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(async () => (await idbAll(page, 'annotations')).filter((a) => a.note === '验收笔记').length).toBe(1);

  // 书内搜索
  await page.keyboard.press('Control+f');
  await page.getByTestId('search-input').fill(f.q);
  await page.getByTestId('search-go').click();
  await expect(page.getByTestId('search-result').first()).toBeVisible({ timeout: 15000 });
  await shot(page, `${name}-4-search`);
  const hits = page.getByTestId('search-result');
  const nHits = await hits.count();
  await hits.nth(Math.min(1, nHits - 1)).click();
  // 结果多于一条才有上下条导航栏
  if (nHits > 1) {
    await expect(page.getByTestId('search-nav')).toBeVisible();
    await page.waitForTimeout(500);
    await page.getByTestId('nav-close').click();
  } else await page.waitForTimeout(500);

  // 朗读（Web Speech 用假的：无头 chromium 没有语音引擎）
  await tapCenter(page);
  await page.getByRole('button', { name: '朗读', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '开始朗读' }).click();
  await expect(page.getByTestId('tts-panel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__tts.spoken.length)).toBeGreaterThan(0);
  await shot(page, `${name}-5-tts`);
  // 小样书几句就读完了，面板可能已自己关掉
  await page.getByTestId('tts-stop').click({ timeout: 3000 }).catch(() => undefined);
  await expect(page.getByTestId('tts-panel')).toBeHidden();

  // 改主题：日夜切换
  await tapCenter(page);
  if (!(await menuVisible(page))) await tapCenter(page);
  await page.getByRole('button', { name: '白天/晚上模式切换' }).click();
  await expect(page.locator('[data-night="true"]').first()).toBeAttached();
  await shot(page, `${name}-6-night`);
  await page.getByRole('button', { name: '白天/晚上模式切换' }).click();
  await expect(page.locator('[data-night="false"]').first()).toBeAttached();

  // 改字号：⋮ → 更多操作 → 字体大小调节 → ＋
  // 正文基准字号：引擎写在章节 iframe 的 <html> 上（书内 CSS 的 em/rem 都跟着它走）
  const fontPx = () =>
    page.evaluate(() => {
      const f = [...document.querySelectorAll('iframe[title^="section-"]')][0] as HTMLIFrameElement | undefined;
      const html = f?.contentDocument?.documentElement;
      return html ? parseFloat(getComputedStyle(html).fontSize) : 0;
    });
  const fBefore = await fontPx();
  await openOptionsMenuItem(page, '更多操作...');
  await page.getByText('字体大小调节', { exact: true }).click();
  const plus = page.locator('button', { hasText: '+' }).first();
  for (let i = 0; i < 6; i++) await plus.click();
  await page.waitForTimeout(900);
  await shot(page, `${name}-7-bigfont`);
  // 正文段落的实际字号变大（翻页数是否变化取决于当前在章内的位置，不作判据）
  expect(await fontPx(), '字号变大').toBeGreaterThan(fBefore);

  // 退出再进，进度恢复
  await page.keyboard.press('Escape'); // 先收起面板
  await page.waitForTimeout(300);
  await turn(page, 1);
  const before = await progressPct(page);
  await leaveAndReopen(page);
  const after = await progressPct(page);
  expect(Math.abs(after - before), `进度恢复 ${before} → ${after}`).toBeLessThan(0.5);
  await shot(page, `${name}-8-restored`);
  expect(errors, JSON.stringify(errors)).toEqual([]);
  void errorsOf;
}

for (const [tag, viewport] of Object.entries(SIZES)) {
  test.describe(`冒烟 ${tag}`, () => {
    test.use({ viewport });
    for (const f of TEXT_FORMATS) {
      test(`${f.file}：完整路径`, async ({ page }) => {
        test.setTimeout(180_000);
        await flow(page, f, tag);
      });
    }
  });
}
