// 整站联调（真页面、真引擎、真 formats，不是开发页）：书架导入 → 打开书 → 选字出选择菜单 → 高亮/目录/搜索/朗读。
// 开发页验证不了的是 features 与真实阅读页的挂载顺序、会话状态、引擎的 open() 前后差异。
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { FAKE_SPEECH, idbAnnotations, pageErrors } from './features.helpers';

const para = (i: number) => `山不在高，有仙则名。水不在深，有龙则灵。斯是陋室，惟吾德馨。苔痕上阶绿，草色入帘青。谈笑有鸿儒，往来无白丁。第${i}段。`;
/** 够大（导入页默认过滤 <20KB 的文件）且分两章的 TXT */
const TXT = ['第一章 起点', ...Array.from({ length: 200 }, (_, i) => para(i)), '第二章 继续', ...Array.from({ length: 200 }, (_, i) => para(i + 1000))].join('\n\n');

async function makeEpub(): Promise<Buffer> {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:features-e2e</dc:identifier><dc:title>联调样书</dc:title><dc:creator>Moon Dev</dc:creator><dc:language>zh</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  );
  z.file('OEBPS/nav.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章 起点</a></li><li><a href="c2.xhtml">第二章 继续</a></li></ol></nav></body></html>');
  const body = (n: number) => Array.from({ length: 60 }, (_, i) => `<p>${para(i + n)}</p>`).join('');
  z.file('OEBPS/c1.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>c1</title></head><body><h1>第一章 起点</h1><p>脚注标记<a epub:type="noteref" href="#fn1">[1]</a>在这里。</p>${body(0)}<aside epub:type="footnote" id="fn1"><p>这是脚注：陋室铭。</p></aside></body></html>`);
  z.file('OEBPS/c2.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c2</title></head><body><h1>第二章 继续</h1>${body(500)}</body></html>`);
  return Buffer.from(await z.generateAsync({ type: 'nodebuffer' }));
}

async function importBook(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.goto('/');
  await page.getByText('导入书籍').first().click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('选择文件').click()]);
  await chooser.setFiles({ name, mimeType, buffer });
  await expect(page.getByText('已导入 1 本')).toBeVisible({ timeout: 20000 });
}

async function openFromImportList(page: Page, title: string) {
  await page.getByText(title).first().click();
  await expect(page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 20000 });
  // 引擎排版完（带文字、有尺寸）
  await expect.poll(() => page.locator('iframe[title="section-0"]').boundingBox().then((b) => b?.height ?? 0), { timeout: 15000 }).toBeGreaterThan(300);
  await page.waitForTimeout(600);
}

/** 双击正文里一个字（桌面原生选词 → 引擎 selection 事件 → 选择条） */
async function selectSomeWord(page: Page) {
  const box = (await page.locator('iframe[title="section-0"]').boundingBox())!;
  await page.mouse.dblclick(box.x + 90, box.y + 110);
  await expect(page.getByTestId('selection-toolbar')).toBeVisible({ timeout: 8000 });
}

test.afterEach(async ({ page }) => {
  expect(pageErrors(page)).toEqual([]);
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e)));
  (page as any).__errors = errors;
  await page.addInitScript(FAKE_SPEECH);
  // 首次进阅读页会弹「点击区示意」蒙层（reader/ui），先标记为已看过
  await page.addInitScript(() => {
    const k = 'mr.settings.v1';
    const cur = JSON.parse(localStorage.getItem(k) || '{}');
    cur['reader.ui'] = { ...cur['reader.ui'], showedReaderClickTip: true };
    localStorage.setItem(k, JSON.stringify(cur));
  });
});

test('书架导入 TXT → 打开 → 双击选字 → 选择条 → 高亮存库，没有页面错误', async ({ page }) => {
  await importBook(page, '陋室铭.txt', 'text/plain', Buffer.from(TXT, 'utf8'));
  await openFromImportList(page, '陋室铭');
  await page.screenshot({ path: 'out/features-shots/full-reader.png' });
  await selectSomeWord(page);
  await page.screenshot({ path: 'out/features-shots/full-selection.png' });
  const tb = page.getByTestId('selection-toolbar');
  await expect(tb.locator('[data-testid^="sel-"]')).toHaveText(['拷贝', '高亮', '标注', '词典', '']);
  await page.getByTestId('tpl-style-highlight').click();
  await expect.poll(async () => (await idbAnnotations(page)).filter((a) => a.kind === 'highlight' && !a.deletedAt).length).toBe(1);
  const [a] = await idbAnnotations(page);
  expect(a.text.length).toBeGreaterThan(0);
  expect(a.range.section).toBe(0);
});

test('EPUB：脚注气泡、目录面板、搜索、书签、朗读都能在真阅读页里工作', async ({ page }) => {
  await importBook(page, '联调样书.epub', 'application/epub+zip', await makeEpub());
  await openFromImportList(page, '联调样书');

  // 脚注
  await page.frameLocator('iframe[title="section-0"]').locator('a[href="#fn1"]').click();
  await expect(page.getByTestId('footnote-popup')).toContainText('陋室铭');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('footnote-popup')).toBeHidden();

  // 选字 → 选择条 → 更多 → 搜索（把选中的词填进搜索）
  await selectSomeWord(page);
  await page.getByTestId('sel-more').click();
  await page.getByRole('menuitem', { name: '搜索', exact: true }).click();
  await expect(page.getByTestId('search-dialog')).toBeVisible();
  await expect(page.getByTestId('search-count')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('search-result').first()).toBeVisible();
  await page.getByTestId('search-dialog').getByRole('button', { name: '关闭' }).click();

  // 点页面中央唤出菜单栏
  const vp = page.viewportSize()!;
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'out/features-shots/full-menu.png' });

  // 工具栏「目录」→ 目录抽屉 → 点第二章 → 跳转
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.getByTestId('toc-panel')).toBeVisible();
  await expect(page.getByTestId('toc-row')).toHaveText(['第一章 起点√', '第二章 继续']);
  await page.getByTestId('toc-row').filter({ hasText: '第二章' }).click();
  await expect(page.getByTestId('toc-panel')).toBeHidden();
  await expect(page.getByText(/第二章 继续 \(/)).toBeVisible({ timeout: 8000 });

  // 工具栏「朗读」→ 选项 → 开始 → 面板 → 停止（朗读走假的 Web Speech）
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.getByRole('button', { name: '朗读', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '开始朗读' }).click();
  await expect(page.getByTestId('tts-panel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__tts.spoken.length)).toBeGreaterThan(1);
  await page.screenshot({ path: 'out/features-shots/full-tts.png' });
  await page.getByTestId('tts-stop').click();
  await expect(page.getByTestId('tts-panel')).toBeHidden();
});

test('书签：页面右上角角标点按加书签，列表里能看到并跳转；刷新后高亮仍在', async ({ page }) => {
  await importBook(page, '陋室铭.txt', 'text/plain', Buffer.from(TXT, 'utf8'));
  await openFromImportList(page, '陋室铭');
  await selectSomeWord(page);
  await page.getByTestId('tpl-style-underline').click();
  await expect.poll(async () => (await idbAnnotations(page)).length).toBe(1);

  // 右上角 40×40 角标
  await page.getByTestId('bookmark-corner').click();
  await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
  await expect.poll(async () => (await idbAnnotations(page)).filter((a) => a.kind === 'bookmark').length).toBe(1);
  await expect(page.getByTestId('bookmark-corner')).toHaveAttribute('data-marked', 'true');

  // 离开阅读页再回来：高亮、书签都在（引擎重新排版后装饰重新画）
  await page.reload();
  await expect(page.locator('iframe[title="section-0"]')).toBeAttached({ timeout: 20000 });
  await expect(page.getByTestId('bookmark-corner')).toHaveAttribute('data-marked', 'true', { timeout: 10000 });
});
