// 朗读：开始前的选项、面板、逐句高亮、自动翻页、暂停/继续/上下句、定时、选区朗读、设置对话框。
// Web Speech 用假实现（FAKE_SPEECH）：记录每句，auto=false 时停在当前句，由测试手动结束。
import { expect, test, type Page } from '@playwright/test';
import { decoList, f, FAKE_SPEECH, indexOfText, openDev, pageErrors, select, shot } from './features.helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(FAKE_SPEECH);
});
test.afterEach(async ({ page }) => {
  expect(pageErrors(page)).toEqual([]);
});

const spoken = (page: Page) => page.evaluate(() => (window as any).__tts.spoken as { text: string; rate: number; pitch: number; voice?: string }[]);
const manual = (page: Page) => page.evaluate(() => ((window as any).__tts.auto = false));
const status = (page: Page) => page.getByTestId('tts-panel').getAttribute('data-status');
const toggle = (page: Page) => f(page, "f.session.bus.emit('tts.toggle', {})");

async function startViaDialog(page: Page) {
  await toggle(page);
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('TTS朗读设置')).toBeVisible();
  await dlg.getByRole('button', { name: '开始朗读' }).click();
  await expect(page.getByTestId('tts-panel')).toBeVisible();
}

test('朗读：先弹选项（划分方式/定时/不再询问），开始后出面板并高亮当前句', async ({ page }) => {
  await openDev(page);
  await manual(page);
  await toggle(page);
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('选择内容划分方式');
  await expect(dlg).toContainText('自动停止朗读设置:');
  await shot(page, 'tts-start-dialog');
  await dlg.getByRole('button', { name: '开始朗读' }).click();
  const panel = page.getByTestId('tts-panel');
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  const first = (await spoken(page))[0];
  expect(first.text).toBe('第一章 起点');
  // 当前句高亮（装饰层 tts）
  await expect.poll(async () => (await decoList(page, 'tts')).length).toBe(1);
  const d = (await decoList(page, 'tts'))[0];
  expect(d.range.end).toBeGreaterThan(d.range.start);
  expect(d.style).toBe('tts');
  await shot(page, 'tts-panel');
});

test('逐句推进 + 自动翻页：窗口压矮，读几十句后页码前进，高亮始终在屏内', async ({ page }) => {
  await openDev(page, 'h=300');
  await startViaDialog(page);
  await expect.poll(async () => (await spoken(page)).length, { timeout: 15000 }).toBeGreaterThan(12);
  expect(await f<number>(page, 'f.controller.getLocation().page')).toBeGreaterThan(1);
  // 正在读的那句在屏内（自动翻页跟上了）。读得快，每次取一下当前句
  for (let k = 0; k < 5; k++) {
    const vis = await f<boolean>(page, '(() => { const p = f.ttsService.getRunner().position(); return p ? f.controller.isRangeVisible({ section: p.section, start: p.offset, end: p.offset + 1 }) : true; })()');
    expect(vis).toBe(true);
    await page.waitForTimeout(60);
  }
});

test('暂停/继续/上一句/下一句/停止', async ({ page }) => {
  await openDev(page);
  await manual(page);
  await startViaDialog(page);
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  const s0 = (await spoken(page))[0].text;

  await page.getByTestId('tts-next').click();
  await expect.poll(async () => (await spoken(page)).length).toBe(2);
  const s1 = (await spoken(page))[1].text;
  expect(s1).not.toBe(s0);

  await page.getByTestId('tts-prev').click();
  await expect.poll(async () => (await spoken(page)).length).toBe(3);
  expect((await spoken(page))[2].text).toBe(s0);

  await page.getByTestId('tts-play').click(); // 暂停
  await expect.poll(() => status(page)).toBe('paused');
  const n = (await spoken(page)).length;
  await page.getByTestId('tts-play').click(); // 继续：重读当前句
  await expect.poll(() => status(page)).toBe('playing');
  await expect.poll(async () => (await spoken(page)).length).toBe(n + 1);
  expect((await spoken(page))[n].text).toBe(s0);

  await page.getByTestId('tts-stop').click();
  await expect(page.getByTestId('tts-panel')).toBeHidden();
  await expect.poll(async () => (await decoList(page, 'tts')).length).toBe(0);
});

test('语速滑块：松手后写入设置并立即按新语速重读', async ({ page }) => {
  await openDev(page);
  await manual(page);
  await startViaDialog(page);
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  expect((await spoken(page))[0].rate).toBe(1);
  const slider = page.getByTestId('tts-panel').locator('input[type=range]').nth(2); // 音量/音调/语速
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  // 滑块值 12 → 语速 12 → 1.2×
  await expect.poll(() => f<number>(page, 'f.ttsSettings.get().speed')).toBe(12);
  await expect.poll(async () => (await spoken(page)).at(-1)!.rate).toBeCloseTo(1.2, 5);
  // 出现「重置」，点它回到 1×
  await page.getByTestId('tts-reset').click();
  await expect.poll(() => f<number>(page, 'f.ttsSettings.get().speed')).toBe(10);
});

test('定时停止：倒计时显示在面板上，点它可以取消', async ({ page }) => {
  await openDev(page);
  await manual(page);
  await f(page, 'f.ttsSettings.set({ stopEnable: true, stopTime: 5 })');
  await startViaDialog(page);
  const cd = page.getByTestId('tts-countdown');
  await expect(cd).toBeVisible();
  await expect(cd).toHaveText(/0[45]:\d\d/);
  await cd.click();
  await page.getByRole('menuitem', { name: '取消定时' }).click();
  await expect(cd).toBeHidden();
});

test('选中文字 →「更多」→ 朗读：只读选区一次，读完面板消失，不翻页', async ({ page }) => {
  await openDev(page);
  const i = await indexOfText(page, 0, '天行健');
  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-more').click();
  await page.getByRole('menuitem', { name: '朗读', exact: true }).click();
  await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toEqual(['天行健']);
  await expect(page.getByTestId('tts-panel')).toBeHidden();
});

test('tts.toggle 有选区时跳过选项对话框直接读选区', async ({ page }) => {
  await openDev(page);
  const i = await indexOfText(page, 0, '地势坤');
  await select(page, 0, i, i + 3);
  await toggle(page);
  await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toEqual(['地势坤']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('「不再询问」：之后 tts.toggle 直接开始；朗读中再 toggle = 暂停', async ({ page }) => {
  await openDev(page);
  await manual(page);
  await toggle(page);
  const dlg = page.getByRole('dialog');
  await dlg.getByText('不再询问').click();
  await dlg.getByRole('button', { name: '开始朗读' }).click();
  await expect(page.getByTestId('tts-panel')).toBeVisible();
  await page.getByTestId('tts-stop').click();
  await toggle(page);
  await expect(page.getByTestId('tts-panel')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await toggle(page);
  await expect.poll(() => status(page)).toBe('paused');
});

test('tts.stop 命令（reader/ui 打开设置前会发）停掉朗读', async ({ page }) => {
  await openDev(page);
  await manual(page);
  await startViaDialog(page);
  await f(page, "f.session.bus.emit('tts.stop', {})");
  await expect(page.getByTestId('tts-panel')).toBeHidden();
});

test('更多选项/声音/过滤表对话框：设置即时写入', async ({ page }) => {
  await openDev(page);
  await manual(page);
  await startViaDialog(page);

  await page.getByTestId('tts-more').click();
  let dlg = page.getByRole('dialog').filter({ hasText: '朗读更多选项' });
  await expect(dlg).toBeVisible();
  await dlg.getByText('朗读前显示选项对话框').click();
  expect(await f<boolean>(page, 'f.ttsSettings.get().askForTts')).toBe(false);
  await shot(page, 'tts-more');
  await dlg.getByRole('button', { name: '确定' }).click();

  // 声音：列出假声音，选中后写入 voiceURI
  await page.getByTestId('tts-settings').click();
  dlg = page.getByRole('dialog').filter({ hasText: '试听' });
  await expect(dlg.locator('select').nth(1)).toContainText('Fake English');
  await dlg.locator('select').nth(1).selectOption({ label: 'Fake English (en-US)' });
  expect(await f<string>(page, 'f.ttsSettings.get().voiceURI')).toBe('en-1');
  await dlg.getByText('试听').click();
  await expect.poll(async () => (await spoken(page)).some((s) => s.text.includes('voice preview') && s.voice === 'en-1')).toBe(true);
  await dlg.getByRole('button', { name: '确定' }).click();

  // 过滤表：默认 4 条，添加一条
  await page.getByTestId('tts-more').click();
  await page.getByRole('dialog').filter({ hasText: '朗读更多选项' }).getByText('朗读字符过滤', { exact: true }).click();
  const fl = page.getByTestId('filter-list');
  await expect(fl.getByTestId('filter-from')).toHaveCount(4);
  await page.getByRole('button', { name: '添加规则' }).click();
  await expect(fl.getByTestId('filter-from')).toHaveCount(5);
  await fl.getByTestId('filter-from').nth(4).fill('苔痕');
  await fl.getByTestId('filter-to').nth(4).fill('青苔');
  expect(await f<any[]>(page, 'f.ttsSettings.get().filters')).toHaveLength(5);
  await shot(page, 'tts-filter');
});
