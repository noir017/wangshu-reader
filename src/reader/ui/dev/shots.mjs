// 开发用截图脚本（在容器里跑）：node src/reader/ui/dev/shots.mjs <baseURL> <输出目录>
// 打开 ?mrdev=1 的阅读页（假书 + 假引擎），按手机竖屏 412×915 截各个界面。
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5237';
const out = process.argv[3] ?? '/work/wangshu-reader/out/ui-shots';
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/usr/bin/chromium' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'zh-CN', deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

await page.goto(`${base}/src/reader/ui/dev/dev.html?mrdev=1#/read/mock-reflow`);
await page.waitForSelector('[data-mock-page]', { timeout: 20000 });
await page.waitForTimeout(500);
await shot('01-reading');
// 首次进入的点击区示意
const tip = page.locator('[role="dialog"], [data-clicktip]');
if (await tip.count()) await shot('01b-clicktip');
await page.mouse.click(206, 700);
await page.waitForTimeout(300);
await shot('02-after-first-click');
await page.mouse.click(206, 450);
await page.waitForTimeout(400);
await shot('03-menu');

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
