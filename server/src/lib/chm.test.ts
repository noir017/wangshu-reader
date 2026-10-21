// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { writeZip } from '../test-fixtures';
import { find7z } from '../util/exec';
import { tmp } from '../test-utils';
import { chmEncoding, convertChmToEpub, decodeChmText, decodeEntities, htmlToXhtml, makeLinkResolver, parseChmSystem, parseHhc } from './chm';

const has7z = !!find7z();

/** 小端 #SYSTEM 记录 */
function sysRec(code: number, data: Buffer): Buffer {
  const h = Buffer.alloc(4);
  h.writeUInt16LE(code, 0);
  h.writeUInt16LE(data.length, 2);
  return Buffer.concat([h, data]);
}
const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]);
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

// 没有现成的 GBK 编码器：这几个汉字的 GBK 字节写死
const GBK = { 中文: Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), 第一章: Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]), 你好: Buffer.from([0xc4, 0xe3, 0xba, 0xc3]) };

describe('CHM 文本编码', () => {
  it('#SYSTEM：目录文件、首页、标题、语言 ID', () => {
    const buf = Buffer.concat([u32(3), sysRec(0, cstr('toc.hhc')), sysRec(2, cstr('index.htm')), sysRec(3, cstr('Title')), sysRec(4, u32(0x0804))]);
    expect(parseChmSystem(buf)).toEqual({ hhc: 'toc.hhc', home: 'index.htm', title: 'Title', lcid: 0x0804 });
    expect(parseChmSystem(Buffer.alloc(2))).toEqual({});
  });

  it('语言 ID → 编码：简中 GBK、繁中 Big5、日 Shift_JIS、未知退回 windows-1252', () => {
    expect(chmEncoding(0x0804)).toEqual({ encoding: 'gbk', lang: 'zh-CN' });
    expect(chmEncoding(0x0404).encoding).toBe('big5');
    expect(chmEncoding(0x0411).encoding).toBe('shift_jis');
    expect(chmEncoding(0x7f).encoding).toBe('windows-1252');
    expect(chmEncoding(undefined).lang).toBe('en');
  });

  it('decodeChmText：BOM、meta charset、合法 UTF-8、再退回 CHM 语言编码', () => {
    expect(decodeChmText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('你好')]), 'gbk')).toBe('你好');
    const meta = Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=gb2312"><p>'), GBK.你好]);
    expect(decodeChmText(meta, 'windows-1252')).toContain('你好');
    expect(decodeChmText(Buffer.from('<p>你好</p>'), 'gbk')).toBe('<p>你好</p>');
    expect(decodeChmText(Buffer.concat([Buffer.from('<p>'), GBK.你好, Buffer.from('</p>')]), 'gbk')).toBe('<p>你好</p>');
  });
});

describe('.hhc 目录', () => {
  it('解析嵌套 UL/LI/OBJECT，Name/Local 参数、实体解码、同名参数取第一个', () => {
    const hhc = `<HTML><BODY><OBJECT type="text/site properties"><param name="ImageType" value="Folder"></OBJECT>
<UL>
 <LI><OBJECT type="text/sitemap"><param name="Name" value="Chapter &amp; One"><param name="Local" value="ch1.htm"></OBJECT>
 <UL>
  <LI><OBJECT type="text/sitemap"><param name="Name" value="Section 1.1"><param name="Local" value="ch1.htm#s11"></OBJECT>
  <LI><OBJECT type="text/sitemap"><param name="Name" value="Section 1.2"><param name="Local" value="ch1b.htm"><param name="Local" value="other.htm"></OBJECT>
 </UL>
 <LI><OBJECT type="text/sitemap"><param name="Name" value="Chapter Two"><param name="Local" value="ch2.htm"></OBJECT>
</UL></BODY></HTML>`;
    const toc = parseHhc(hhc);
    expect(toc.map((n) => n.title)).toEqual(['Chapter & One', 'Chapter Two']);
    expect(toc[0].children.map((n) => [n.title, n.local])).toEqual([['Section 1.1', 'ch1.htm#s11'], ['Section 1.2', 'ch1b.htm']]);
    expect(toc[1].children).toEqual([]);
  });

  it('decodeEntities：数字与具名实体，未知实体原样', () => {
    expect(decodeEntities('&#20013;&#x6587;&amp;&nbsp;&bogus;')).toBe('中文&\u00a0&bogus;');
  });
});

describe('链接改写与 XHTML 序列化', () => {
  it('链接按大小写不敏感匹配包内文件，保留锚点，外链不动，ms-its 链接按根路径', () => {
    const r = makeLinkResolver(['Docs/Page One.HTM', 'img/Pic.PNG', 'top.htm']);
    expect(r('Docs/a.htm', 'page%20one.htm#x')).toBe('Page%20One.HTM#x');
    expect(r('Docs/a.htm', '../IMG/pic.png')).toBe('../img/Pic.PNG');
    expect(r('Docs/a.htm', 'http://example.com/x')).toBe('http://example.com/x');
    expect(r('Docs/a.htm', '#top')).toBe('#top');
    expect(r('Docs/a.htm', 'ms-its:x.chm::/TOP.htm')).toBe('../top.htm');
    expect(r('Docs/a.htm', 'missing.htm')).toBe('missing.htm');
  });

  it('把脏 HTML 变成良构 XHTML：去脚本/事件属性、void 标签自闭合、<a name> 补 id', () => {
    const { xhtml, title } = htmlToXhtml(
      '<html><head><title>T &amp; U</title><script>alert(1)</script><link rel="stylesheet" href="s.css"></head><body class="b" onload="x()"><P>one<br><IMG SRC=a.png onerror=y><a name=anchor>x</a><p>unclosed <b>bold<script>evil()</script></body></html>',
      'a.htm',
      (_p, u) => u,
      'en',
    );
    expect(title).toBe('T & U');
    expect(xhtml).not.toMatch(/script|onload|onerror|alert|evil/);
    expect(xhtml).toContain('<br/>');
    expect(xhtml).toContain('<img src="a.png"/>');
    expect(xhtml).toContain('<a name="anchor" id="anchor">x</a>');
    expect(xhtml).toContain('<link rel="stylesheet" type="text/css" href="s.css"/>');
    expect(xhtml).toContain('<body class="b">');
  });
});

describe.skipIf(!has7z)('CHM → EPUB 整体流程', () => {
  it('GBK 编码的页面与目录：按语言 ID 解码成 UTF-8，目录层级、链接、资源齐全', async () => {
    const dir = tmp();
    const sys = Buffer.concat([u32(3), sysRec(0, cstr('toc.hhc')), sysRec(2, cstr('Index.htm')), sysRec(3, GBK.中文), sysRec(4, u32(0x0804))]);
    const hhc = Buffer.concat([
      Buffer.from('<UL><LI><OBJECT type="text/sitemap"><param name="Name" value="'),
      GBK.第一章,
      Buffer.from('"><param name="Local" value="CH1.HTM"></OBJECT><UL><LI><OBJECT type="text/sitemap"><param name="Name" value="sub"><param name="Local" value="ch1.htm#sec"></OBJECT></UL></UL>'),
    ]);
    const page = (body: Buffer) => Buffer.concat([Buffer.from('<html><head><title>'), GBK.中文, Buffer.from('</title></head><body>'), body, Buffer.from('</body></html>')]);
    const chm = path.join(dir, 'book.chm');
    // 7z 能打开 zip，用 zip 容器模拟 CHM 解包后的目录结构（真 CHM 的样本在 samples/chm，见下一个用例）
    await writeZip(chm, [
      { name: '#SYSTEM', data: sys },
      { name: 'toc.hhc', data: hhc },
      { name: 'Index.htm', data: page(Buffer.concat([GBK.你好, Buffer.from('<a href="ch1.htm#sec">go</a><img src="PIC/a.png">')])) },
      { name: 'ch1.htm', data: page(Buffer.concat([Buffer.from('<a name="sec"></a>'), GBK.第一章])) },
      { name: 'pic/a.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      { name: 'style.css', data: '@charset "utf-8";body{}' },
    ]);
    const out = path.join(dir, 'out.epub');
    const work = path.join(dir, 'work');
    const res = await convertChmToEpub(chm, out, work, { fallbackTitle: 'fallback', maxExtractBytes: 0 });
    expect(res).toMatchObject({ title: '中文', encoding: 'gbk' });
    const files = unzipSync(new Uint8Array(readFileSync(out)));
    const names = Object.keys(files);
    expect(names[0]).toBe('mimetype');
    expect(strFromU8(files.mimetype)).toBe('application/epub+zip');
    for (const n of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/epub-nav.xhtml', 'OEBPS/epub-toc.ncx', 'OEBPS/Index.htm', 'OEBPS/ch1.htm', 'OEBPS/pic/a.png']) expect(names, n).toContain(n);
    expect(names).not.toContain('OEBPS/#SYSTEM');
    expect(names).not.toContain('OEBPS/toc.hhc');
    expect(strFromU8(files['OEBPS/Index.htm'])).toContain('你好');
    expect(strFromU8(files['OEBPS/Index.htm'])).toContain('href="ch1.htm#sec"');
    expect(strFromU8(files['OEBPS/Index.htm'])).toContain('src="pic/a.png"'); // PIC/a.png 被改写成包内真实大小写
    const nav = strFromU8(files['OEBPS/epub-nav.xhtml']);
    expect(nav).toContain('第一章');
    expect(nav).toMatch(/<a href="ch1\.htm">第一章<\/a><ol><li><a href="ch1\.htm#sec">sub<\/a>/);
    const opf = strFromU8(files['OEBPS/content.opf']);
    expect(opf).toContain('<dc:title>中文</dc:title>');
    expect(opf).toContain('<dc:language>zh-CN</dc:language>');
    expect(opf).toMatch(/<spine toc="ncx">\s*<itemref idref="r\d+"\/>/);
  });

  const sample = path.join(process.cwd(), 'samples/chm');
  it.skipIf(!existsSync(path.join(sample, 'putty.chm')))('真实 CHM（samples/chm/putty.chm）：目录层级与页面数', async () => {
    const dir = tmp();
    const out = path.join(dir, 'putty.epub');
    const res = await convertChmToEpub(path.join(sample, 'putty.chm'), out, path.join(dir, 'w'), { fallbackTitle: 'x', maxExtractBytes: 0 });
    expect(res.title).toBe('PuTTY User Manual');
    expect(res.pages).toBeGreaterThan(100);
    expect(res.tocEntries).toBeGreaterThan(100);
    const files = unzipSync(new Uint8Array(readFileSync(out)));
    expect(strFromU8(files['OEBPS/epub-nav.xhtml'])).toContain('<ol><li><a href="index.html">PuTTY User Manual</a>');
  }, 60_000);
});
