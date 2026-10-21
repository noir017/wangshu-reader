import './testing/dom-shim';
import { describe, expect, it } from 'vitest';
import type { ReflowableBook } from '@/core/book';
import { textOfHtml } from '@/core/text';
import { DrmError } from './errors';
import { detectFormat, openBook, probeBook } from './index';
import { decompressPalmDoc } from './mobi';
import { PNG_1PX, asFile, buildMobi6, palmdocCompress } from './testing/builders';
import { useBlobUrls } from './testing/blob-urls';

const urls = useBlobUrls();

/** 把 {{name}} 占位（10 位数字）替换成该标记在 html 里的字节偏移，用来生成 filepos */
function withFilepos(html: string): string {
  const bytes = new TextEncoder();
  // 占位符先按最终宽度（10 位）展开再量偏移，否则占位符长度会让后面的偏移全错
  const sized = html.replace(/\{\{(\w+)\}\}/g, '0000000000');
  const pos = new Map<string, number>();
  let removed = 0;
  for (const m of sized.matchAll(/<!--@(\w+)-->/g)) {
    pos.set(m[1], bytes.encode(sized.slice(0, m.index!)).length - removed);
    removed += bytes.encode(m[0]).length;
  }
  return html.replace(/<!--@\w+-->/g, '').replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(pos.get(name)).padStart(10, '0'));
}

const longText = '这是一段很长的正文，用来撑过按字符数合并的阈值。'.repeat(8);
const HTML = withFilepos(
  `<html><head><guide><reference type="toc" title="目录" filepos="{{toc}}"/></guide></head><body>` +
    `<p><b>书名页</b></p><p>作者：某人 <a filepos="{{ch1}}">跳到第一章</a></p><mbp:pagebreak/>` +
    `<!--@toc--><h2>目录</h2><p><a filepos="{{ch1}}">第一章 开始</a></p><p><a filepos="{{ch2}}">第二章 继续</a></p><p><a filepos="{{ch2a}}">　第二章第一节</a></p><mbp:pagebreak/>` +
    `<!--@ch1--><h1>第一章 开始</h1><p>${longText}</p><img recindex="00001" alt="图"/><p>结尾 <a filepos="{{ch2}}">下一章</a></p><mbp:pagebreak/>` +
    `<!--@ch2--><h1>第二章 继续</h1><p>${longText}</p><!--@ch2a--><h2 id="sec">小节</h2><p>小节正文。</p><script>alert(1)</script></body></html>`,
);

const mobi = (over: Partial<Parameters<typeof buildMobi6>[0]> = {}, name = 'book.mobi') =>
  asFile(new Blob([buildMobi6({ title: '测试之书', author: '某作者', html: HTML, resources: [PNG_1PX], coverOffset: 0, ...over }) as BlobPart]), name);

describe('PalmDOC 压缩', () => {
  it('压缩再解压还原', () => {
    const src = new TextEncoder().encode('Hello world, this is a test ' + '中文字符'.repeat(40) + ' end\u0001\u0000');
    expect(new TextDecoder().decode(decompressPalmDoc(palmdocCompress(src)))).toBe(new TextDecoder().decode(src));
  });
  it('长度-距离对', () => {
    // 'abc' 字面量，然后 (distance 3, length 5) 复制 'abcab'
    const pair = 0x8000 | (3 << 3) | (5 - 3);
    const out = decompressPalmDoc(Uint8Array.from([0x61, 0x62, 0x63, pair >> 8, pair & 255]));
    expect(new TextDecoder().decode(out)).toBe('abcabcab');
  });
});

describe('MOBI6', () => {
  it('识别格式', () => {
    expect(detectFormat('a.mobi')?.format).toBe('mobi');
    for (const e of ['azw', 'azw3', 'prc']) expect(detectFormat(`a.${e}`)?.format).toBe('mobi');
  });

  for (const compression of [2, 1] as const) {
    it(`元数据、分节、目录、链接（compression=${compression}）`, async () => {
      const b = (await openBook(mobi({ compression }), { fileName: 'book.mobi' })) as ReflowableBook;
      expect(b.format).toBe('mobi');
      expect(b.metadata).toMatchObject({ title: '测试之书', authors: ['某作者'], language: 'en' });
      expect(b.sections).toHaveLength(4);
      // 目录来自 guide 里的 toc 页：三项，章节与锚点都指向正文
      expect(b.toc.map((t) => [t.title, t.section, t.anchor !== undefined])).toEqual([
        ['第一章 开始', 2, true],
        ['第二章 继续', 3, true],
        ['第二章第一节', 3, true],
      ]);
      expect(b.toc[2].level).toBeGreaterThanOrEqual(0);
      const c2 = await b.sections[2].load();
      expect(c2.bodyHtml).toContain(`id="${b.toc[0].anchor}"`);
      expect(c2.bodyHtml).toContain('第一章 开始');
      expect(c2.bodyHtml).not.toContain('recindex');
      expect(c2.styles.join('')).toContain('blockquote');
      // 图片：recindex 改写成 blob:，内容是资源记录
      const src = /<img[^>]*src="([^"]+)"/.exec(c2.bodyHtml)?.[1];
      expect(src).toMatch(/^blob:/);
      expect((await urls.made.get(src!)!.arrayBuffer()).byteLength).toBe(PNG_1PX.length);
      expect(urls.made.get(src!)!.type).toBe('image/png');
      // 脚本被清掉；charCount 与引擎看到的纯文本一致
      const c3 = await b.sections[3].load();
      expect(c3.bodyHtml).not.toContain('alert');
      for (const s of b.sections) expect(textOfHtml((await s.load()).bodyHtml).length).toBe(s.charCount);
      // 书内链接
      const link = /<a[^>]*href="([^"]+)"[^>]*>下一章/.exec(c2.bodyHtml)?.[1];
      expect(link).toBeTruthy();
      expect(b.resolveHref(link!, 2)).toEqual({ section: 3, anchor: b.toc[1].anchor });
      expect(b.resolveHref('https://example.com', 2)).toBeNull();
      // 第 0 节的 <head>/<guide> 不应把文字混进正文
      expect(textOfHtml((await b.sections[0].load()).bodyHtml)).toBe('书名页作者：某人 跳到第一章');
    });
  }

  it('封面、probe、ISBN', async () => {
    const p = await probeBook(mobi({ isbn: '9787544248292' }), { fileName: 'book.mobi' });
    expect(p.format).toBe('mobi');
    expect(p.metadata).toMatchObject({ title: '测试之书', authors: ['某作者'], identifiers: { isbn: '9787544248292' } });
    expect(p.cover?.type).toBe('image/png');
    expect(p.size?.chars).toBeGreaterThan(0);
    const b = (await openBook(mobi(), { fileName: 'book.mobi' })) as ReflowableBook;
    expect((await b.getCover())?.size).toBe(PNG_1PX.length);
  });

  it('没有目录页时按分节生成目录，标题取首个标题', async () => {
    const html = `<html><body><h1>甲</h1><p>${longText}</p><mbp:pagebreak/><h1>乙</h1><p>${longText}</p></body></html>`;
    const b = (await openBook(mobi({ html }), { fileName: 'x.mobi' })) as ReflowableBook;
    expect(b.toc.map((t) => t.title)).toEqual(['甲', '乙']);
  });

  it('没有 EXTH/书名时用文件名', async () => {
    const b = await openBook(mobi({ title: '', author: undefined }, '书名 - 作者名.mobi'), { fileName: '书名 - 作者名.mobi' });
    expect(b.metadata).toMatchObject({ title: '书名', authors: ['作者名'] });
  });

  it('DRM：open 报 DrmError，probe 仍能入库', async () => {
    await expect(openBook(mobi({ encryption: 2 }), { fileName: 'b.mobi' })).rejects.toBeInstanceOf(DrmError);
    const p = await probeBook(mobi({ encryption: 2 }), { fileName: 'b.mobi' });
    expect(p.metadata.title).toBe('测试之书');
  });

  it('destroy 回收 blob URL', async () => {
    const b = (await openBook(mobi(), { fileName: 'book.mobi' })) as ReflowableBook;
    await b.sections[2].load();
    expect(urls.made.size).toBeGreaterThan(0);
    b.destroy();
    expect(urls.revoked.length).toBe(urls.made.size);
  });

  it('不是 MOBI 的内容给出可识别错误', async () => {
    await expect(openBook(asFile(new Blob([new Uint8Array(200)]), 'x.mobi'), { fileName: 'x.mobi' })).rejects.toMatchObject({ name: expect.stringMatching(/Error/) });
  });
});

describe('纯 PalmDOC（TEXtREAd）', () => {
  function palmDoc(text: string): Uint8Array {
    const body = palmdocCompress(new TextEncoder().encode(text));
    const r0 = new Uint8Array(16);
    const dv = new DataView(r0.buffer);
    dv.setUint16(0, 2);
    dv.setUint32(4, text.length);
    dv.setUint16(8, 1);
    dv.setUint16(10, 4096);
    const hdr = new Uint8Array(78 + 16 + 2);
    hdr.set(new TextEncoder().encode('TEXtREAd'), 60);
    const hv = new DataView(hdr.buffer);
    hv.setUint16(76, 2);
    hv.setUint32(78, hdr.length);
    hv.setUint32(86, hdr.length + r0.length);
    const out = new Uint8Array(hdr.length + r0.length + body.length);
    out.set(hdr);
    out.set(r0, hdr.length);
    out.set(body, hdr.length + r0.length);
    return out;
  }
  it('按文本书打开', async () => {
    const f = asFile(new Blob([palmDoc('Hello PalmDOC\nsecond line') as BlobPart]), 'doc.prc');
    expect(detectFormat('doc.prc')?.format).toBe('mobi');
    const b = (await openBook(f, { fileName: 'doc.prc' })) as ReflowableBook;
    expect(b.format).toBe('mobi');
    expect(textOfHtml((await b.sections[0].load()).bodyHtml)).toBe('Hello PalmDOCsecond line');
  });
});
