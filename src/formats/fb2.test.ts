import './testing/dom-shim';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { ReflowableBook } from '@/core/book';
import { textOfHtml } from '@/core/text';
import { UnsupportedFormatError, fmtMsg } from './errors';
import { detectFormat, openBook, probeBook } from './index';
import { PNG_1PX, asFile, encodeLegacy, u8 } from './testing/builders';
import { useBlobUrls } from './testing/blob-urls';

const urls = useBlobUrls();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

const FB2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
 <title-info><genre>sf</genre><genre>adventure</genre>
  <author><first-name>夏</first-name><middle-name>目</middle-name><last-name>漱石</last-name></author>
  <author><nickname>匿名</nickname></author>
  <book-title>测试之书</book-title>
  <annotation><p>第一行简介</p><p>第二行简介</p></annotation>
  <date value="2001-02-03">2001</date><lang>zh</lang><sequence name="系列甲" number="2"/>
  <coverpage><image l:href="#cover.png"/></coverpage>
 </title-info>
 <publish-info><publisher>某社</publisher><year>1999</year><isbn>978-7-5442-4829-2</isbn></publish-info>
</description>
<body>
 <title><p>全书标题</p></title>
 <epigraph><p>题词</p><text-author>某人</text-author></epigraph>
 <section id="s1"><title><p>第一章</p></title>
  <p>正文<strong>粗</strong><emphasis>斜</emphasis>注<a l:href="#n1" type="note">[1]</a>，<a l:href="#s2">跳转</a>，<a l:href="https://example.com">外链</a>，<a l:href="javascript:alert(1)">坏链</a>。</p>
  <empty-line/>
  <poem><stanza><v>诗行一</v><v>诗行二</v></stanza></poem>
  <image l:href="#pic.png"/>
  <section id="s1a"><title><p>一节</p></title><p>嵌套节正文。</p></section>
 </section>
 <section id="s2"><title><p>第二章</p></title><p>第二章正文。</p><table><tr><th>头</th><td colspan="2">格</td></tr></table></section>
</body>
<body name="notes"><section id="n1"><title><p>1</p></title><p>脚注一的内容</p></section></body>
<binary id="cover.png" content-type="image/png">${b64(PNG_1PX)}</binary>
<binary id="pic.png" content-type="image/png">${b64(PNG_1PX)}</binary>
</FictionBook>`;

const open = (data: string | Uint8Array, name = 'a.fb2') => openBook(asFile(new Blob([typeof data === 'string' ? u8(data) : data] as BlobPart[]), name), { fileName: name }) as Promise<ReflowableBook>;

describe('FB2（FMT-012）', () => {
  it('识别格式：.fb2 / .fb2.zip / 文件头', () => {
    expect(detectFormat('a.fb2')?.format).toBe('fb2');
    expect(detectFormat('a.fb2.zip')?.format).toBe('fb2');
    expect(detectFormat('noext', u8('<?xml version="1.0"?><FictionBook>'))?.format).toBe('fb2');
  });

  it('元数据：作者（多种写法）、简介、类别、系列、日期、出版信息、ISBN', async () => {
    const b = await open(FB2);
    expect(b.metadata).toMatchObject({
      title: '测试之书',
      authors: ['夏 目 漱石', '匿名'],
      description: '第一行简介\n第二行简介',
      subjects: ['sf', 'adventure'],
      series: '系列甲',
      seriesIndex: 2,
      published: '2001-02-03',
      language: 'zh',
      publisher: '某社',
      identifiers: { isbn: '9787544248292' },
    });
  });

  it('章节 = 嵌套 section 树；书前内容与脚注各成一章；目录带层级', async () => {
    const b = await open(FB2);
    expect(b.toc.map((t) => [t.title, t.level])).toEqual([
      ['全书标题', 0],
      ['第一章', 0],
      ['一节', 1],
      ['第二章', 0],
      [fmtMsg('footnotes'), 0],
    ]);
    expect(b.sections.map((s) => s.title)).toEqual(['全书标题', '第一章', '一节', '第二章', fmtMsg('footnotes')]);
    expect(b.sections.every((s) => s.linear)).toBe(true);
    for (const s of b.sections) expect(textOfHtml((await s.load()).bodyHtml).length).toBe(s.charCount);
  });

  it('内联样式、诗、图片、表格；脚注链接带 epub:type；坏链接/外链处理', async () => {
    const b = await open(FB2);
    const c = await b.sections[1].load();
    expect(c.bodyHtml).toContain('<strong>粗</strong>');
    expect(c.bodyHtml).toContain('<em>斜</em>');
    expect(c.bodyHtml).toMatch(/<a[^>]*href="#n1"[^>]*epub:type="noteref"/);
    expect(c.bodyHtml).toContain('href="https://example.com"');
    expect(c.bodyHtml).not.toContain('javascript');
    expect(c.bodyHtml).toContain('诗行一');
    expect(c.styles.join('')).toContain('.fb2-poem');
    // 图片：<binary> base64 → blob:
    const src = /<img[^>]*src="(blob:[^"]+)"/.exec(c.bodyHtml)?.[1];
    expect(src).toBeTruthy();
    expect((await urls.made.get(src!)!.arrayBuffer()).byteLength).toBe(PNG_1PX.length);
    const t = (await b.sections[3].load()).bodyHtml;
    expect(t).toContain('<table');
    expect(t).toContain('colspan="2"');
  });

  it('脚注：getFootnote 返回正文；resolveHref 跨章节', async () => {
    const b = await open(FB2);
    expect(await b.getFootnote!('#n1', 1)).toContain('脚注一的内容');
    expect(b.resolveHref('#s2', 1)).toEqual({ section: 3, anchor: 's2' });
    expect(b.resolveHref('#s1a', 1)?.section).toBe(2);
    expect(b.resolveHref('#nope', 1)).toBeNull();
    expect(b.resolveHref('http://x.y', 1)).toBeNull();
    expect(await b.getFootnote!('http://x.y', 1)).toBeNull();
  });

  it('封面取 coverpage 指向的 binary', async () => {
    const b = await open(FB2);
    const cover = await b.getCover();
    expect(cover?.type).toBe('image/png');
    expect(cover?.size).toBe(PNG_1PX.length);
  });

  it('.fb2.zip 与伪装成 .fb2 的 zip', async () => {
    const zipped = zipSync({ 'inner.fb2': strToU8(FB2) });
    expect((await open(zipped, 'a.fb2.zip')).metadata.title).toBe('测试之书');
    expect((await open(zipped, 'a.fb2')).metadata.title).toBe('测试之书');
    await expect(open(zipSync({ 'x.txt': strToU8('x') }), 'a.fb2.zip')).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('XML 声明的非 UTF-8 编码（windows-1251 / gbk）', async () => {
    const ru = '<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><author><first-name>Лев</first-name><last-name>Толстой</last-name></author><book-title>Война и мир</book-title></title-info></description><body><section><p>Текст</p></section></body></FictionBook>';
    const b = await open(encodeLegacy(ru, 'windows-1251'));
    expect(b.metadata).toMatchObject({ title: 'Война и мир', authors: ['Лев Толстой'] });
    const zh = '<?xml version="1.0" encoding="gbk"?><FictionBook><description><title-info><book-title>中文书名</book-title></title-info></description><body><section><p>正文</p></section></body></FictionBook>';
    expect((await open(encodeLegacy(zh, 'gbk'))).metadata.title).toBe('中文书名');
  });

  it('没有元数据 → 文件名；不是 FB2 → UnsupportedFormatError', async () => {
    const b = await open('<FictionBook><body><section><p>x</p></section></body></FictionBook>', '书名 - 作者.fb2');
    expect(b.metadata).toMatchObject({ title: '书名', authors: ['作者'] });
    await expect(open('<html><body>nope</body></html>')).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('probe：元数据、封面、字数', async () => {
    const p = await probeBook(asFile(new Blob([u8(FB2)] as BlobPart[]), 'a.fb2'), { fileName: 'a.fb2' });
    expect(p).toMatchObject({ format: 'fb2', metadata: { title: '测试之书' } });
    expect(p.cover?.type).toBe('image/png');
    expect(p.size?.chars).toBeGreaterThan(10);
  });

  it('destroy 回收 blob URL', async () => {
    const b = await open(FB2);
    await b.sections[1].load();
    expect(urls.made.size).toBeGreaterThan(0);
    b.destroy();
    expect(urls.revoked.length).toBe(urls.made.size);
  });
});
