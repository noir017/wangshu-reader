import './testing/dom-shim';
import { describe, expect, it } from 'vitest';
import type { ReflowableBook } from '@/core/book';
import { textOfHtml } from '@/core/text';
import { detectFormat, openBook, probeBook } from './index';
import { asFile, encodeLegacy, u8 } from './testing/builders';

const file = (html: string | Uint8Array, name = 'a.html') => asFile(new Blob([typeof html === 'string' ? u8(html) : html] as BlobPart[]), name);
const open = (html: string | Uint8Array, name = 'a.html') => openBook(file(html, name), { fileName: name }) as Promise<ReflowableBook>;

describe('HTML / HTM / XHTML（FMT-006）', () => {
  it('识别格式：扩展名与文件头', () => {
    for (const e of ['html', 'htm', 'xhtml']) expect(detectFormat(`a.${e}`)?.format).toBe('html');
    expect(detectFormat('noext', u8('<!DOCTYPE html><html><body>x</body></html>'))?.format).toBe('html');
  });

  it('元数据：<title>、meta author/description、html lang', async () => {
    const b = await open(`<!doctype html><html lang="zh-CN"><head><title>书 &amp; 名</title><meta name="author" content="某人"><meta name="description" content="一句话"></head><body><p>正文</p></body></html>`);
    expect(b.metadata).toMatchObject({ title: '书 & 名', authors: ['某人'], description: '一句话', language: 'zh-CN' });
  });

  it('清洗：脚本、事件属性、javascript: 链接、iframe、外部资源引用全部去掉', async () => {
    const b = await open(
      `<html><head><script>alert(1)</script><style>p{color:red}</style></head><body onload="alert(2)"><p onclick="alert(3)">文<a href="javascript:alert(4)">链接</a><a href="#x">锚</a></p><iframe src="http://evil.example/"></iframe><img src="a.png" onerror="alert(5)"><svg><circle r="1"/></svg><ruby>汉<rt>han</rt></ruby></body></html>`,
    );
    const c = await b.sections[0].load();
    expect(c.bodyHtml).not.toMatch(/onclick|onerror|javascript:|<script|<iframe|alert/i);
    expect(c.bodyHtml).toContain('href="#x"');
    expect(c.bodyHtml).toContain('<svg');
    expect(c.bodyHtml).toContain('<ruby>');
    expect(c.bodyHtml).not.toContain('src="a.png"'); // 单文件里的相对资源取不到：引用被丢掉，不让浏览器去请求应用自己的地址
    expect(c.styles.join('')).toContain('color:red');
  });

  it('按 h1 分章、目录取 h1–h3（含层级）、锚点跳转', async () => {
    const long = '字'.repeat(300);
    const b = await open(`<body><h1 id="a">第一章</h1><p>${long}</p><h2 id="a1">一节</h2><p>${long}</p><h1 id="b">第二章</h1><p>${long}</p><h3>小小节</h3></body>`);
    expect(b.sections).toHaveLength(2);
    expect(b.toc.map((t) => [t.title, t.level, t.section])).toEqual([
      ['第一章', 0, 0],
      ['一节', 1, 0],
      ['第二章', 0, 1],
      ['小小节', 2, 1],
    ]);
    expect(b.resolveHref('#b', 0)).toEqual({ section: 1, anchor: 'b' });
    expect(b.resolveHref('#nope', 0)).toBeNull();
    expect(b.resolveHref('https://x.y', 0)).toBeNull();
    for (const s of b.sections) expect(textOfHtml((await s.load()).bodyHtml).length).toBe(s.charCount);
  });

  it('只有一个 h1 时不按标题分章，只按大小切', async () => {
    const b = await open(`<body><h1>唯一标题</h1><p>${'字'.repeat(100)}</p></body>`);
    expect(b.sections).toHaveLength(1);
  });

  it('超过 maxChapterChars 的单文件在块边界切成多个 section（FMT-006）', async () => {
    const { htmlSettings } = await import('./settings');
    htmlSettings.set({ maxChapterChars: 500 });
    try {
      const b = await open(`<body>${Array.from({ length: 10 }, () => `<p>${'字'.repeat(200)}</p>`).join('')}</body>`);
      expect(b.sections.length).toBeGreaterThanOrEqual(3);
      expect(b.sections.reduce((n, s) => n + s.charCount, 0)).toBe(2000);
    } finally {
      htmlSettings.reset();
    }
  });

  it('编码：meta charset=gbk 的 HTML 正确解码；opts.encoding 可强制', async () => {
    const gbk = encodeLegacy('中文内容，编码测试。', 'gbk');
    const head = u8('<html><head><meta charset="gbk"><title>');
    const title = encodeLegacy('标题', 'gbk');
    const rest = u8('</title></head><body><p>');
    const tail = u8('</p></body></html>');
    const bytes = new Uint8Array([...head, ...title, ...rest, ...gbk, ...tail]);
    const b = await open(bytes);
    expect(b.metadata.title).toBe('标题');
    expect(textOfHtml((await b.sections[0].load()).bodyHtml)).toBe('中文内容，编码测试。');
    const noMeta = new Uint8Array([...u8('<html><body><p>'), ...gbk, ...tail]);
    const forced = (await openBook(file(noMeta), { fileName: 'a.html', encoding: 'gbk' })) as ReflowableBook;
    expect(textOfHtml((await forced.sections[0].load()).bodyHtml)).toBe('中文内容，编码测试。');
  });

  it('probe：只读头部，给文件名兜底', async () => {
    const p = await probeBook(file('<html><head><title>T</title></head><body>x</body></html>', '书名 - 作者.html'), { fileName: '书名 - 作者.html' });
    expect(p).toMatchObject({ format: 'html', cover: null });
    expect(p.metadata.title).toBe('T');
    const q = await probeBook(file('<p>no head</p>', '书名 - 作者.html'), { fileName: '书名 - 作者.html' });
    expect(q.metadata).toMatchObject({ title: '书名', authors: ['作者'] });
  });
});
