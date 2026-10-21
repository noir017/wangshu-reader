import './testing/dom-shim';
import { describe, expect, it } from 'vitest';
import type { ReflowableBook } from '@/core/book';
import { textOfHtml } from '@/core/text';
import { UnsupportedFormatError } from './errors';
import { detectFormat, openBook, probeBook } from './index';
import { PNG_1PX, asFile, zipBlob } from './testing/builders';
import { useBlobUrls } from './testing/blob-urls';

const urls = useBlobUrls();
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const p = (text: string, pr = '') => `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const doc = (body: string) => `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="x" xmlns:a="x" xmlns:pic="x" xmlns:v="x"><w:body>${body}</w:body></w:document>`;
const long = '正文内容。'.repeat(30);

async function docx(body: string, extra: Record<string, string | Uint8Array> = {}, name = 'a.docx') {
  const files: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': doc(body),
    'word/styles.xml': `<w:styles xmlns:w="${W}"><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:styleId="Titulo"><w:name w:val="Custom"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
    ...extra,
  };
  return openBook(asFile(await zipBlob(files), name), { fileName: name }) as Promise<ReflowableBook>;
}

describe('DOCX（FMT-015）', () => {
  it('识别格式', () => {
    expect(detectFormat('a.docx')?.format).toBe('docx');
  });

  it('标题 → 目录与章节；段落、粗斜体下划线上下标', async () => {
    const b = await docx(
      p('第一章', '<w:pStyle w:val="Heading1"/>') +
        `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>粗</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>斜</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>下</w:t></w:r><w:r><w:rPr><w:strike/></w:rPr><w:t>删</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>上</w:t></w:r><w:r><w:t>末</w:t></w:r></w:p>` +
        p(long) +
        p('小节', '<w:pStyle w:val="Heading2"/>') +
        p(long) +
        p('第二章', '<w:pStyle w:val="Heading1"/>') +
        p(long),
    );
    expect(b.sections).toHaveLength(2);
    expect(b.toc.map((t) => [t.title, t.level, t.section])).toEqual([
      ['第一章', 0, 0],
      ['小节', 1, 0],
      ['第二章', 0, 1],
    ]);
    const html = (await b.sections[0].load()).bodyHtml;
    expect(html).toContain('<strong>粗</strong><em>斜</em><u>下</u><s>删</s><sup>上</sup>末');
    expect(html).toContain('<h1');
  });

  it('大纲级别样式也算标题；对齐方式', async () => {
    const b = await docx(p('自定义标题', '<w:pStyle w:val="Titulo"/>') + p('居中', '<w:jc w:val="center"/>') + p('两端', '<w:jc w:val="both"/>'));
    const html = (await b.sections[0].load()).bodyHtml;
    expect(html).toContain('<h1');
    expect(html).toContain('text-align:center');
    expect(html).toContain('text-align:justify');
    expect(b.toc[0].title).toBe('自定义标题');
  });

  it('列表（有序/无序，嵌套）与表格', async () => {
    const num = `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
    const item = (t: string, id: number, lvl = 0) => p(t, `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`);
    const tbl = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const b = await docx(item('一', 1) + item('二', 1) + item('点', 2) + item('子点', 2, 1) + tbl, { 'word/numbering.xml': num });
    const html = (await b.sections[0].load()).bodyHtml;
    expect(html).toMatch(/<ol><li>一<\/li><li>二<\/li><\/ol>/);
    expect(html).toMatch(/<ul><li>点<ul><li>子点<\/li><\/ul><\/li><\/ul>/);
    expect(html).toContain('<table>');
    expect(html).toContain('colspan="2"');
  });

  it('超链接（外部/内部书签）、图片、脚注', async () => {
    const rels = `<Relationships xmlns="x"><Relationship Id="rId1" Target="https://example.com" TargetMode="External"/><Relationship Id="rId2" Target="media/img.png"/><Relationship Id="rId3" Target="javascript:alert(1)" TargetMode="External"/></Relationships>`;
    const body =
      `<w:p><w:hyperlink r:id="rId1"><w:r><w:t>外链</w:t></w:r></w:hyperlink><w:hyperlink r:id="rId3"><w:r><w:t>坏链</w:t></w:r></w:hyperlink><w:hyperlink w:anchor="mark"><w:r><w:t>内链</w:t></w:r></w:hyperlink></w:p>` +
      `<w:p><w:bookmarkStart w:id="0" w:name="mark"/><w:r><w:t>目标</w:t></w:r></w:p>` +
      `<w:p><w:r><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:r></w:p>` +
      `<w:p><w:r><w:t>脚注文</w:t></w:r><w:r><w:footnoteReference w:id="5"/></w:r></w:p>`;
    const foot = `<w:footnotes xmlns:w="${W}"><w:footnote w:id="5"><w:p><w:r><w:t>脚注内容</w:t></w:r></w:p></w:footnote></w:footnotes>`;
    const b = await docx(body, { 'word/_rels/document.xml.rels': rels, 'word/media/img.png': PNG_1PX, 'word/footnotes.xml': foot });
    const html = (await b.sections[0].load()).bodyHtml;
    expect(html).toContain('<a href="https://example.com">外链</a>');
    expect(html).not.toContain('javascript');
    expect(html).toContain('<a href="#mark">内链</a>');
    expect(html).toContain('id="mark"');
    const src = /<img[^>]*src="(blob:[^"]+)"/.exec(html)?.[1];
    expect(src).toBeTruthy();
    expect(urls.made.get(src!)!.type).toBe('image/png');
    expect(html).toContain('epub:type="noteref"');
    expect(html).toContain('脚注内容');
    expect(await b.getFootnote!('#fn5', 0)).toContain('脚注内容');
    expect(b.resolveHref('#mark', 0)).toEqual({ section: 0, anchor: 'mark' });
  });

  it('元数据：docProps/core.xml；否则文件名', async () => {
    const core = `<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>文档标题</dc:title><dc:creator>某作者</dc:creator><dc:description>说明</dc:description><dc:subject>主题</dc:subject></cp:coreProperties>`;
    const a = await docx(p('x'), { 'docProps/core.xml': core });
    expect(a.metadata).toMatchObject({ title: '文档标题', authors: ['某作者'], description: '说明', subjects: ['主题'] });
    const b = await docx(p('x'), {}, '书名 - 作者.docx');
    expect(b.metadata).toMatchObject({ title: '书名', authors: ['作者'] });
  });

  it('charCount 与引擎看到的纯文本一致；probe；损坏文件', async () => {
    const b = await docx(p('第一章', '<w:pStyle w:val="Heading1"/>') + p(long) + p('第二章', '<w:pStyle w:val="Heading1"/>') + p(long));
    for (const s of b.sections) expect(textOfHtml((await s.load()).bodyHtml).length).toBe(s.charCount);
    const f = asFile(await zipBlob({ 'word/document.xml': doc(p('abc def')), 'docProps/core.xml': '<c xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></c>' }), 'a.docx');
    expect(await probeBook(f, { fileName: 'a.docx' })).toMatchObject({ format: 'docx', metadata: { title: 'T' }, cover: null, size: { chars: 2 } });
    await expect(openBook(asFile(await zipBlob({ 'x.txt': 'x' }), 'a.docx'), { fileName: 'a.docx' })).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expect(openBook(asFile(new Blob(['not a zip']), 'a.docx'), { fileName: 'a.docx' })).rejects.toMatchObject({ code: 'corrupt' });
  });
});
