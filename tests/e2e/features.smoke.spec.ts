import { expect, test } from '@playwright/test';
import { f, openDev, pageErrors, shot } from './features.helpers';

test('开发页能起：假引擎出 relocate、章节文本可取', async ({ page }) => {
  await openDev(page);
  const loc = await f<any>(page, 'f.controller.getLocation()');
  expect(loc.section).toBe(0);
  expect(loc.visible.end).toBeGreaterThan(loc.visible.start);
  expect(await f<number>(page, 'f.controller.getSectionText(0).then(t => t.length)')).toBeGreaterThan(200);
  await shot(page, 'smoke');
  expect(pageErrors(page)).toEqual([]);
});
