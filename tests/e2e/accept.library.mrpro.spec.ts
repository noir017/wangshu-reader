// 原版 .mrpro 整库备份导入（B 节第 2 条）：在真实浏览器里（标准构建与 file:// 单文件版）从设置页导入，
// 书架、进度、标注、统计、最近阅读都进来；备份里没带文件的书，点开后选一次原文件即可接上进度与标注。
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { makeMrpro } from '../../src/storage/mrpro-fixture';
import { OUT, go, makeEpub, openApp, shot, startServer, type Shape, type Srv } from './accept.library.helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);
test.use({ actionTimeout: 15_000 });

let srv: Srv;
test.beforeAll(async () => {
  srv = await startServer({ serve: 'std', noLibrary: true });
});
test.afterAll(async () => {
  await srv?.stop();
});

const idbAll = <T = any>(page: Page, store: string) =>
  page.evaluate(
    (s) =>
      new Promise<T[]>((resolve, reject) => {
        const req = indexedDB.open('moonreader');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction(s).objectStore(s).getAll();
          all.onsuccess = () => resolve(all.result as T[]);
        };
      }),
    store,
  );

for (const kind of ['hosted', 'single'] as const) {
  test(`${kind === 'hosted' ? '服务端托管' : 'file:// 单文件版'}：导入 .mrpro → 书架/进度/标注/统计/最近阅读；没带文件的书补文件后接上进度`, async ({ browser }) => {
    const shape: Shape = { kind, token: false, srv };
    const withFile = await makeEpub('随备份带来的书', '作者甲');
    const pendingEpub = await makeEpub('等补文件的书', '作者乙');
    const mrpro = await makeMrpro({
      books: [
        { book: '随备份带来的书', filename: '/sdcard/Books/带文件.epub', author: '作者甲', category: '<系列甲>\n#2#\n小说\n', favorite: '最爱' },
        { book: '等补文件的书', filename: '/sdcard/Books/待补.epub', author: '作者乙', description: '备份里的简介', category: '小说\n', favorite: 'default_fav' },
      ],
      notes: [
        { filename: '/sdcard/Books/待补.epub', chapter: 1, position: 40, length: 12, color: -256, original: '补文件后应该还在', note: '手机上写的笔记' },
        { filename: '/sdcard/Books/待补.epub', chapter: 0, position: 8, length: -65536, bookmark: '手机书签' },
      ],
      stats: [{ filename: '/sdcard/Books/待补.epub', usedTime: 5400000, readWords: 12000, dates: '19000|5400000@12000' }],
      positions: { '/sdcard/books/带文件.epub': '1@0#30:25.00%', '/sdcard/books/待补.epub': '1@0#90:60.50%' },
      history: ['/sdcard/Books/待补.epub', '/sdcard/Books/带文件.epub'],
      state: { '/sdcard/Books/待补.epub': 2 },
      top: ['/sdcard/Books/带文件.epub'],
      outer: { '/sdcard/Books/带文件.epub': withFile },
    });
    const file = path.join(OUT, `run/${srv.port}/${kind}.mrpro`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, mrpro);

    const { ctx, page, errors } = await openApp(browser, shape);
    await go(page, '#/settings/backup');
    await shot(page, `mrpro-${kind}-settings`);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('导入原版 Moon+ 数据').click()]);
    await chooser.setFiles(file);
    await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click(); // 「导入原版备份…？」
    await expect(page.getByText(/已导入原版备份/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/其中 1 本备份里没有书籍文件/).first()).toBeVisible();
    await shot(page, `mrpro-${kind}-done`);

    // 数据落库
    const books = await idbAll(page, 'books');
    expect(books.map((b) => b.title).sort()).toEqual(['等补文件的书', '随备份带来的书']);
    const real = books.find((b) => b.title === '随备份带来的书');
    expect(real).toMatchObject({ authors: ['作者甲'], tags: ['小说'], series: { name: '系列甲', index: 2 }, favorite: '最爱', format: 'epub' });
    expect(real.id.startsWith('legacy-')).toBe(false);
    expect(real.pinnedAt).toBeGreaterThan(0);
    const pending = books.find((b) => b.title === '等补文件的书');
    expect(pending.id.startsWith('legacy-')).toBe(true);
    expect(pending).toMatchObject({ description: '备份里的简介', favorite: 'default_fav', readState: 2 });
    expect((await idbAll(page, 'annotations')).map((a) => a.text).sort()).toEqual(['手机书签', '补文件后应该还在']);
    expect((await idbAll(page, 'stats')).map((s) => s.usedMs)).toEqual([5400000]);
    const positions = Object.fromEntries((await idbAll(page, 'positions')).map((p) => [p.bookId, p]));
    expect(positions[real.id].locator).toEqual({ section: 1, offset: 30 });
    expect(positions[pending.id].progress).toBeCloseTo(0.605, 3);

    // 书架：置顶的带文件书排第一；待补文件的书也在
    await go(page, '#/shelf');
    await expect(page.getByText('随备份带来的书', { exact: true })).toBeVisible();
    await expect(page.getByText('等补文件的书', { exact: true })).toBeVisible();
    await shot(page, `mrpro-${kind}-shelf`);
    // 最近阅读按备份的顺序
    await go(page, '#/recent');
    await expect(page.locator('[class*=itemTitle]')).toHaveText(['等补文件的书', '随备份带来的书']);

    // 带文件的书直接能读，进度落在备份的位置
    await go(page, '#/shelf');
    await page.getByText('随备份带来的书', { exact: true }).click();
    await expect(page.locator('iframe[title="section-1"]')).toBeAttached({ timeout: 30_000 });
    await go(page, '#/shelf');

    // 没带文件的书：点开 → 「文件不存在」→ 选原文件 → 按内容正式入库并接上进度、标注
    await page.getByText('等补文件的书', { exact: true }).click();
    await expect(page.getByRole('dialog').getByText(/不存在/)).toBeVisible();
    await shot(page, `mrpro-${kind}-missing`);
    const [relink] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('dialog').last().getByRole('button', { name: '重新选择文件' }).click()]);
    await relink.setFiles({ name: '待补.epub', mimeType: 'application/epub+zip', buffer: pendingEpub });
    await expect(page.locator('iframe[title="section-1"]')).toBeAttached({ timeout: 30_000 });
    const after = await idbAll(page, 'books');
    const adopted = after.find((b) => b.title === '等补文件的书');
    expect(adopted.id.startsWith('legacy-')).toBe(false);
    expect(after.filter((b) => b.id.startsWith('legacy-'))).toHaveLength(0);
    expect(adopted).toMatchObject({ description: '备份里的简介', favorite: 'default_fav', hasCover: false });
    expect((await idbAll(page, 'annotations')).filter((a) => a.bookId === adopted.id)).toHaveLength(2);
    expect((await idbAll(page, 'positions')).find((p) => p.bookId === adopted.id)?.locator).toEqual({ section: 1, offset: 90 });
    expect((await idbAll(page, 'stats')).find((s) => s.bookId === adopted.id)?.usedMs).toBe(5400000);
    expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
    await ctx.close();
  });
}

test('不是备份的文件：给出明确提示，不留下半截数据', async ({ browser }) => {
  const { ctx, page } = await openApp(browser, { kind: 'hosted', token: false, srv });
  await go(page, '#/settings/backup');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('导入原版 Moon+ 数据').click()]);
  await chooser.setFiles({ name: 'bad.mrpro', mimeType: 'application/octet-stream', buffer: Buffer.from('这不是 zip') });
  await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
  await expect(page.getByText(/无法读取这个备份/)).toBeVisible({ timeout: 15_000 });
  expect(await idbAll(page, 'books')).toHaveLength(0);
  await ctx.close();
});
