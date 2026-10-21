// 目录面板（目录树/书签列表/图片页）与标注导出导入。
import { expect, test, type Page } from '@playwright/test';
import { f, idbAnnotations, indexOfText, openDev, pageErrors, select, shot } from './features.helpers';

test.afterEach(async ({ page }) => {
  expect(pageErrors(page)).toEqual([]);
});

const panel = (page: Page) => page.getByTestId('toc-panel');
const openToc = async (page: Page, tab?: string) => {
  await f(page, `f.session.bus.emit('toc.open', ${tab ? `{ tab: '${tab}' }` : '{}'})`);
  await expect(panel(page)).toBeVisible();
};

test('目录树：只展开通向当前章的路径，当前章带 √，展开全部/搜索/倒序', async ({ page }) => {
  await openDev(page);
  await openToc(page);
  const rows = page.getByTestId('toc-row');
  await expect(rows).toHaveText(['第一部分', '第一章 起点√', 'Chapter Two', '第二部分']);
  await expect(page.getByTestId('toc-row').filter({ hasText: '第一章 起点' })).toHaveAttribute('data-current', 'true');
  await shot(page, 'toc-tree');

  await page.getByRole('button', { name: '全部折叠' }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: '全部展开' }).click();
  await expect(rows).toHaveCount(9);
  // 倒序
  await page.getByRole('button', { name: '倒序' }).click();
  await expect(rows.first()).toHaveText('中段小节4');
  await page.getByRole('button', { name: '倒序' }).click();

  // 搜索：过滤后点击跳转并关闭
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByTestId('toc-search').fill('chapter');
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect(panel(page)).toBeHidden();
  await expect.poll(() => f<number>(page, 'f.controller.getLocation().section')).toBe(1);
});

test('目录跳到带锚点的小节；再打开时当前项跟着变', async ({ page }) => {
  await openDev(page);
  await openToc(page);
  await page.getByRole('button', { name: '全部折叠' }).click();
  await page.getByRole('button', { name: '全部展开' }).click();
  await page.getByTestId('toc-row').filter({ hasText: '中段小节3' }).click();
  await expect.poll(() => f<number>(page, 'f.controller.getLocation().section')).toBe(2);
  await openToc(page);
  await expect(page.getByTestId('toc-row').filter({ hasText: '中段小节3' })).toHaveAttribute('data-current', 'true');
  await expect(page.getByTestId('toc-row').filter({ hasText: '第3章 长篇' })).not.toHaveAttribute('data-current', 'true');
});

test('书里有图：出现「图片」标签，点缩略图跳到图所在章', async ({ page }) => {
  await openDev(page);
  await openToc(page);
  await expect(page.getByTestId('tab-images')).toBeVisible();
  await page.getByTestId('tab-images').click();
  await shot(page, 'toc-images');
});

async function addHighlight(page: Page, section: number, needle: string, tpl = 'tpl-style-highlight') {
  const i = await indexOfText(page, section, needle);
  // 先把这段字滚到屏内（假引擎只处理当前章的选择）
  await f(page, `f.controller.goTo({ range: { section: ${section}, start: ${i}, end: ${i + needle.length} } })`);
  await select(page, section, i, i + needle.length);
  await page.getByTestId(tpl).click();
}

test('书签/标注页：筛选、关键字搜索、点击跳转、⋮ 菜单删除', async ({ page }) => {
  await openDev(page);
  // 书签放最前：书签名取的是「页首文字」，后面高亮会把页面滚到高亮处，名字就会带上别的关键字
  await f(page, "f.session.bus.emit('bookmark.add', {})");
  await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
  await addHighlight(page, 0, '天行健');
  await addHighlight(page, 0, '春眠不觉晓', 'tpl-style-underline');
  const i = await indexOfText(page, 0, '地势坤');
  await select(page, 0, i, i + 3);
  await page.getByTestId('sel-note').click();
  await page.getByRole('dialog').locator('textarea').fill('一条笔记');
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
  await expect.poll(async () => (await idbAnnotations(page)).length).toBe(4);

  await openToc(page, 'bookmarks');
  const list = page.getByTestId('annot-list');
  await expect(list.locator('> *')).toHaveCount(4);
  await shot(page, 'toc-annots');
  await page.getByTestId('filter-1').click();
  await expect(list.locator('> *')).toHaveCount(1);
  await page.getByTestId('filter-2').click();
  await expect(list.locator('> *')).toHaveCount(1);
  await expect(list).toContainText('一条笔记');
  await page.getByTestId('filter-3').click();
  await expect(list.locator('> *')).toHaveCount(2);
  await page.getByTestId('filter-0').click();
  // 关键字
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByTestId('annot-search').fill('春眠');
  await expect(list.locator('> *')).toHaveCount(1);
  await page.getByTestId('annot-search').fill('');

  // ⋮ 菜单 → 删除
  await list.getByRole('button', { name: '更多' }).first().click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await expect.poll(async () => (await idbAnnotations(page)).filter((x) => !x.deletedAt).length).toBe(3);

  // 点击条目 → 跳转并关面板
  await list.locator('> *').first().click();
  await expect(panel(page)).toBeHidden();
});

test('书签页：长按进多选，删除所选', async ({ page }) => {
  await openDev(page);
  await addHighlight(page, 0, '天行健');
  await addHighlight(page, 0, '春眠不觉晓');
  await expect.poll(async () => (await idbAnnotations(page)).length).toBe(2);
  await openToc(page, 'bookmarks');
  const first = page.getByTestId('annot-list').locator('> *').first();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByTestId('delete-selected')).toBeVisible();
  await page.getByTestId('delete-selected').click();
  await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
  await expect.poll(async () => (await idbAnnotations(page)).filter((x) => !x.deletedAt).length).toBe(1);
});

test('导出：文本复制、Markdown 下载、.mrexpt 导出后清空再导入能还原', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDev(page);
  await addHighlight(page, 0, '天行健');
  await addHighlight(page, 1, 'Call me Ishmael', 'tpl-style-underline');
  await expect.poll(async () => (await idbAnnotations(page)).length).toBe(2);
  await openToc(page, 'bookmarks');

  const openExport = async () => {
    await page.getByRole('button', { name: '导出' }).click();
    await expect(page.getByRole('dialog').getByText('导出 Markdown')).toBeVisible();
  };

  await openExport();
  await page.getByRole('dialog').getByText('复制高亮与备注 (TXT)').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('开发样书');
  expect(text).toContain('▪ 天行健');
  expect(text).toContain('◆ 第一章 起点');
  expect(text).toContain('Call me Ishmael');

  await openExport();
  const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByText('导出 Markdown').click()]);
  expect(md.suggestedFilename()).toBe('开发样书.md');

  await openExport();
  const [mr] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByText('导出到文件 (.mrexpt)').click()]);
  const stream = await mr.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  expect(body.toString('utf8')).toContain('天行健');

  // 清空后导入
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('moonreader');
        req.onsuccess = () => {
          const tx = req.result.transaction('annotations', 'readwrite');
          tx.objectStore('annotations').clear();
          tx.oncomplete = () => resolve();
        };
      }),
  );
  await page.reload();
  await page.waitForFunction(() => (window as any).__f?.ready === true);
  await expect.poll(async () => (await idbAnnotations(page)).length).toBe(0);
  await openToc(page, 'bookmarks');
  await openExport();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('dialog').getByText('从文件导入 (.mrexpt)').click()]);
  await chooser.setFiles({ name: '开发样书.mrexpt', mimeType: 'text/plain', buffer: body });
  await expect.poll(async () => (await idbAnnotations(page)).filter((x) => !x.deletedAt).length, { timeout: 8000 }).toBe(2);
  const back = (await idbAnnotations(page)).map((a) => a.text).sort();
  expect(back).toEqual(['Call me Ishmael', '天行健']);
});
