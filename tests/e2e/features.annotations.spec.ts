// 标注：选择条、高亮（模板/对话框）、点已有标注改样式/删除、笔记、书签、偏移失效后的重定位、选择手柄。
import { expect, test } from '@playwright/test';
import { clickRange, decoList, f, idbAnnotations, indexOfText, openDev, pageErrors, select, shot } from './features.helpers';

/** features 交给引擎画的标注装饰（按样式筛） */
const decos = async (page: import('@playwright/test').Page, style?: string) => (await decoList(page, 'annotations')).filter((d) => !style || d.style === style);

test.afterEach(async ({ page }) => {
  expect(pageErrors(page)).toEqual([]);
});

test('选中文字弹出工具条：前 4 个常驻按钮 + 更多，颜色模板两行', async ({ page }) => {
  await openDev(page);
  const i = await indexOfText(page, 0, '天行健');
  await select(page, 0, i, i + 3);
  const tb = page.getByTestId('selection-toolbar');
  await expect(tb).toBeVisible();
  await expect(tb.locator('[data-testid^="sel-"]')).toHaveText(['拷贝', '高亮', '标注', '词典', '']);
  await expect(page.getByTestId('color-template').locator('button')).toHaveCount(10);
  await shot(page, 'toolbar');
  // 取消选择 → 工具条消失
  await f(page, 'f.controller.setSelection(null)');
  await expect(tb).toBeHidden();
});

test('颜色模板一键高亮：存库（含 prefix/suffix）、画出装饰、刷新后仍在', async ({ page }) => {
  await openDev(page);
  const i = await indexOfText(page, 0, '天行健');
  await select(page, 0, i, i + 3);
  await page.getByTestId('tpl-style-underline').click();
  await expect.poll(async () => (await idbAnnotations(page)).length).toBe(1);
  const [a] = await idbAnnotations(page);
  expect(a).toMatchObject({ kind: 'highlight', style: 'underline', text: '天行健', range: { section: 0, start: i, end: i + 3 }, chapterTitle: '第一章 起点' });
  expect(a.prefix.length).toBeGreaterThan(5);
  expect(a.suffix.startsWith('，君子以自强不息')).toBe(true);
  await expect.poll(async () => (await decos(page, 'underline')).map((d) => d.range)).toEqual([{ section: 0, start: i, end: i + 3 }]);
  // 选区已清掉
  await expect(page.getByTestId('selection-toolbar')).toBeHidden();

  await page.reload();
  await page.waitForFunction(() => (window as any).__f?.ready === true);
  await expect.poll(async () => (await decos(page, 'underline')).length).toBe(1);
});

test('高亮对话框：选样式后确定；已有同范围标注时「取消」变「删除」', async ({ page }) => {
  await openDev(page);
  const i = await indexOfText(page, 0, '地势坤');
  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-highlight').click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('使用最后标注类型来高亮文字')).toBeVisible();
  await expect(dlg.getByText('高亮显示本书所有的“地势坤”')).toBeVisible();
  await shot(page, 'highlight-dialog');
  await dlg.getByRole('button', { name: '确定' }).click();
  await expect.poll(async () => (await idbAnnotations(page)).length).toBe(1);

  // 再选同一范围，点高亮：编辑态，按钮是「删除」
  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-highlight').click();
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect.poll(async () => (await idbAnnotations(page)).filter((x) => !x.deletedAt).length).toBe(0);
  await expect.poll(async () => (await decos(page)).length).toBe(0);
});

test('点已有高亮：弹气泡，改样式、再删除', async ({ page }) => {
  await openDev(page);
  const i = await indexOfText(page, 0, '天行健');
  await select(page, 0, i, i + 3);
  await page.getByTestId('tpl-style-highlight').click();
  await expect.poll(async () => (await decos(page, 'highlight')).length).toBe(1);
  await clickRange(page, 0, i, i + 3);
  const pop = page.getByTestId('annotation-popup');
  await expect(pop).toBeVisible();
  await shot(page, 'annotation-popup');
  await pop.getByTestId('style-strikethrough').click();
  await expect.poll(async () => (await idbAnnotations(page))[0]?.style).toBe('strikethrough');
  await expect.poll(async () => (await decos(page, 'strikethrough')).length).toBe(1);
  await pop.getByRole('button', { name: '删除', exact: true }).click();
  await expect.poll(async () => (await idbAnnotations(page)).filter((x) => !x.deletedAt).length).toBe(0);
  await expect(pop).toBeHidden();
});

test('标注（笔记）：写笔记保存，正文出现笔标记，点开气泡看到笔记文字', async ({ page }) => {
  await openDev(page);
  const i = await indexOfText(page, 0, '地势坤');
  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-note').click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('textarea').fill('这是我的批注');
  await dlg.getByRole('button', { name: '保存' }).click();
  await expect.poll(async () => (await idbAnnotations(page))[0]?.note).toBe('这是我的批注');
  await expect.poll(async () => (await decos(page, 'note-mark')).length).toBe(1);
  await clickRange(page, 0, i, i + 3);
  await expect(page.getByTestId('annotation-note')).toHaveText('这是我的批注');
});

test('书签：切换添加/删除，角标随之变化，默认名按「(进度%) 页首文字...」', async ({ page }) => {
  await openDev(page);
  const corner = page.getByTestId('bookmark-corner');
  await expect(corner).toHaveAttribute('data-marked', 'false');
  await f(page, "f.session.bus.emit('bookmark.add', {})");
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('添加书签')).toBeVisible();
  const name = await dlg.locator('input[type="text"], input:not([type])').first().inputValue();
  expect(name).toMatch(/^\(\d+\.\d%\) 第一章 起点/);
  await dlg.getByRole('button', { name: '确定' }).click();
  await expect.poll(async () => (await idbAnnotations(page)).filter((x) => x.kind === 'bookmark' && !x.deletedAt).length).toBe(1);
  await expect(corner).toHaveAttribute('data-marked', 'true');
  // 已有书签时角标是旗子：点它弹「编辑 / 删除」
  await corner.click();
  await page.getByRole('menuitem', { name: '编辑' }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByText('编辑书签')).toBeVisible();
  await edit.locator('input').first().fill('我的书签');
  await edit.getByRole('button', { name: '确定' }).click();
  await expect.poll(async () => (await idbAnnotations(page)).find((x) => x.kind === 'bookmark')?.title).toBe('我的书签');
  await corner.click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  await expect.poll(async () => (await idbAnnotations(page)).filter((x) => x.kind === 'bookmark' && !x.deletedAt).length).toBe(0);
  await expect(corner).toHaveAttribute('data-marked', 'false');
});

test('偏移失效（文本前面多了内容）：用 prefix+text+suffix 重定位后装饰仍落在原文上', async ({ page }) => {
  await openDev(page);
  const i = await indexOfText(page, 0, '天行健');
  await select(page, 0, i, i + 3);
  await page.getByTestId('tpl-style-highlight').click();
  await expect.poll(async () => (await idbAnnotations(page)).length).toBe(1);
  // 把库里的偏移改歪 13 个字符，模拟书内容变了
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('moonreader');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('annotations', 'readwrite');
          const st = tx.objectStore('annotations');
          st.getAll().onsuccess = (e: any) => {
            for (const a of e.target.result) st.put({ ...a, range: { ...a.range, start: a.range.start + 13, end: a.range.end + 13 } });
          };
          tx.oncomplete = () => resolve();
        };
      }),
  );
  await page.reload();
  await page.waitForFunction(() => (window as any).__f?.ready === true);
  // 交给引擎的装饰区间已经被重定位回正确位置（而不是库里被改歪的偏移）
  await expect.poll(async () => (await decos(page, 'highlight')).map((d) => d.range)).toEqual([{ section: 0, start: i, end: i + 3 }]);
});

test('选择手柄：拖终点手柄把选区向后扩', async ({ page }) => {
  await openDev(page, 'handles=on');
  const i = await indexOfText(page, 0, '天行健');
  await select(page, 0, i, i + 3);
  const h = page.getByTestId('handle-end');
  await expect(h).toBeVisible();
  await expect(page.getByTestId('handle-start')).toBeVisible();
  const before = await f<any>(page, 'f.controller.getSelection().range');
  const hb = (await h.boundingBox())!;
  // 手指在手柄中心，目标字在其上方约 18px：往右拖 70px
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 8);
  await page.mouse.down();
  await expect(page.getByTestId('selection-toolbar')).toBeHidden();
  await page.mouse.move(hb.x + hb.width / 2 + 70, hb.y + 8, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => f<number>(page, 'f.controller.getSelection().range.end')).toBeGreaterThan(before.end + 2);
  expect(await f<number>(page, 'f.controller.getSelection().range.start')).toBe(before.start);
  await expect(page.getByTestId('selection-toolbar')).toBeVisible();
  await shot(page, 'handles');
});
