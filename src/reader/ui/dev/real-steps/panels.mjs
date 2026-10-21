// 面板与系统：字号面板、亮度/蓝光面板与遮罩、主题切换（日夜）、设置真的作用到引擎
const setv = (page, slice, patch) =>
  page.evaluate(async ([slice, patch]) => {
    const m = await import('/src/reader/settings.ts');
    m[slice].set(patch);
  }, [slice, patch]);
const getv = (page, slice, key) =>
  page.evaluate(async ([slice, key]) => {
    const m = await import('/src/reader/settings.ts');
    return m[slice].get()[key];
  }, [slice, key]);

export default async function panels({ page, ids, open, shot, log }) {
  await open(ids.txt);
  await page.mouse.click(206, 457); // 关点击区示意
  await page.waitForTimeout(400);
  const status = () => page.evaluate(() => (document.querySelector('[class*="status"]')?.textContent ?? '').replace(/\s+/g, ' '));
  const lineH = () => page.evaluate(() => { const f = document.querySelector('iframe'); const p = f?.contentDocument?.querySelector('p'); return p ? getComputedStyle(p).fontSize : null; });
  log('fontSize initial', await getv(page, 'textSettings', 'fontSize'), 'dom', await lineH());

  // 用 Enter（默认键位 = 选项菜单）打开 ⋮ 菜单 → 更多操作 → 字体大小调节
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.getByText('更多操作...').click();
  await page.waitForTimeout(300);
  await shot('p01-nav-menu');
  await page.getByText('字体大小调节').click();
  await page.waitForTimeout(400);
  await shot('p02-font-panel');
  const before = await status();
  // 点「+」两次（整数 +1），观察字号 + 引擎重排
  const plus = page.locator('[class*="floatPanel"] button', { hasText: '+' }).first();
  await plus.click();
  await plus.click();
  await page.waitForTimeout(900);
  log('fontSize after +2', await getv(page, 'textSettings', 'fontSize'), 'dom', await lineH(), 'status', before, '->', await status());
  await shot('p03-font-bigger');
  // 点正文：先关面板
  await page.mouse.click(206, 300);
  await page.waitForTimeout(300);
  log('panel closed', (await page.locator('[class*="floatPanel"]').count()) === 0);

  // 亮度面板
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.getByText('更多操作...').click();
  await page.waitForTimeout(300);
  await page.getByText('亮度调节').click();
  await page.waitForTimeout(400);
  await shot('p04-brightness-panel');
  await setv(page, 'screenSettings', { brightnessValue: 20, bluelightEnable: true, bluelightOpacity: 40 });
  await page.waitForTimeout(400);
  log('shade layers', await page.locator('[data-testid^="shade"]').count());
  await shot('p05-brightness-shade');
  await setv(page, 'screenSettings', { brightnessValue: -100, bluelightEnable: false });
  await page.mouse.click(206, 300);
  await page.waitForTimeout(300);

  // 日夜切换：设置 → 夜间主题
  const bg0 = await getv(page, 'textSettings', 'backgroundColor');
  await page.evaluate(async () => {
    const m = await import('/src/reader/ui/themes/theme-manager.ts');
    m.cycleThemes('x');
  });
  await page.waitForTimeout(1000);
  await shot('p06-night');
  log('night mode', await getv(page, 'themeSettings', 'nightMode'), 'font color', await getv(page, 'textSettings', 'fontColor'), 'bg', bg0, '->', await getv(page, 'textSettings', 'backgroundColor'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await shot('p07-night-menu');
}
