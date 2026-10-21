// 背景：用户上传图片（kv + img:<键>）应同时出现在界面根与引擎正文区；内置纹理选择
export default async function bg({ page, ids, open, shot, log }) {
  await open(ids.txt);
  await page.mouse.click(206, 457);
  await page.waitForTimeout(400);
  const id = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 500;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 300, 500);
    grad.addColorStop(0, '#f6d365');
    grad.addColorStop(1, '#fda085');
    g.fillStyle = grad;
    g.fillRect(0, 0, 300, 500);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const { addUserImage, listUserImages } = await import('/src/reader/ui/themes/background.ts');
    const id = await addUserImage(blob, 'gradient.png');
    const m = await import('/src/reader/settings.ts');
    m.textSettings.set({ useBackgroundImage: true, backgroundImage: id });
    return { id, list: await listUserImages() };
  });
  log('user image id', JSON.stringify(id));
  await page.waitForTimeout(1200);
  const engineBg = await page.evaluate(() => {
    const iframe = document.querySelector('iframe');
    let el = iframe?.parentElement;
    const out = [];
    while (el && out.length < 4) {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') out.push(bg.slice(0, 40));
      el = el.parentElement;
    }
    return out;
  });
  log('engine/ancestor background-image', JSON.stringify(engineBg));
  await shot('g01-user-bg');
  // 背景图选择器
  await page.evaluate(async () => {
    const m = await import('/src/reader/ui/settings/BackgroundPicker.tsx');
    m.openBackgroundPicker();
  });
  await page.waitForTimeout(700);
  await shot('g02-picker');
}
