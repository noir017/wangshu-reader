import { test } from '@playwright/test';
import fs from 'node:fs';
test('raster probe', async ({ page }) => {
  await page.goto('/src/reader/engine/dev/harness.html?flip=1&speed=0&img=4');
  await page.waitForFunction(() => (window as any).__h?.ready);
  await page.screenshot({ path: 'test-results/probe-live.png' });
  const r = await page.evaluate(() => (window as any).__h.rasterDataUrl(0));
  console.log('raster ms', r.ms, r.w, r.h);
  fs.writeFileSync('test-results/probe-raster.png', Buffer.from(r.url.split(',')[1], 'base64'));
});
