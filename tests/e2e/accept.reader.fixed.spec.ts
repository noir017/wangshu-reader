// 阶段 4 整站冒烟（固定版式）：PDF、加密 PDF（密码框 + 保存密码）、CBZ、右到左 CBZ。手机与桌面两种尺寸。
import { expect, test, type Page } from '@playwright/test';
import {
  FAKE_SPEECH,
  collectErrors,
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

/** 状态栏中间的「n/N」页码 */
const pageNo = async (page: Page) => parseInt((await statusChapter(page)).split('/')[0], 10);

/**
 * 反复做某个翻页动作直到页码变成 want：桌面横屏下 PDF/漫画按宽度适配，一页比屏幕高，
 * 翻页键/点击区先在页内往下滚，滚到底才换页（原版同样如此）
 */
async function stepUntil(page: Page, act: () => Promise<unknown>, want: number, what: string): Promise<void> {
  for (let i = 0; i < 8 && (await pageNo(page)) !== want; i++) await act();
  expect(await pageNo(page), what).toBe(want);
}

/** 用鼠标在页面上拖选一段文字（固定版式：在文字上拖 = 选择） */
async function dragSelect(page: Page, y: number): Promise<void> {
  const vp = page.viewportSize()!;
  const x0 = vp.width * 0.3;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x0 + 40, y, { steps: 5 });
  await page.mouse.move(x0 + 140, y, { steps: 8 });
  await page.mouse.up();
}

for (const [tag, viewport] of Object.entries(SIZES)) {
  test.describe(`固定版式 ${tag}`, () => {
    test.use({ viewport });

    test('PDF：翻页、目录、选字高亮、搜索、朗读、夜间、缩略图、退出再进', async ({ page }) => {
      test.setTimeout(150_000);
      const errors = collectErrors(page);
      await skipClickTip(page);
      await page.addInitScript(FAKE_SPEECH);
      await importFile(page, 'tracemonkey.pdf');
      await openFromShelf(page);
      await shot(page, `${tag}-pdf-1-open`);
      expect(await pageNo(page)).toBe(1);

      // 翻页：键盘、点击区
      await stepUntil(page, () => turn(page, 1), 2, 'PageDown');
      await stepUntil(page, () => turn(page, -1), 1, 'PageUp');
      const vp = page.viewportSize()!;
      // 固定版式单击要等一个双击窗口
      await stepUntil(page, () => page.mouse.click(vp.width * 0.93, vp.height * 0.55).then(() => page.waitForTimeout(900)), 2, '点右侧');

      // 目录：tracemonkey 没有书签大纲，面板应当是空的而不是报错
      await tapCenter(page);
      await page.getByRole('button', { name: '目录', exact: true }).click();
      await expect(page.getByTestId('toc-panel')).toBeVisible();
      await shot(page, `${tag}-pdf-2-toc`);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('toc-panel')).toBeHidden();

      // 选字 → 高亮（在页面文字上拖选）
      await page.waitForTimeout(400);
      await turn(page, 1); // 第 3 页有大段文字
      let picked = false;
      for (const y of [260, 300, 340, 380, 420, 460]) {
        await dragSelect(page, y * (vp.height / 915) + (vp.height > 900 ? 0 : 60));
        if (await page.getByTestId('selection-toolbar').isVisible()) {
          picked = true;
          break;
        }
      }
      expect(picked, 'PDF 拖选后出现选择条').toBe(true);
      await shot(page, `${tag}-pdf-3-selection`);
      await page.getByTestId('tpl-style-highlight').click();
      await expect.poll(async () => (await idbAll(page, 'annotations')).filter((a) => a.kind === 'highlight' && !a.deletedAt).length).toBe(1);

      // 搜索
      await page.keyboard.press('Control+f');
      await page.getByTestId('search-input').fill('trace');
      await page.getByTestId('search-go').click();
      await expect(page.getByTestId('search-result').first()).toBeVisible({ timeout: 30000 });
      await shot(page, `${tag}-pdf-4-search`);
      await page.getByTestId('search-result').nth(3).click();
      await expect(page.getByTestId('search-nav')).toBeVisible();
      await page.getByTestId('nav-close').click();

      // 朗读：整页文字交给假的 Web Speech
      await tapCenter(page);
      await page.getByRole('button', { name: '朗读', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '开始朗读' }).click();
      await expect(page.getByTestId('tts-panel')).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as any).__tts.spoken.length), { timeout: 15000 }).toBeGreaterThan(0);
      await page.getByTestId('tts-stop').click();

      // 夜间（PDF = 反色渲染）
      await tapCenter(page);
      if (!(await menuVisible(page))) await tapCenter(page);
      await page.getByRole('button', { name: '白天/晚上模式切换' }).click();
      await page.waitForTimeout(800);
      await shot(page, `${tag}-pdf-5-night`);
      await page.getByRole('button', { name: '白天/晚上模式切换' }).click();

      // PDF 选项：缩略图条
      await openOptionsMenuItem(page, '可视选项');
      await expect(page.getByText('PDF 选项')).toBeVisible();
      await page.getByText('在底部显示页面缩略图').click();
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await page.waitForTimeout(600);
      await shot(page, `${tag}-pdf-6-thumbs`);

      // 退出再进：页码恢复（注意：没有面板时 Esc = 返回键，会直接退出阅读页）
      await turn(page, 1);
      const before = await pageNo(page);
      await leaveAndReopen(page);
      expect(await pageNo(page)).toBe(before);
      expect(errors, JSON.stringify(errors)).toEqual([]);
    });

    test('PDF 文本重排（PDF-006）：底栏「文本重排」→ 当前页文字按段落重排，可选字/搜索；再按切回页面视图，页码不变', async ({ page }) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await skipClickTip(page);
      await importFile(page, 'tracemonkey.pdf');
      await openFromShelf(page);
      await stepUntil(page, () => turn(page, 1), 2, 'PageDown');
      await stepUntil(page, () => turn(page, 1), 3, 'PageDown');
      await tapCenter(page);
      if (!(await menuVisible(page))) await tapCenter(page);
      const btn = page.getByRole('button', { name: '文本重排', exact: true });
      await expect(btn).toHaveAttribute('aria-pressed', 'false');
      await btn.click();
      // 重排后是文本引擎：章节 iframe 出现，状态栏是「3/14」这一页
      await expect.poll(() => page.locator('iframe[title^="section-"]').count(), { timeout: 20000 }).toBeGreaterThan(0);
      await expect.poll(() => statusChapter(page), { timeout: 10000 }).toContain('3/14');
      const body = await page.locator('iframe[title="section-2"]').contentFrame().locator('body').innerText();
      expect(body).toMatch(/trace/i);
      // 排版断行接回成段：至少有一段远长于 PDF 的一行
      expect(Math.max(...body.split('\n').map((l) => l.length))).toBeGreaterThan(200);
      await shot(page, `${tag}-pdf-reflow`);
      // 重排模式下选字可用
      await selectWord(page);
      await tapCenter(page); // 有选区时的点击只用来取消选择（没有面板时按 Esc 会退出阅读页）
      // 切回页面视图：页码还是 3
      for (let i = 0; i < 3 && !(await menuVisible(page)); i++) await tapCenter(page);
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      await btn.click();
      await expect.poll(() => page.evaluate(() => !!document.querySelector('canvas')), { timeout: 20000 }).toBe(true);
      await expect.poll(() => pageNo(page), { timeout: 10000 }).toBe(3);
      expect(errors, JSON.stringify(errors)).toEqual([]);
    });

    test('加密 PDF：密码框（取消回书库、错误密码提示、正确密码 + 保存密码）', async ({ page }) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await skipClickTip(page);
      await importFile(page, 'encrypted-abc.pdf');
      await openFromShelf(page).catch(() => undefined);
      const dlg = page.getByRole('dialog').filter({ hasText: '需要密码' });
      await expect(dlg).toBeVisible({ timeout: 20000 });
      await shot(page, `${tag}-pdf-pw-1`);
      // 错误密码
      await dlg.getByPlaceholder('请输入密码').fill('wrong');
      await dlg.getByRole('button', { name: '确定' }).click();
      const dlg2 = page.getByRole('dialog').filter({ hasText: '密码错误' });
      await expect(dlg2).toBeVisible({ timeout: 20000 });
      await shot(page, `${tag}-pdf-pw-2-wrong`);
      // 正确密码 abc，勾选保存
      await dlg2.getByPlaceholder('请输入密码').fill('abc');
      await dlg2.getByText('保存密码').click();
      await dlg2.getByRole('button', { name: '确定' }).click();
      await expect.poll(() => page.evaluate(() => !!document.querySelector('canvas')), { timeout: 20000 }).toBe(true);
      await page.waitForTimeout(600);
      await shot(page, `${tag}-pdf-pw-3-open`);
      expect(await pageNo(page)).toBe(1);
      // 退出再进：保存过密码，不再弹框
      await leaveAndReopen(page);
      await expect(page.getByRole('dialog').filter({ hasText: '需要密码' })).toHaveCount(0);
      expect(await pageNo(page)).toBe(1);
      expect(errors, JSON.stringify(errors)).toEqual([]);
    });

    test('加密 PDF：取消密码框回书库', async ({ page }) => {
      test.setTimeout(60_000);
      collectErrors(page);
      await skipClickTip(page);
      await importFile(page, 'encrypted-abc.pdf');
      await openFromShelf(page).catch(() => undefined);
      const dlg = page.getByRole('dialog').filter({ hasText: '需要密码' });
      await expect(dlg).toBeVisible({ timeout: 20000 });
      await dlg.getByRole('button', { name: '取消' }).click();
      await expect.poll(() => page.url()).not.toContain('/read/');
    });

    test('CBZ：翻页、缩略图、夜间、退出再进；右到左 CBZ 点击区镜像', async ({ page }) => {
      test.setTimeout(120_000);
      const errors = collectErrors(page);
      await skipClickTip(page);
      await importFile(page, 'sample.cbz');
      await openFromShelf(page);
      await shot(page, `${tag}-cbz-1-open`);
      const total = parseInt((await statusChapter(page)).split('/')[1], 10);
      expect(total).toBeGreaterThanOrEqual(5);
      expect(await pageNo(page)).toBe(1);
      await stepUntil(page, () => turn(page, 1), 2, 'PageDown');
      await stepUntil(page, () => turn(page, 1), 3, 'PageDown');
      await stepUntil(page, () => turn(page, -1), 2, 'PageUp');
      const vp = page.viewportSize()!;
      // 左到右：点右侧 = 下一页
      await stepUntil(page, () => page.mouse.click(vp.width * 0.93, vp.height * 0.55).then(() => page.waitForTimeout(900)), 3, '点右侧');
      await openOptionsMenuItem(page, '可视选项');
      await shot(page, `${tag}-cbz-2-options`);
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await turn(page, 1);
      const before = await pageNo(page);
      await leaveAndReopen(page);
      expect(await pageNo(page)).toBe(before);
      expect(errors, JSON.stringify(errors)).toEqual([]);
    });

    test('右到左漫画（ComicInfo Manga=YesAndRightToLeft）：点左 = 下一页，方向键 ← = 下一页', async ({ page }) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await skipClickTip(page);
      await importFile(page, 'sample-manga-rtl.cbz');
      await openFromShelf(page);
      const vp = page.viewportSize()!;
      expect(await pageNo(page)).toBe(1);
      const click = (k: number) => page.mouse.click(vp.width * k, vp.height * 0.55).then(() => page.waitForTimeout(900));
      const key = (k: string) => page.keyboard.press(k).then(() => page.waitForTimeout(700));
      await stepUntil(page, () => click(0.07), 2, '点左边 = 下一页');
      await stepUntil(page, () => click(0.93), 1, '点右边 = 上一页');
      await stepUntil(page, () => key('ArrowLeft'), 2, '← = 下一页');
      await stepUntil(page, () => key('ArrowRight'), 1, '→ = 上一页');
      await shot(page, `${tag}-cbz-rtl`);
      expect(errors, JSON.stringify(errors)).toEqual([]);
    });
  });
}
void progressPct;
