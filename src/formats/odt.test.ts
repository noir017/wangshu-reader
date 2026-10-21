import './testing/dom-shim';
import { describe, expect, it } from 'vitest';
import type { ReflowableBook } from '@/core/book';
import { textOfHtml } from '@/core/text';
import { UnsupportedFormatError } from './errors';
import { detectFormat, openBook, probeBook } from './index';
import { PNG_1PX, asFile, zipBlob } from './testing/builders';
import { useBlobUrls } from './testing/blob-urls';

const urls = useBlobUrls();
const NS = 'xmlns:office="o" xmlns:text="t" xmlns:style="s" xmlns:fo="f" xmlns:table="tb" xmlns:draw="d" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="v" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="m"';
const content = (body: string, styles = '') => `<?xml version="1.0"?><office:document-content ${NS}><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
const long = '正文内容。'.repeat(30);

async function odt(body: string, extra: Record<string, string | Uint8Array> = {}, name = 'a.odt', styles = '') {
  const files = { mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': content(body, styles), ...extra };
  return openBook(asFile(await zipBlob(files, { storeFirst: 'mimetype' }), name), { fileName: name }) as Promise<ReflowableBook>;
}

describe('ODT（FMT-015）', () => {
  it('识别格式：扩展名与文件头', async () => {
    expect(detectFormat('a.odt')?.format).toBe('odt');
    const f = await zipBlob({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': content('') }, { storeFirst: 'mimetype' });
    expect(detectFormat('noext', new Uint8Array(await f.arrayBuffer()).subarray(0, 4096))?.format).toBe('odt');
  });

  it('标题 → 目录与章节；样式（粗/斜/下划线/删除线/上下标）', async () => {
    const styles = `<style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="I" style:family="text"><style:text-properties fo:font-style="italic" style:text-underline-style="solid"/></style:style><style:style style:name="Sup" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>`;
    const b = await odt(
      `<text:h text:outline-level="1">第一章</text:h><text:p>甲<text:span text:style-name="B">粗</text:span><text:span text:style-name="I">斜下</text:span><text:span text:style-name="Sup">上</text:span><text:s text:c="2"/>末<text:tab/><text:line-break/>行</text:p><text:p>${long}</text:p><text:h text:outline-level="2">小节</text:h><text:p>${long}</text:p><text:h text:outline-level="1">第二章</text:h><text:p>${long}</text:p>`,
      {},
      'a.odt',
      styles,
    );
    expect(b.sections).toHaveLength(2);
    expect(b.toc.map((t) => [t.title, t.level, t.section])).toEqual([
      ['第一章', 0, 0],
      ['小节', 1, 0],
      ['第二章', 0, 1],
    ]);
    const html = (await b.sections[0].load()).bodyHtml;
    expect(html).toContain('<strong>粗</strong>');
    expect(html).toContain('<u><em>斜下</em></u>');
    expect(html).toContain('<sup>上</sup>');
    expect(html).toContain('<br>');
  });

  it('列表、表格、超链接、书签、图片、脚注', async () => {
    const body =
      `<text:list><text:list-item><text:p>项一</text:p></text:list-item><text:list-item><text:p>项二</text:p></text:list-item></text:list>` +
      `<table:table><table:table-row><table:table-cell><text:p>甲</text:p></table:table-cell><table:table-cell table:number-columns-spanned="2"><text:p>乙</text:p></table:table-cell></table:table-row></table:table>` +
      `<text:p><text:a xlink:href="https://example.com">外链</text:a><text:a xlink:href="javascript:alert(1)">坏链</text:a><text:a xlink:href="#mark">内链</text:a><text:bookmark text:name="mark"/>目标</text:p>` +
      `<text:p><draw:frame><draw:image xlink:href="Pictures/a.png"/></draw:frame></text:p>` +
      `<text:p>脚注<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>脚注内容</text:p></text:note-body></text:note></text:p>`;
    const b = await odt(body, { 'Pictures/a.png': PNG_1PX });
    const html = (await b.sections[0].load()).bodyHtml;
    expect(html).toMatch(/<ul><li><p>项一<\/p><\/li><li><p>项二<\/p><\/li><\/ul>/);
    expect(html).toContain('<table>');
    expect(html).toContain('colspan="2"');
    expect(html).toContain('<a href="https://example.com">外链</a>');
    expect(html).not.toContain('javascript');
    expect(html).toContain('<a href="#mark">内链</a>');
    expect(html).toContain('id="mark"');
    const src = /<img[^>]*src="(blob:[^"]+)"/.exec(html)?.[1];
    expect(urls.made.get(src!)!.type).toBe('image/png');
    expect(html).toContain('epub:type="noteref"');
    expect(await b.getFootnote!('#odtn1', 0)).toContain('脚注内容');
  });

  it('元数据 meta.xml；封面取 Thumbnails/thumbnail.png；文件名兜底', async () => {
    const meta = `<office:document-meta ${NS}><office:meta><dc:title>文档名</dc:title><meta:initial-creator>初作者</meta:initial-creator><dc:creator>改作者</dc:creator><dc:description>简介</dc:description><dc:subject>主题</dc:subject><dc:language>zh-CN</dc:language></office:meta></office:document-meta>`;
    const b = await odt('<text:p>x</text:p>', { 'meta.xml': meta, 'Thumbnails/thumbnail.png': PNG_1PX });
    expect(b.metadata).toMatchObject({ title: '文档名', authors: ['改作者'], description: '简介', subjects: ['主题'], language: 'zh-CN' });
    expect((await b.getCover())?.size).toBe(PNG_1PX.length);
    expect((await odt('<text:p>x</text:p>', {}, '书名 - 作者.odt')).metadata).toMatchObject({ title: '书名', authors: ['作者'] });
  });

  it('charCount 一致；probe 带封面；损坏文件', async () => {
    const b = await odt(`<text:h text:outline-level="1">一</text:h><text:p>${long}</text:p><text:h text:outline-level="1">二</text:h><text:p>${long}</text:p>`);
    for (const s of b.sections) expect(textOfHtml((await s.load()).bodyHtml).length).toBe(s.charCount);
    const f = asFile(await zipBlob({ 'content.xml': content('<text:p>abc def</text:p>'), 'Thumbnails/thumbnail.png': PNG_1PX }), 'a.odt');
    const p = await probeBook(f, { fileName: 'a.odt' });
    expect(p).toMatchObject({ format: 'odt', size: { chars: 2 } });
    expect(p.cover).not.toBeNull();
    await expect(openBook(asFile(await zipBlob({ 'x.txt': 'x' }), 'a.odt'), { fileName: 'a.odt' })).rejects.toBeInstanceOf(UnsupportedFormatError);
  });
});
