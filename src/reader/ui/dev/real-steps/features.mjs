// 与 features 的对接（不换占位）：工具栏按钮/动作发 bus 命令，features 的面板能打开
export default async function features({ page, ids, open, shot, log, errors }) {
  await open(ids.epub);
  await page.mouse.click(206, 457);
  await page.waitForTimeout(500);
  await page.mouse.click(206, 457);
  await page.waitForTimeout(500);
  // 默认工具栏：0 方向 1 日夜 2 朗读 3 自动滚屏 4 目录 17 自定义
  const tools = page.locator('[class*="toolBtn"]');
  log('tool buttons', await tools.count());
  await tools.nth(4).click(); // 目录
  await page.waitForTimeout(900);
  await shot('x01-toc');
  log('dialogs', await page.locator('[role="dialog"], [class*="toc"]').count());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // 动作 4：Ctrl+F 搜索
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(800);
  await shot('x02-search');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // 长按空白：选择（features 的 selection.start）
  await page.mouse.move(150, 300);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await shot('x03-longpress');
  log('errors so far', JSON.stringify(errors.slice(0, 6)));
}
