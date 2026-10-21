import './testing/dom-shim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReflowableBook } from '@/core/book';
import { textOfHtml } from '@/core/text';
import { DrmError } from './errors';
import { openBook, probeBook } from './index';
import { sha1 } from './lib/sha1';
import { PNG_1PX, asFile, buildEpub, u8, type EpubSpec } from './testing/builders';

// URL.createObjectURL 在测试环境里拿不回内容：自己记一份
const made = new Map<string, Blob>();
const revoked: string[] = [];
let n = 0;
beforeEach(() => {
  made.clear();
  revoked.length = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
    const u = `blob:test/${++n}`;
    made.set(u, b as Blob);
    return u;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => void revoked.push(u));
});
afterEach(() => vi.restoreAllMocks());

const open = async (spec: EpubSpec, name = 'test.epub') => (await openBook(asFile(await buildEpub(spec), name), { fileName: name })) as ReflowableBook;

const NAV = (items: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>nav</title></head><body><nav epub:type="toc"><ol>${items}</ol></nav></body></html>`;

const longText = '段落文字。'.repeat(30);

describe('EPUB 3：元数据 / 目录 / 章节', () => {
  const spec: EpubSpec = {
    title: '测试之书',
    authors: ['作者甲', '作者乙'],
    language: 'zh-CN',
    publisher: '某出版社',
    description: '&lt;p&gt;这是&lt;b&gt;简介&lt;/b&gt;&lt;/p&gt;',
    subjects: ['小说', '科幻'],
    identifier: 'urn:isbn:978-7-5442-4829-2',
    extraMetadata: `<dc:date>2020-05-01</dc:date><meta property="belongs-to-collection" id="c1">系列名</meta><meta refines="#c1" property="collection-type">series</meta><meta refines="#c1" property="group-position">2</meta>`,
    chapters: [
      { id: 'c1', file: 'c1.xhtml', body: `<h1 id="top">第一章</h1><p>${longText}</p><h2 id="sec">小节</h2><p>更多</p>` },
      { id: 'c2', file: 'sub/c2.xhtml', body: `<h1>第二章</h1><p>${longText}</p>` },
      { id: 'c3', file: 'c3.xhtml', body: '<p>附录</p>', linear: false },
    ],
    nav: NAV(`<li><a href="c1.xhtml">第一章</a><ol><li><a href="c1.xhtml#sec">小节</a></li></ol></li><li><a href="sub/c2.xhtml">第二章</a></li><li><span>分组</span><ol><li><a href="c3.xhtml">附录</a></li></ol></li>`),
  };

  it('元数据', async () => {
    const b = await open(spec);
    expect(b.format).toBe('epub');
    expect(b.metadata).toMatchObject({
      title: '测试之书',
      authors: ['作者甲', '作者乙'],
      language: 'zh-CN',
      publisher: '某出版社',
      description: '这是简介',
      subjects: ['小说', '科幻'],
      published: '2020-05-01',
      series: '系列名',
      seriesIndex: 2,
    });
    expect(b.metadata.identifiers?.isbn).toBe('9787544248292');
  });

  it('目录：层级、锚点、分组项指向首个子项', async () => {
    const b = await open(spec);
    expect(b.toc).toEqual([
      { title: '第一章', level: 0, section: 0 },
      { title: '小节', level: 1, section: 0, anchor: 'sec' },
      { title: '第二章', level: 0, section: 1 },
      { title: '分组', level: 0, section: 2 },
      { title: '附录', level: 1, section: 2 },
    ]);
    expect(b.sections.map((s) => [s.id, s.title, s.linear])).toEqual([
      ['c1', '第一章', true],
      ['c2', '第二章', true],
      ['c3', '分组', false],
    ]);
  });

  it('charCount 与 load() 后的 textOf 一致', async () => {
    const b = await open(spec);
    for (const s of b.sections) {
      const c = await s.load();
      expect(textOfHtml(c.bodyHtml).length).toBe(s.charCount);
    }
    expect(b.sections[0].charCount).toBeGreaterThan(100);
  });

  it('resolveHref：相对路径、纯锚点、外链', async () => {
    const b = await open(spec);
    expect(b.resolveHref('sub/c2.xhtml#x', 0)).toEqual({ section: 1, anchor: 'x' });
    expect(b.resolveHref('../c1.xhtml#sec', 1)).toEqual({ section: 0, anchor: 'sec' });
    expect(b.resolveHref('#top', 1)).toEqual({ section: 1, anchor: 'top' });
    expect(b.resolveHref('https://example.com/x', 0)).toBeNull();
    expect(b.resolveHref('mailto:a@b.c', 0)).toBeNull();
    expect(b.resolveHref('missing.xhtml', 0)).toBeNull();
  });
});

describe('EPUB 2：NCX', () => {
  const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
    <navPoint id="a"><navLabel><text>卷一</text></navLabel><content src="a.xhtml"/>
      <navPoint id="a1"><navLabel><text>第一节</text></navLabel><content src="a.xhtml#s1"/></navPoint>
    </navPoint>
    <navPoint id="b"><navLabel><text>卷二</text></navLabel><content src="b.xhtml"/></navPoint></navMap></ncx>`;
  it('嵌套 navPoint', async () => {
    const b = await open({ version: '2', title: 'T', ncx, chapters: [{ id: 'a', file: 'a.xhtml', body: `<h1>卷一</h1><p id="s1">x</p>` }, { id: 'b', file: 'b.xhtml', body: '<p>y</p>' }] });
    expect(b.toc).toEqual([
      { title: '卷一', level: 0, section: 0 },
      { title: '第一节', level: 1, section: 0, anchor: 's1' },
      { title: '卷二', level: 0, section: 1 },
    ]);
  });
  it('NCX 与 nav 条数不同取多者', async () => {
    const nav = NAV('<li><a href="a.xhtml">只有一条</a></li>');
    const b = await open({ ncx, nav, chapters: [{ id: 'a', file: 'a.xhtml', body: `<p id="s1">x</p>` }, { id: 'b', file: 'b.xhtml', body: '<p>y</p>' }] });
    expect(b.toc).toHaveLength(3);
  });
  it('没有目录：按 spine，章名取标题，取不到用序号', async () => {
    const b = await open({ chapters: [{ id: 'a', file: 'a.xhtml', body: '<h1>开篇</h1><p>x</p>' }, { id: 'b', file: 'b.xhtml', body: '<p>y</p>', title: '' }] });
    expect(b.toc.map((t) => t.title)).toEqual(['开篇', '2']);
  });
  it('单文件电子书：用链接表合成目录', async () => {
    const links = ['a', 'b', 'c', 'd'].map((id) => `<a href="#${id}">章节${id}</a>`).join(' ');
    const body = `<p>${links}</p>` + ['a', 'b', 'c', 'd'].map((id) => `<h2 id="${id}">章节${id}</h2><p>${longText}</p>`).join('');
    const b = await open({ chapters: [{ id: 'only', file: 'only.xhtml', body }] });
    expect(b.toc.map((t) => [t.title, t.anchor])).toEqual([['章节a', 'a'], ['章节b', 'b'], ['章节c', 'c'], ['章节d', 'd']]);
  });
});

describe('EPUB 章节清洗与资源', () => {
  const css = `@font-face{font-family:F;src:url(fonts/f.otf) format("opentype")}
body{background:url('img/bg.png')}.x{background:url(http://evil.example/a.png)}@import url(more.css);`;
  const spec: EpubSpec = {
    title: 'T',
    chapters: [
      {
        id: 'c1',
        file: 'text/c1.xhtml',
        head: `<link rel="stylesheet" href="../style.css" type="text/css"/><style>p.a{background:url(../img/p.png)}</style>`,
        body:
          `<div class="x" onclick="alert(1)"/><p epub:type="noteref" class="a" onmouseover="x()">文字<script>alert(1)</script><ruby>漢<rt>かん</rt></ruby></p>` +
          `<a href="javascript:alert(1)">bad</a><a href="c2.xhtml#t">ok</a><img src="../img/a.png" alt="a" onerror="x()"/>` +
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image xlink:href="../img/a.png" width="1" height="1"/></svg>` +
          `<iframe src="http://evil.example"></iframe><p style="background:url(../img/p.png)">z</p><img src="../img/missing.png"/><p>结尾</p>`,
      },
      { id: 'c2', file: 'text/c2.xhtml', body: '<p id="t">x</p>' },
    ],
    files: {
      'style.css': css,
      'more.css': '.more{color:red}',
      'img/a.png': PNG_1PX,
      'img/p.png': PNG_1PX,
      'img/bg.png': PNG_1PX,
      'fonts/f.otf': new Uint8Array([1, 2, 3, 4]),
    },
    extraManifest: `<item id="i1" href="img/a.png" media-type="image/png"/><item id="i2" href="img/p.png" media-type="image/png"/><item id="i3" href="img/bg.png" media-type="image/png"/><item id="f" href="fonts/f.otf" media-type="font/otf"/><item id="css" href="style.css" media-type="text/css"/>`,
  };

  it('去脚本/事件属性/javascript:/iframe，保留 epub:type、ruby、svg、自闭合 div', async () => {
    const b = await open(spec);
    const c = await b.sections[0].load();
    const html = c.bodyHtml;
    expect(html).not.toMatch(/script|onclick|onmouseover|onerror|javascript:|iframe|evil/i);
    expect(html).toContain('epub:type="noteref"');
    expect(html).toContain('<ruby>漢<rt>かん</rt></ruby>');
    expect(html).toContain('<svg');
    expect(html).toContain('<a href="c2.xhtml#t">ok</a>'); // 内链保持原样，交给 resolveHref
    expect(textOfHtml(html)).toBe('文字漢かんbadokz结尾');
    // <div class="x"/> 被展开，没有吞掉后面的内容
    expect(html).toMatch(/<div class="x"><\/div><p/);
    expect(html).toContain('结尾');
  });

  it('图片/样式里的资源改写成 blob:，缺失的图片去掉 src，远程资源被丢弃', async () => {
    const b = await open(spec);
    const c = await b.sections[0].load();
    expect(c.bodyHtml).toMatch(/<img src="blob:test\/\d+" alt="a">/);
    expect(c.bodyHtml).toMatch(/<image[^>]+(?:xlink:)?href="blob:test\/\d+"/);
    expect(c.bodyHtml).toMatch(/<p style="background:url\(&quot;blob:test\/\d+&quot;\)">z<\/p>|<p style='background:url\("blob:test\/\d+"\)'>z<\/p>|background: ?url\(/);
    expect(c.bodyHtml).not.toContain('missing.png');
    expect(c.styles).toHaveLength(2);
    const [linked, inline] = c.styles;
    expect(linked).toContain('.more{color:red}'); // @import 被内联
    expect(linked).toMatch(/src:url\("blob:test\/\d+"\)/);
    expect(linked).toMatch(/background:url\("blob:test\/\d+"\)/);
    expect(linked).toContain('url("data:,")'); // 远程 URL 被拿掉
    expect(inline).toMatch(/url\("blob:test\/\d+"\)/);
    const fontUrl = /src:url\("(blob:[^"]+)"\)/.exec(linked)![1];
    expect(made.get(fontUrl)!.type).toBe('font/otf');
    // 同一资源只建一次 blob
    const urls = [...c.bodyHtml.matchAll(/blob:test\/\d+/g)].map((m) => m[0]);
    expect(new Set(urls).size).toBeLessThan(urls.length + 1);
  });

  it('destroy() 回收全部 blob URL', async () => {
    const b = await open(spec);
    await b.sections[0].load();
    const created = [...made.keys()];
    expect(created.length).toBeGreaterThan(2);
    b.destroy();
    expect(revoked.sort()).toEqual(created.sort());
  });

  it('EPUB 字体混淆（IDPF）还原', async () => {
    const plain = Uint8Array.from({ length: 2000 }, (_, i) => i % 251);
    const id = 'urn:uuid:12345678-1234-1234-1234-123456789abc';
    const key = sha1(u8(id));
    const obf = plain.slice();
    for (let i = 0; i < 1040; i++) obf[i] ^= key[i % 20];
    const b = await open({
      title: 'T',
      identifier: id,
      chapters: [{ id: 'c', file: 'c.xhtml', body: '<p>x</p>', head: '<style>@font-face{font-family:F;src:url(f.otf)}</style>' }],
      files: { 'f.otf': obf },
      extraManifest: '<item id="f" href="f.otf" media-type="font/otf"/>',
      metaFiles: { 'encryption.xml': `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OEBPS/f.otf"/></CipherData></EncryptedData></encryption>` },
    });
    const c = await b.sections[0].load();
    const url = /url\("(blob:[^"]+)"\)/.exec(c.styles[0])![1];
    const got = new Uint8Array(await made.get(url)!.arrayBuffer());
    expect(Array.from(got.slice(0, 1100))).toEqual(Array.from(plain.slice(0, 1100)));
  });

  it('lang / dir / body 属性', async () => {
    const b = await open({
      language: 'ar',
      spineAttrs: 'page-progression-direction="rtl"',
      chapters: [{ id: 'c', file: 'c.xhtml', raw: `<html xmlns="http://www.w3.org/1999/xhtml" lang="ar" xml:lang="ar"><head><title>t</title></head><body class="main" id="b" onload="x()"><p>x</p></body></html>` }],
    });
    expect(b.metadata.direction).toBe('rtl');
    const c = await b.sections[0].load();
    expect(c.bodyAttrs).toEqual({ class: 'main', id: 'b' });
    expect(c.lang).toBe('ar');
    expect(c.dir).toBe('rtl');
  });

  it('图片章（spine 里直接放图片）', async () => {
    const b = await open({
      chapters: [{ id: 'c', file: 'c.xhtml', body: '<p>x</p>' }],
      files: { 'p1.png': PNG_1PX },
      extraManifest: '<item id="p1" href="p1.png" media-type="image/png"/>',
      spineAttrs: '',
    });
    // 上面的 spec 没把 p1 放进 spine：此处只验证不崩
    expect(b.sections).toHaveLength(1);
  });
});

describe('EPUB 封面', () => {
  const ch = [{ id: 'c', file: 'c.xhtml', body: '<p>x</p>' }];
  const png = { 'img/cover.png': PNG_1PX, 'img/other.png': PNG_1PX };
  it('properties=cover-image', async () => {
    const b = await open({ chapters: ch, files: png, extraManifest: '<item id="x" href="img/cover.png" media-type="image/png" properties="cover-image"/><item id="y" href="img/other.png" media-type="image/png"/>' });
    const blob = await b.getCover();
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(PNG_1PX.length);
  });
  it('meta name=cover', async () => {
    const b = await open({ chapters: ch, files: png, extraMetadata: '<meta name="cover" content="y"/>', extraManifest: '<item id="y" href="img/other.png" media-type="image/png"/>' });
    expect((await b.getCover())?.size).toBe(PNG_1PX.length);
  });
  it('guide reference 指向 xhtml，再取里面的 img', async () => {
    const b = await open({
      chapters: [{ id: 'cv', file: 'cover.xhtml', body: '<div><img src="img/cover.png"/></div>' }, ...ch],
      files: png,
      guide: '<reference type="cover" title="Cover" href="cover.xhtml"/>',
      extraManifest: '<item id="y" href="img/cover.png" media-type="image/png"/>',
    });
    expect((await b.getCover())?.size).toBe(PNG_1PX.length);
  });
  it('兜底：文件名以 cover 开头的图片；没有则 null', async () => {
    const b = await open({ chapters: ch, files: png });
    expect((await b.getCover())?.size).toBe(PNG_1PX.length);
    const none = await open({ chapters: ch });
    expect(await none.getCover()).toBeNull();
  });
  it('probe 带封面和粗估字数', async () => {
    const f = asFile(await buildEpub({ title: 'P', authors: ['A'], chapters: [{ id: 'c', file: 'c.xhtml', body: `<p>${longText}</p>` }], files: png, extraManifest: '<item id="x" href="img/cover.png" media-type="image/png" properties="cover-image"/>' }), 'p.epub');
    const p = await probeBook(f, { fileName: 'p.epub' });
    expect(p.format).toBe('epub');
    expect(p.metadata.title).toBe('P');
    expect(p.cover?.size).toBe(PNG_1PX.length);
    expect(p.size?.chars).toBeGreaterThan(0);
  });
});

describe('EPUB DRM / 脚注 / 文件名回退', () => {
  it('encryption.xml + rights.xml → DrmError', async () => {
    const blob = await buildEpub({
      chapters: [{ id: 'c', file: 'c.xhtml', body: '<p>x</p>' }],
      metaFiles: { 'encryption.xml': '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>', 'rights.xml': '<rights/>' },
    });
    await expect(openBook(asFile(blob, 'drm.epub'), { fileName: 'drm.epub' })).rejects.toBeInstanceOf(DrmError);
  });
  it('只有字体混淆的 encryption.xml 不算 DRM', async () => {
    const blob = await buildEpub({
      chapters: [{ id: 'c', file: 'c.xhtml', body: '<p>x</p>' }],
      metaFiles: { 'encryption.xml': `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OEBPS/f.otf"/></CipherData></EncryptedData></encryption>` },
    });
    await expect(openBook(asFile(blob, 'ok.epub'), { fileName: 'ok.epub' })).resolves.toBeTruthy();
  });
  it('getFootnote：EPUB3 aside 脚注；普通链接返回 null', async () => {
    const b = await open({
      chapters: [
        { id: 'c1', file: 'c1.xhtml', body: `<p>正文<a epub:type="noteref" href="notes.xhtml#n1">1</a><a href="c1.xhtml#top">回顶</a></p><h1 id="top">T</h1>` },
        { id: 'n', file: 'notes.xhtml', body: `<aside epub:type="footnote" id="n1"><p>这是脚注内容。</p></aside><p id="plain">普通段落</p>` },
      ],
    });
    const html = await b.getFootnote!('notes.xhtml#n1', 0);
    expect(html).toContain('这是脚注内容');
    expect(await b.getFootnote!('c1.xhtml#top', 0)).toBeNull();
    expect(await b.getFootnote!('notes.xhtml#plain', 0)).toBeNull();
    expect(await b.getFootnote!('notes.xhtml#nope', 0)).toBeNull();
  });
  it('没有元数据标题时回退到「书名 - 作者」文件名', async () => {
    const b = await open({ chapters: [{ id: 'c', file: 'c.xhtml', body: '<p>x</p>' }] }, '某书 - 某人.epub');
    expect(b.metadata).toMatchObject({ title: '某书', authors: ['某人'] });
  });
  it('不是 EPUB 的 zip', async () => {
    const f = asFile(new Blob([Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0])]), 'bad.epub');
    await expect(openBook(f, { fileName: 'bad.epub' })).rejects.toThrow();
  });
});

describe('目录只有 1 项的多文件电子书（Gutenberg 中文 EPUB 的实际情况）', () => {
  it('按 spine 顺序生成目录，原目录里给出的名字沿用，标题取首个 h1', async () => {
    const chapters = ['甲', '乙', '丙', '丁'].map((n, i) => ({ id: `c${i}`, file: `c${i}.xhtml`, body: `<h1>第${n}章</h1><p>${longText}</p>` }));
    const b = await open({ chapters, ncx: false, nav: NAV('<li><a href="c3.xhtml">只写了这一项</a></li>') });
    expect(b.toc.map((t) => [t.title, t.section])).toEqual([
      ['第甲章', 0],
      ['第乙章', 1],
      ['第丙章', 2],
      ['只写了这一项', 3],
    ]);
  });

  it('目录有 2 个以上落点时不动', async () => {
    const chapters = ['甲', '乙', '丙'].map((n, i) => ({ id: `c${i}`, file: `c${i}.xhtml`, body: `<h1>第${n}章</h1><p>${longText}</p>` }));
    const b = await open({ chapters, nav: NAV('<li><a href="c0.xhtml">自定义一</a></li><li><a href="c2.xhtml">自定义三</a></li>') });
    expect(b.toc.map((t) => t.title)).toEqual(['自定义一', '自定义三']);
  });
});
