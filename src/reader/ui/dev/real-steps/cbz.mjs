// 固定版式（真实引擎 + 真实 CBZ 解析）：缩略图条、PDF/漫画选项、页码、翻页
import { readFileSync } from 'node:fs';
export default async function cbz({ page, base, shot, log }) {
  const bytes = [...readFileSync('/work/moonreader-web/samples/library/Comics/demo.cbz')];
  const id = await page.evaluate(async (bytes) => {
    const { probeBook } = await import('/src/formats/index.ts');
    const { fileFingerprint } = await import('/src/storage/fingerprint.ts');
    const { putBook, putBookFile } = await import('/src/storage/db.ts');
    const file = new File([new Uint8Array(bytes)], 'demo.cbz');
    const id = await fileFingerprint(file);
    const probe = await probeBook(file, { fileName: file.name });
    await putBookFile(id, file);
    await putBook({ id, fileName: file.name, format: probe.format, size: file.size, title: probe.metadata.title || 'demo', authors: [], tags: [], addedAt: Date.now(), onShelf: true, hasCover: false, pages: probe.size?.pages });
    return id;
  }, bytes);
  log('cbz id', id);
  await page.goto(`${base}/src/reader/ui/dev/dev.html#/read/${id}`);
  await page.reload();
  await page.waitForTimeout(2000);
  await shot('c01-cbz');
  const status = () => page.evaluate(() => (document.querySelector('[class*="status"]')?.textContent ?? '').replace(/\s+/g, ' '));
  await page.mouse.click(206, 457); // 关点击区示意
  await page.waitForTimeout(500);
  log('status', await status());
  await page.mouse.click(380, 457);
  await page.waitForTimeout(900);
  log('after right tap', await status());
  await page.evaluate(async () => {
    const m = await import('/src/reader/settings.ts');
    m.fixedSettings.set({ pdfShowThumb: true });
  });
  await page.waitForTimeout(1200);
  await shot('c02-cbz-thumbs');
  await page.evaluate(async () => {
    const { openSettings } = await import('/src/reader/ui/settings/open.tsx');
    openSettings('visual');
  });
  await page.waitForTimeout(600);
  await shot('c03-cbz-options');
  log('drawer title', await page.locator('[class*="drawerTitle"]').first().innerText());
}
