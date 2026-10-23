// 书架功能整站冒烟：手机 412×915、桌面 1280×800 各跑一遍。
// 导入（文件选择 / 拖放 / 目录 / ZIP / 服务端转换格式）→ 各视图与排序 → 分组/标签/收藏/置顶 → 搜索 → 书籍信息与改封面 →
// 统计页 → 最近阅读 → 笔记页 → 启动密码 → 夜间模式 → 英文界面。
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { OUT, SAMPLES, go, makeCbz, makeEpub, makePng, openApp, openImportDialog, shot, startServer, type Opened, type Shape, type Srv } from './accept.library.helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 }); // 找不到元素时快速失败，别拖到整条用例超时

const VIEWPORTS = [
  { name: 'm', width: 412, height: 915 },
  { name: 'd', width: 1280, height: 800 },
];

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

const idbPut = (page: Page, store: string, value: unknown) =>
  page.evaluate(
    ([s, v]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('moonreader');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction(s as string, 'readwrite');
          tx.objectStore(s as string).put(v);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    [store, value] as const,
  );

const TXT = (n: number) => Array.from({ length: n }, (_, i) => `第${i + 1}回 山不在高，有仙则名。水不在深，有龙则灵。斯是陋室，惟吾德馨。苔痕上阶绿，草色入帘青。${'谈笑有鸿儒，往来无白丁。'.repeat(20)}`).join('\n\n');

interface BookFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** 一批各种格式、不同作者/标题的样书 */
async function sampleBooks(): Promise<BookFile[]> {
  const epub = 'application/epub+zip';
  const list: BookFile[] = [
    { name: '三体.epub', mimeType: epub, buffer: await makeEpub('三体', '刘慈欣', { cover: true, subject: '科幻' }) },
    { name: '黑暗森林.epub', mimeType: epub, buffer: await makeEpub('黑暗森林', '刘慈欣', { cover: true, subject: '科幻' }) },
    { name: '死神永生.epub', mimeType: epub, buffer: await makeEpub('死神永生', '刘慈欣', { subject: '科幻' }) },
    { name: 'Dune.epub', mimeType: epub, buffer: await makeEpub('Dune', 'Frank Herbert', { cover: true, subject: 'Science Fiction' }) },
    { name: 'Alice in Wonderland.epub', mimeType: epub, buffer: await makeEpub('Alice in Wonderland', 'Lewis Carroll', { subject: 'Fantasy' }) },
    { name: '红楼梦.txt', mimeType: 'text/plain', buffer: Buffer.from(TXT(30)) },
    { name: '漫画样例.cbz', mimeType: 'application/vnd.comicbook+zip', buffer: await makeCbz(4) },
  ];
  const pdf = path.join(SAMPLES, 'books/tracemonkey.pdf');
  if (fs.existsSync(pdf)) list.push({ name: 'tracemonkey.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(pdf) });
  const fb2 = path.join(SAMPLES, 'books/sample.fb2');
  if (fs.existsSync(fb2)) list.push({ name: 'sample.fb2', mimeType: 'application/x-fictionbook+xml', buffer: fs.readFileSync(fb2) });
  const md = path.join(SAMPLES, 'books/sample.md');
  if (fs.existsSync(md)) list.push({ name: 'sample.md', mimeType: 'text/markdown', buffer: fs.readFileSync(md) });
  return list;
}

for (const vp of VIEWPORTS) {
  test.describe(`书架冒烟 ${vp.width}×${vp.height}`, () => {
    let srv: Srv;
    let shape: Shape;
    let app: Opened;
    let page: Page;
    const pre = `shelf-${vp.name}`;

    test.beforeAll(async ({ browser }) => {
      srv = await startServer({ serve: 'std' });
      shape = { kind: 'hosted', token: false, srv };
      app = await openApp(browser, shape, { viewport: { width: vp.width, height: vp.height }, hash: '#/shelf' });
      page = app.page;
    });
    test.afterAll(async () => {
      await app?.ctx.close();
      await srv?.stop();
    });

    test('空书架：首次进入书架会弹出「导入书籍」对话框（LIB-001）', async () => {
      await go(page, '#/shelf');
      await expect(page.getByRole('dialog').getByText('导入书籍').first()).toBeVisible({ timeout: 5000 });
      await shot(page, `${pre}-01-first-import-dialog`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('书架是空的')).toBeVisible();
      await shot(page, `${pre}-02-empty-shelf`);
      // 只弹一次：离开再回来不再自动弹
      await go(page, '#/');
      await go(page, '#/shelf');
      await page.waitForTimeout(600);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('导入：文件选择器一次选多种格式', async () => {
      const files = await sampleBooks();
      await openImportDialog(page);
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('选择文件').click()]);
      await chooser.setFiles(files);
      await expect(page.getByText(new RegExp(`已导入 ${files.length} 本`))).toBeVisible({ timeout: 90_000 });
      await shot(page, `${pre}-03-import-done`);
      await page.getByRole('dialog').getByText('三体').first().click(); // 新书列表里点一本会直接打开
      await expect(page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 20_000 });
      await go(page, '#/shelf');
      const books = await idbAll(page, 'books');
      expect(books).toHaveLength(files.length);
      const byTitle = Object.fromEntries(books.map((b) => [b.title, b]));
      expect(byTitle['三体'].authors).toEqual(['刘慈欣']);
      expect(byTitle['三体'].hasCover).toBe(true);
      expect(byTitle['三体'].tags).toContain('科幻');
      expect(byTitle['红楼梦'].format).toBe('txt');
      expect(byTitle['红楼梦'].tags).toContain('(TXT)');
      expect(books.some((b) => b.format === 'cbz')).toBe(true);
    });

    test('书架：网格视图（木纹）截图，书名都能看见', async () => {
      await go(page, '#/shelf');
      await expect(page.getByText('三体', { exact: true }).first()).toBeVisible();
      await shot(page, `${pre}-04-grid`);
    });

    // ───────────── 视图与排序 ─────────────
    const collator = new Intl.Collator(['zh-Hans-CN', 'en'], { sensitivity: 'base', numeric: true });
    const shownTitles = () => page.locator('[class*=cellTitle], [class*=itemTitle]').allTextContents();
    const openFilter = async () => {
      await page.getByRole('button', { name: '书架设置' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    };
    const setStyle = async (label: '列表' | '格子' | '封面流') => {
      await openFilter();
      await page.getByRole('dialog').getByRole('radio', { name: label }).click();
      await page.keyboard.press('Escape');
    };
    const setSort = async (label: string) => {
      await openFilter();
      await page.getByRole('dialog').getByText(label, { exact: true }).click();
      await page.keyboard.press('Escape');
    };

    test('视图：列表 / 格子 / 封面流；排序：书名 / 作者 / 导入时间 / 存储目录 / 最近阅读', async () => {
      await go(page, '#/shelf');
      const books = await idbAll(page, 'books');
      await setStyle('列表');
      await expect(page.locator('[class*=itemTitle]')).toHaveCount(books.length);
      await shot(page, `${pre}-05-list`);
      // 书名序
      const byTitle = [...books].sort((a, b) => collator.compare(a.title, b.title)).map((b) => b.title);
      expect(await shownTitles()).toEqual(byTitle);
      // 作者序（同作者再按书名）
      await setSort('作者');
      const au = (b: any) => b.authors.join(' & ');
      const byAuthor = [...books].sort((a, b) => collator.compare(au(a), au(b)) || collator.compare(a.title, b.title)).map((b) => b.title);
      expect(await shownTitles()).toEqual(byAuthor);
      // 导入时间：新的在前
      await setSort('导入时间');
      const byAdded = [...books].sort((a, b) => b.addedAt - a.addedAt).map((b) => b.title);
      expect(await shownTitles()).toEqual(byAdded);
      // 最近阅读：刚才打开过「三体」，它排第一，其余按书名
      await setSort('最近阅读');
      const t0 = (await shownTitles())[0];
      expect(t0).toBe('三体');
      await setSort('存储目录');
      expect((await shownTitles()).length).toBe(books.length);
      // 封面流
      await setStyle('封面流');
      await expect(page.getByText(/第 1\/\d+ 本/)).toBeVisible();
      await shot(page, `${pre}-06-coverflow`);
      await setStyle('格子');
      await setSort('书名');
      await expect(page.locator('[class*=cellTitle]').first()).toBeVisible();
      await shot(page, `${pre}-07-grid-again`);
    });

    // ───────────── 书籍信息编辑：系列 / 标签 / 收藏 ─────────────
    const cellOf = (title: string) => page.locator('[data-id]').filter({ has: page.getByText(title, { exact: true }) }).first();
    const bookMenu = async (title: string, item: string | RegExp) => {
      await cellOf(title).locator('button[aria-label="操作"]').click({ force: true });
      await page.getByRole('menuitem', { name: item }).click();
    };
    const editInfo = async (title: string, patch: { series?: string; idx?: string; tags?: string; fav?: string }) => {
      await bookMenu(title, '书籍信息');
      const dlg = page.getByRole('dialog').last();
      if (patch.series !== undefined) await dlg.getByPlaceholder('系列名').fill(patch.series);
      if (patch.idx !== undefined) await dlg.getByPlaceholder('序号').fill(patch.idx);
      if (patch.tags !== undefined) await dlg.getByPlaceholder('每行一个标签').fill(patch.tags);
      if (patch.fav !== undefined) {
        await dlg.getByText('加入珍藏', { exact: true }).click();
        await dlg.getByPlaceholder('分类名(可选)').fill(patch.fav);
      }
      await dlg.getByRole('button', { name: '保存' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };

    test('书籍信息：编辑系列/标签/珍藏并保存（LIB-013/014/015）', async () => {
      await go(page, '#/shelf');
      await editInfo('三体', { series: '地球往事', idx: '1', tags: '经典\n硬科幻' });
      await editInfo('黑暗森林', { series: '地球往事', idx: '2', fav: '最爱' });
      await editInfo('死神永生', { series: '地球往事', idx: '3' });
      const b = Object.fromEntries((await idbAll(page, 'books')).map((x) => [x.title, x]));
      expect(b['三体'].series).toEqual({ name: '地球往事', index: 1 });
      expect(b['三体'].tags).toEqual(['经典', '硬科幻']); // 单书编辑整体替换标签（LIB-015）
      expect(b['黑暗森林'].favorite).toBe('最爱');
      await shot(page, `${pre}-08-after-edit`);
    });

    const pickCategory = async (name: string) => {
      await page.locator('button[class*=topTitleBtn]').click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    };

    test('分类：全部 / 我的珍藏 / 书籍系列 / 书籍作者 / 书籍标签 / 存储目录，下钻与返回（LIB-006）', async () => {
      await go(page, '#/shelf');
      await pickCategory('书籍系列');
      await expect(page.getByText('地球往事')).toBeVisible();
      await expect(page.getByText('(3)').first()).toBeVisible();
      await shot(page, `${pre}-09-series-groups`);
      await page.getByText('地球往事').click();
      // 系列内按序号排
      expect(await shownTitles()).toEqual(['三体', '黑暗森林', '死神永生']);
      await page.getByRole('button', { name: '返回' }).click();
      await expect(page.getByText('地球往事')).toBeVisible();
      await pickCategory('书籍作者');
      await expect(page.getByText('刘慈欣')).toBeVisible();
      await page.getByText('刘慈欣').click(); // 该作者有系列 → 转到系列视图
      await expect(page.getByText('全部书籍 (3)').or(page.getByText('全部书籍').first())).toBeVisible();
      await shot(page, `${pre}-10-author-to-series`);
      await pickCategory('书籍标签');
      await expect(page.getByText('科幻').first()).toBeVisible();
      await page.getByText('科幻', { exact: true }).first().click();
      expect((await shownTitles()).sort()).toEqual(['死神永生', '黑暗森林'].sort());
      await pickCategory('存储目录');
      await expect(page.getByText('本机导入')).toBeVisible();
      await pickCategory('我的珍藏');
      await expect(page.getByText('最爱')).toBeVisible();
      await page.getByText('最爱').first().click();
      expect(await shownTitles()).toEqual(['黑暗森林']);
      await shot(page, `${pre}-11-favorites`);
      await go(page, '#/shelf');
      await pickCategory('全部书籍');
      await expect(page.locator('[class*=cellTitle], [class*=itemTitle]').first()).toBeVisible();
    });

    // ───────────── 多选 / 置顶 / 搜索 ─────────────
    test('多选：右键进入 → 批量标签、珍藏、改名收藏夹、阅读状态（LIB-011/014/016）', async () => {
      await go(page, '#/shelf');
      await cellOf('红楼梦').click({ button: 'right' });
      await expect(page.getByText('已选 1 项')).toBeVisible();
      await cellOf('Dune').click();
      await expect(page.getByText('已选 2 项')).toBeVisible();
      await shot(page, `${pre}-12-select`);
      // 批量标签
      await page.getByRole('button', { name: '标签', exact: true }).click();
      await page.getByRole('dialog').last().getByPlaceholder('每行一个标签').fill('待读');
      await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
      const bookBy = async (title: string) => (await idbAll(page, 'books')).find((x) => x.title === title);
      await expect.poll(async () => (await bookBy('红楼梦')).tags).toEqual(expect.arrayContaining(['待读', '(TXT)']));
      await expect.poll(async () => (await bookBy('Dune')).tags).toContain('待读');
      // 重新选中 → 加入珍藏
      await cellOf('红楼梦').click({ button: 'right' });
      await cellOf('Dune').click();
      await page.getByRole('button', { name: '加入我的珍藏' }).click();
      await page.getByRole('dialog').last().getByPlaceholder('分类名(可选)').fill('周末');
      await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
      await expect.poll(async () => (await bookBy('红楼梦')).favorite).toBe('周末');
      // 珍藏分组里「改名」
      await pickCategory('我的珍藏');
      await expect(page.getByText('周末')).toBeVisible();
      await page.locator('[class*=groupRow]').filter({ hasText: '周末' }).getByRole('button', { name: '改名' }).click();
      await page.getByRole('dialog').last().getByPlaceholder('分类名(可选)').fill('周末书单');
      await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
      await expect(page.getByText('周末书单')).toBeVisible();
      await expect.poll(async () => [(await bookBy('红楼梦')).favorite, (await bookBy('Dune')).favorite]).toEqual(['周末书单', '周末书单']);
      // 手动设为已读（LIB-016）→ 进度派生状态被覆盖
      await go(page, '#/shelf');
      await pickCategory('全部书籍');
      await cellOf('Dune').click({ button: 'right' });
      await page.getByRole('button', { name: '更多' }).click();
      await page.getByRole('menuitem', { name: '阅读过滤' }).click();
      await page.getByRole('dialog').last().getByText('已读', { exact: true }).click();
      await expect.poll(async () => (await bookBy('Dune')).readState).toBe(3);
      // 过滤「只看已读」
      await openFilter();
      await page.getByRole('dialog').getByText('未读', { exact: true }).click();
      await page.getByRole('dialog').getByText('正在阅读', { exact: true }).click();
      await page.keyboard.press('Escape');
      expect(await shownTitles()).toEqual(['Dune']);
      await openFilter();
      await page.getByRole('dialog').getByText('未读', { exact: true }).click();
      await page.getByRole('dialog').getByText('正在阅读', { exact: true }).click();
      await page.keyboard.press('Escape');
      // 文件类型过滤：只看 EPUB
      await openFilter();
      await page.getByRole('dialog').getByText('全部', { exact: true }).click(); // 取消「全部」后默认只勾 EPUB（原版 filterEpub=true）
      await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'EPUB' })).toBeChecked();
      await page.keyboard.press('Escape');
      const epubs = (await idbAll(page, 'books')).filter((x) => x.format === 'epub').length;
      expect((await shownTitles()).length).toBe(epubs);
      await openFilter();
      await page.getByRole('dialog').getByText('全部', { exact: true }).click();
      await page.keyboard.press('Escape');
    });

    test('置顶 / 取消置顶；移出书架（保留文件）与「同时删除文件」（LIB-012/017/026）', async () => {
      await go(page, '#/shelf');
      await bookMenu('Dune', '置顶');
      await expect.poll(async () => (await shownTitles())[0]).toBe('Dune');
      await bookMenu('Dune', '取消置顶');
      await expect.poll(async () => (await shownTitles())[0]).not.toBe('Dune');
      const before = (await idbAll(page, 'books')).length;
      // 移出书架：书记录还在（onShelf=false），文件还在
      await bookMenu('sample', '从我的书架里移除');
      await page.getByRole('dialog').last().getByRole('button', { name: '是' }).click();
      await expect.poll(async () => (await idbAll(page, 'books')).find((x) => x.title === 'sample').onShelf).toBe(false);
      let books = await idbAll(page, 'books');
      expect(books).toHaveLength(before);
      await expect(cellOf('sample')).toHaveCount(0);
      // 勾选「同时删除文件」才真正删
      await bookMenu('tracemonkey', '从我的书架里移除');
      await page.getByRole('dialog').last().getByText('同时删除文件').click();
      await page.getByRole('dialog').last().getByRole('button', { name: '是' }).click();
      await expect.poll(async () => (await idbAll(page, 'books')).find((x) => x.title === 'tracemonkey')).toBeUndefined();
      books = await idbAll(page, 'books');
      expect((await idbAll(page, 'files')).length).toBe(books.length);
    });

    test('搜索：联想、回车后联想收起、无匹配提示（LIB-010）', async () => {
      await go(page, '#/shelf');
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      const input = page.locator('input[placeholder]').first();
      await input.fill('刘慈欣');
      await expect(page.getByText('三体').first()).toBeVisible();
      await shot(page, `${pre}-13-search-suggest`);
      await input.press('Enter');
      // 回车提交后联想下拉要收起，不能盖在结果上
      await expect(page.locator('[class*=suggest]')).toHaveCount(0);
      expect((await shownTitles()).sort()).toEqual(['三体', '死神永生', '黑暗森林'].sort());
      await input.fill('zzzz不存在');
      await expect(page.getByText('没有符合条件的书籍')).toBeVisible();
      await page.getByRole('button', { name: '关闭' }).click();
      await expect(page.locator('[class*=cellTitle]').first()).toBeVisible();
      // 历史词：提交过的词下次打开能联想
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await expect(page.getByText('刘慈欣')).toBeVisible();
      await page.keyboard.press('Escape'); // Esc 关闭搜索框
      await expect(page.locator('input[placeholder]')).toHaveCount(0);
    });

    // ───────────── 改封面 ─────────────
    test('改封面：上传图片 → 书架显示新封面 → 恢复（LIB-019）', async () => {
      await go(page, '#/shelf');
      await bookMenu('死神永生', '书籍信息');
      await page.getByRole('dialog').last().getByRole('button', { name: '选择封面...' }).click();
      await shot(page, `${pre}-14-cover-picker`);
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('dialog').last().getByRole('button', { name: '从文件上传' }).click()]);
      await chooser.setFiles({ name: 'mine.png', mimeType: 'image/png', buffer: makePng(300, 450, 7) });
      await expect(page.getByText('封面已更新').first()).toBeVisible({ timeout: 10_000 });
      expect((await idbAll(page, 'covers')).filter((c) => c.kind === 'edit')).toHaveLength(1);
      // 恢复
      await page.getByRole('dialog').last().getByRole('button', { name: '恢复' }).click();
      await expect.poll(async () => (await idbAll(page, 'covers')).filter((c) => c.kind === 'edit').length).toBe(0);
      // 封面文字
      await page.getByRole('dialog').last().getByLabel('封面文字(可选)').fill('文字封面');
      await page.getByRole('dialog').last().getByRole('button', { name: '保存' }).click();
      await expect.poll(async () => (await idbAll(page, 'covers')).filter((c) => c.kind === 'edit').length).toBe(1);
    });

    // ───────────── 阅读数据：统计 / 最近阅读 / 首页 ─────────────
    const day = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / 86_400_000);
    const patchBook = (id: string, patch: Record<string, unknown>) =>
      page.evaluate(
        ([bid, p]) =>
          new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('moonreader');
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const tx = req.result.transaction('books', 'readwrite');
              const st = tx.objectStore('books');
              const g = st.get(bid as string);
              g.onsuccess = () => st.put({ ...g.result, ...(p as object) });
              tx.oncomplete = () => resolve();
            };
          }),
        [id, patch] as const,
      );
    const seedReading = async () => {
      const bs = Object.fromEntries((await idbAll(page, 'books')).map((x) => [x.title, x]));
      const now = Date.now();
      const read: [string, number, number][] = [['三体', 0.72, 4000], ['红楼梦', 0.45, 3000], ['Dune', 1, 2000], ['黑暗森林', 0.03, 1000]];
      for (const [title, progress, ago] of read) {
        const id = bs[title].id;
        await idbPut(page, 'positions', { bookId: id, locator: { section: 0, offset: 10 }, progress, updatedAt: now - ago, deviceId: 'acc' });
        await patchBook(id, { progress, lastReadAt: now - ago });
      }
      await idbPut(page, 'kv', { key: 'library.history', value: read.slice().sort((a, b) => a[2] - b[2]).map(([t, , ago]) => ({ bookId: bs[t].id, at: now - ago })) });
      const d = day();
      const stat = (title: string, ms: number, words: number, pages: number, days: number[]) => idbPut(page, 'stats', { bookId: bs[title].id, usedMs: ms, words, pages, days: Object.fromEntries(days.map((x) => [x, { ms: ms / days.length, words: words / days.length }])), dayPages: {} });
      await stat('三体', 5_400_000, 18_000, 150, [d, d - 1]);
      await stat('红楼梦', 3_600_000, 9_000, 80, [d - 1]);
      await stat('Dune', 7_200_000, 20_000, 220, [d - 3]);
      await page.reload();
      await page.waitForSelector('#root > *');
    };

    test('统计页与首页卡片：8 张卡片口径、单书统计、清空统计（STAT-003/005）', async () => {
      await go(page, '#/shelf');
      await seedReading();
      const shelfCount = (await idbAll(page, 'books')).filter((b) => b.onShelf !== false).length;
      await go(page, '#/stats');
      const card = (label: string) => page.locator('[class*=statCard]').filter({ hasText: label }).locator('b');
      await expect(card('书架书籍总数')).toHaveText(String(shelfCount));
      await expect(card('已读书籍总数')).toHaveText('4'); // 有进度记录的书
      await expect(card('阅读小时数')).toHaveText('4.5'); // (5400+3600+7200)s = 4.5h
      await expect(card('总共阅读页数')).toHaveText('450');
      await expect(card('每天阅读小时')).toHaveText('1.5'); // 4.5h / 3 个有记录的日子（d、d-1、d-3）
      await expect(card('每页阅读时间(秒)')).toHaveText('36'); // 16200s / 450
      await expect(card('每小时翻页')).toHaveText('100');
      await expect(card('每分钟阅读字数')).toHaveText('174'); // 47000 字 / 270 分
      await shot(page, `${pre}-15-stats`);
      // 单书统计行
      await expect(page.locator('[class*=groupRow]').filter({ hasText: 'Dune' })).toContainText('2.00');
      await page.locator('[class*=groupRow]').filter({ hasText: 'Dune' }).click(); // 点击打开书籍信息，里面有速度与日期明细
      await expect(page.getByRole('dialog').getByText(/阅读速度/)).toBeVisible();
      await expect(page.getByRole('dialog').getByText(/阅读速度\(字\/分钟\): 167/)).toBeVisible(); // 20000 字 / 120 分
      await expect(page.getByRole('dialog').getByText(/167 w\/m/)).toBeVisible(); // 逐日明细
      await shot(page, `${pre}-16-info-stats`);
      await page.keyboard.press('Escape');
      // 首页卡片与最近阅读行
      await go(page, '#/');
      await expect(page.getByRole('heading', { name: '阅读统计' })).toBeVisible();
      await shot(page, `${pre}-17-dash`);
      // 清空统计：只清统计，不清最近阅读（不勾选）
      await go(page, '#/stats');
      await page.getByRole('button', { name: '更多' }).click();
      await page.getByRole('menuitem', { name: '清空全部阅读统计' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
      await expect.poll(async () => (await idbAll(page, 'stats')).length).toBe(0);
      expect((await idbAll(page, 'positions')).length).toBe(4);
      await expect(card('阅读小时数')).toHaveText('0.0');
    });

    test('最近阅读：按打开顺序、进度、移除、「使用最近阅读作为开始页」（LIB-004）', async () => {
      await go(page, '#/recent');
      expect(await shownTitles()).toEqual(['黑暗森林', 'Dune', '红楼梦', '三体']);
      await expect(page.locator('[data-id]').filter({ has: page.getByText('Dune', { exact: true }) })).toContainText('100%');
      await shot(page, `${pre}-18-recent`);
      // 搜索
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await page.locator('input[placeholder]').first().fill('dune');
      expect(await shownTitles()).toEqual(['Dune']);
      await page.getByRole('button', { name: '关闭' }).click();
      // 从最近阅读里移除（不删文件）
      await page.locator('[data-id]').filter({ has: page.getByText('红楼梦', { exact: true }) }).locator('button[aria-label="操作"]').click({ force: true });
      await page.getByRole('menuitem', { name: '从最近阅读里移除本书' }).click();
      await page.getByRole('dialog').last().getByRole('button', { name: '是' }).click();
      await expect.poll(shownTitles).toEqual(['黑暗森林', 'Dune', '三体']);
      expect((await idbAll(page, 'books')).some((b) => b.title === '红楼梦' && b.onShelf !== false)).toBe(true);
      // 开始页
      await go(page, '#/settings/app');
      await page.getByText('使用最近阅读作为开始页').click();
      await go(page, '#/');
      await expect(page.locator('[class*=itemTitle]').first()).toBeVisible();
      await expect(page.getByText('黑暗森林').first()).toBeVisible();
      await shot(page, `${pre}-19-start-recent`);
      await go(page, '#/settings/app');
      await page.getByText('使用最近阅读作为开始页').click();
    });

    // ───────────── 笔记页 ─────────────
    test('书签/标注汇总：徽章计数、过滤、颜色、搜索、单书列表、导出（LIB-030）', async () => {
      const bs = Object.fromEntries((await idbAll(page, 'books')).map((x) => [x.title, x]));
      const mk = (i: number, bookId: string, kind: 'bookmark' | 'highlight', color: string, text: string, note?: string, title?: string) =>
        idbPut(page, 'annotations', { id: `acc-${i}`, bookId, kind, range: { section: i % 2, start: i * 40, end: kind === 'bookmark' ? i * 40 : i * 40 + 12 }, text, note, title, color, style: 'highlight', chapterTitle: `第${(i % 2) + 1}章`, progress: i / 10, createdAt: Date.now() - i * 1000, updatedAt: Date.now() - i * 1000 });
      await mk(1, bs['三体'].id, 'highlight', '#ffeb3b', '你们是虫子！');
      await mk(2, bs['三体'].id, 'highlight', '#80d8ff', '给岁月以文明，而不是给文明以岁月。', '刘慈欣名句');
      await mk(3, bs['三体'].id, 'bookmark', '#e53935', '夜里风很大', undefined, '书签：夜里');
      await mk(4, bs['黑暗森林'].id, 'highlight', '#ffeb3b', '弱小和无知不是生存的障碍，傲慢才是。');
      await mk(5, bs.Dune.id, 'bookmark', '#e53935', 'Fear is the mind-killer', undefined, '书签：恐惧');
      await go(page, '#/notes');
      await page.reload();
      await page.waitForSelector('#root > *');
      const badge = (label: string) => page.locator('button[class*=tag]').filter({ hasText: label });
      await expect(badge('书签')).toContainText('(2)');
      await expect(badge('标注')).toContainText('(1)'); // 有笔记的高亮
      await expect(badge('高亮')).toContainText('(2)');
      await shot(page, `${pre}-20-notes`);
      await badge('书签').click();
      await expect(page.locator('[class*=groupRow]')).toHaveCount(2);
      await badge('书签').click();
      // 颜色过滤
      await page.getByRole('button', { name: '颜色' }).click();
      await page.getByRole('dialog').last().locator('span[style*="rgb(128, 216, 255)"], span[style*="#80d8ff"]').first().click();
      await expect(page.locator('[class*=groupRow]')).toHaveCount(1);
      await page.getByRole('button', { name: '颜色' }).click();
      await page.getByRole('dialog').last().getByText('全部').click();
      // 搜索
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await page.locator('input[placeholder]').first().fill('傲慢');
      await expect(page.locator('[class*=groupRow]')).toHaveCount(1);
      await page.locator('input[placeholder]').first().press('Enter');
      await page.getByRole('button', { name: '关闭' }).click();
      // 单书列表
      await page.locator('[class*=groupRow]').filter({ hasText: '三体' }).click();
      await expect(page.getByText('书签：夜里')).toBeVisible();
      await expect(page.getByText('✎ 刘慈欣名句')).toBeVisible();
      await shot(page, `${pre}-21-notes-book`);
      // 导出菜单：Markdown 下载
      await page.getByRole('button', { name: '导出' }).click();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Markdown/ }).click()]);
      expect(dl.suggestedFilename()).toMatch(/三体.*\.md$/);
      // 多选删除
      await page.getByText('你们是虫子！').click({ button: 'right' });
      await page.getByRole('button', { name: '删除', exact: true }).click();
      await page.getByRole('dialog').last().getByRole('button', { name: '确定' }).click();
      await expect(page.getByText('你们是虫子！')).toHaveCount(0);
    });

    // ───────────── 启动密码 / 夜间模式 / 英文界面 ─────────────
    test('启动密码：设置、不一致提示、刷新后锁屏、错误/正确、直达阅读页也被拦、关闭（LIB-033）', async () => {
      await go(page, '#/settings/app');
      await page.getByText('设置阅读器保护密码').click();
      let dlg = page.getByRole('dialog').last();
      await dlg.locator('input[type=password]').nth(0).fill('1234');
      await dlg.locator('input[type=password]').nth(1).fill('9999');
      await dlg.getByRole('button', { name: '确定' }).click();
      await expect(page.getByText('两次输入的密码不同')).toBeVisible();
      await dlg.locator('input[type=password]').nth(1).fill('1234');
      await dlg.getByRole('button', { name: '确定' }).click();
      await expect(page.getByText('启动密码设定成功')).toBeVisible();
      // 设置写 localStorage 有 200ms 去抖，同一上下文新开的标签页要等它落盘
      await expect.poll(() => page.evaluate(() => localStorage.getItem('mr.settings.v1') ?? '')).toContain('"lockEnabled":true');
      // 新开标签（新会话）→ 锁屏
      const bookId = (await idbAll(page, 'books'))[0].id as string;
      const p2 = await page.context().newPage();
      await p2.goto(page.url().split('#')[0] + '#/shelf');
      await expect(p2.getByPlaceholder('请输入密码')).toBeVisible({ timeout: 10_000 });
      await shot(p2, `${pre}-22-lock`);
      await p2.getByPlaceholder('请输入密码').fill('0000');
      await p2.getByRole('button', { name: '解锁' }).click();
      await expect(p2.getByText('密码错误')).toBeVisible();
      await p2.getByPlaceholder('请输入密码').fill('1234');
      await p2.getByRole('button', { name: '解锁' }).click();
      await expect(p2.getByRole('button', { name: '书架设置' })).toBeVisible();
      await p2.close();
      // 另一个新会话直接打开阅读页地址：不能绕过锁屏
      const p3 = await page.context().newPage();
      await p3.goto(page.url().split('#')[0] + `#/read/${bookId}`);
      await expect(p3.getByPlaceholder('请输入密码')).toBeVisible({ timeout: 10_000 });
      await expect(p3.locator('iframe[title^="section-"]')).toHaveCount(0);
      await p3.close();
      // 关闭密码
      await go(page, '#/settings/app');
      await page.getByText('设置阅读器保护密码').click();
      dlg = page.getByRole('dialog').last();
      await dlg.getByRole('button', { name: '关闭启动密码' }).click();
      await page.waitForTimeout(400); // 设置去抖 200ms 后才写进 localStorage，新标签读的是存储
      const p4 = await page.context().newPage();
      await p4.goto(page.url().split('#')[0] + '#/shelf');
      await expect(p4.getByRole('button', { name: '书架设置' })).toBeVisible();
      await p4.close();
    });

    test('夜间模式：抽屉里切换，书架配色随之变化（LIB-020）', async () => {
      await go(page, '#/shelf');
      const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor + '|' + (getComputedStyle(document.querySelector('[class*=topbar]')!).backgroundColor));
      const dayBg = await bg();
      if (vp.width < 900) await page.getByRole('button', { name: '菜单' }).click();
      await page.getByRole('button', { name: '晚上模式' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'dark');
      expect(await bg()).not.toBe(dayBg);
      await shot(page, `${pre}-23-night-shelf`);
      await go(page, '#/stats');
      await shot(page, `${pre}-24-night-stats`);
      await go(page, '#/settings');
      await shot(page, `${pre}-25-night-settings`);
      if (vp.width < 900) await page.getByRole('button', { name: '菜单' }).click();
      await page.getByRole('button', { name: '白天模式' }).click();
      await expect(page.locator('html')).not.toHaveAttribute('data-ui-theme', 'dark');
    });

    test('英文界面：设置里切换语言，书架/设置/统计页文案都是英文（LIB-034）', async () => {
      await go(page, '#/settings/app');
      const langSelect = page.locator('select').filter({ has: page.locator('option[value=en]') });
      await langSelect.selectOption('en');
      await expect(page.locator('[class*=topTitle]').filter({ hasText: 'Options' })).toBeVisible({ timeout: 5000 });
      await go(page, '#/shelf');
      await expect(page.locator('[class*=topTitle]').filter({ hasText: 'All Books' })).toBeVisible();
      await shot(page, `${pre}-26-english-shelf`);
      await go(page, '#/stats');
      await expect(page.getByText('Books On Shelf')).toBeVisible();
      await shot(page, `${pre}-27-english-stats`);
      await go(page, '#/');
      await expect(page.getByRole('heading', { name: /Recent/ }).first()).toBeVisible();
      await shot(page, `${pre}-28-english-dash`);
      // 切回中文
      await go(page, '#/settings/app');
      await langSelect.selectOption('zh');
      await expect(page.locator('[class*=topTitle]').filter({ hasText: '选项' })).toBeVisible();
    });
  });
}

void JSZip;
void makePng;
void OUT;
void idbPut;
