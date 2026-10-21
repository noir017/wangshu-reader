// 逐个打开设置对话框并截图（控制/其它选项分屏、配色方案网格、状态栏设置、点击区示意…）
const scrollAll = (page, by) =>
  page.evaluate((by) => {
    const els = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 40 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) && e.clientWidth > 200);
    els.forEach((e) => (e.scrollTop += by));
  }, by);

export default async function dialogs({ page, ids, open, shot, log }) {
  await open(ids.txt);
  await page.mouse.click(206, 457);
  await page.waitForTimeout(400);
  const settings = (kind) =>
    page.evaluate(async (kind) => {
      const { openSettings } = await import('/src/reader/ui/settings/open.tsx');
      openSettings(kind);
    }, kind);

  await settings('control');
  await page.waitForTimeout(500);
  await shot('d01-control-0');
  for (let i = 1; i <= 5; i++) {
    await scrollAll(page, 650);
    await page.waitForTimeout(200);
    await shot(`d01-control-${i}`);
  }
  await settings('misc');
  await page.waitForTimeout(500);
  await shot('d02-misc-0');
  for (let i = 1; i <= 6; i++) {
    await scrollAll(page, 650);
    await page.waitForTimeout(200);
    await shot(`d02-misc-${i}`);
  }
  // 配色方案
  await page.evaluate(async () => {
    const m = await import('/src/reader/ui/settings/ThemeDialogs.tsx');
    m.openThemeLoader();
  });
  await page.waitForTimeout(600);
  await shot('d03-theme-0');
  await scrollAll(page, 500);
  await page.waitForTimeout(200);
  await shot('d03-theme-1');
  await page.evaluate(async () => {
    const m = await import('/src/reader/ui/settings/ThemeDialogs.tsx');
    m.openAutoThemeDialog();
  });
  await page.waitForTimeout(400);
  await shot('d04-auto-theme');
  await page.evaluate(async () => {
    const m = await import('/src/reader/ui/settings/MiscOptions.tsx');
    m.openStatusSettings();
  });
  await page.waitForTimeout(400);
  await shot('d05-status-settings');
}
