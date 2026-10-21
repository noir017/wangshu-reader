// 自动滚屏：开始对话框 → 开始 → 点击暂停/继续 → 速度调节 → 停止；速读 RSVP
const state = (page) =>
  page.evaluate(async () => {
    const { useReaderUi } = await import('/src/reader/ui/store.ts');
    const s = useReaderUi.getState();
    return { running: s.autoRunning, paused: s.autoPaused, speedRead: s.speedRead, controllerAuto: s.session?.controller.isAutoScrolling() };
  });
const status = (page) => page.evaluate(() => (document.querySelector('[class*="status"]')?.textContent ?? '').replace(/\s+/g, ' '));

export default async function auto({ page, ids, open, shot, log }) {
  await open(ids.txt);
  await page.mouse.click(206, 457);
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.getByText('更多操作...').click();
  await page.waitForTimeout(300);
  await page.getByText('自动滚屏').click();
  await page.waitForTimeout(500);
  await shot('a01-ask');
  await page.getByRole('button', { name: '开始' }).click();
  await page.waitForTimeout(1500);
  log('after start', JSON.stringify(await state(page)), await status(page));
  // 单击 = 暂停
  await page.mouse.click(206, 457);
  await page.waitForTimeout(500);
  log('after tap (pause)', JSON.stringify(await state(page)));
  await page.mouse.click(206, 457);
  await page.waitForTimeout(800);
  log('after tap (resume)', JSON.stringify(await state(page)));
  await shot('a02-running');
  // 横向拖动 > 80px = 停止
  await page.mouse.move(100, 500);
  await page.mouse.down();
  await page.mouse.move(250, 505, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  log('after horizontal drag', JSON.stringify(await state(page)));

  // 速读
  await page.evaluate(async () => {
    const m = await import('/src/reader/settings.ts');
    m.autoScrollSettings.set({ autoScrollMode: 5 });
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.getByText('更多操作...').click();
  await page.waitForTimeout(300);
  await page.getByText('自动滚屏').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '开始' }).click();
  await page.waitForTimeout(1500);
  log('speed read state', JSON.stringify(await state(page)));
  await shot('a03-speedread');
  await page.locator('[class*="speedWord"] > div').last().click();
  await page.waitForTimeout(1500);
  await shot('a04-speedread-playing');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  log('after close', JSON.stringify(await state(page)), await status(page));
}
