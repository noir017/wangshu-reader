// 样书全格式扫一遍：每个样本都能导入、打开、翻两页，全程没有页面错误（截图 sw-<文件名>.png 供人眼核对）。
import { expect, test } from '@playwright/test';
import { collectErrors, errorsOf, importFile, openFromShelf, progressPct, shot, skipClickTip, statusChapter, turn } from './accept.reader.helpers';

const FILES: [string, RegExp | string][] = [
  ['pg11-alice.txt', /pg11|Alice/i],
  ['pg11-alice.html', /Alice/i],
  ['pg11-alice.mobi', /Alice/i],
  ['pg11-alice.kf8.mobi', /Alice/i],
  ['sample.fb2', /./],
  ['sample.fb2.zip', /./],
  ['sample-ru-cp1251.fb2', /./],
  ['sample.md', /./],
  ['sample.docx', /./],
  ['sample.odt', /./],
  ['sample.rtf', /./],
  ['sample.umd', /./],
  ['sample-palmdoc.prc', /./],
  ['hlm-trad-big5.txt', /./],
  ['hlm-simp-gbk.txt', /./],
  ['aozora-kokoro.zip', /./],
  ['sample.cbz', /./],
  ['sample-manga-rtl.cbz', /./],
  ['zip-images-only.zip', /./],
  ['tracemonkey.pdf', /./],
  ['pg24264-hongloumeng.epub', /./],
];
for (const [file, title] of FILES) {
  test(`${file}：导入、打开、翻页无报错`, async ({ page }) => {
    test.setTimeout(60000);
    collectErrors(page);
    await skipClickTip(page);
    await importFile(page, file);
    await openFromShelf(page).catch(async (e) => { await shot(page, `sw-${file}-fail`); throw e; });
    const c0 = await statusChapter(page);
    const p0 = await progressPct(page);
    await turn(page); await turn(page);
    const c1 = await statusChapter(page);
    const p1 = await progressPct(page);
    await shot(page, `sw-${file}`);
    console.log(`${file}: [${c0}] ${p0}% -> [${c1}] ${p1}%`);
    expect(errorsOf(page), JSON.stringify(errorsOf(page))).toEqual([]);
  });
}
