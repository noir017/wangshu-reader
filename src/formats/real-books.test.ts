// 真实样书冒烟测试：samples/books 下的每个文件都跑一遍 probe + open，再按文件名核对几项关键内容。
// 样书目录默认 <项目根>/samples/books（容器里是 /work/wangshu-reader/samples/books，不进 git）；不存在就整体跳过。
//   MR_SAMPLES_DIR=<目录>  换目录；MR_REAL_BOOKS=0  关闭
// 需要服务端才能打开的格式（cb7/7z/rar/chm/djvu）不在这里测（见 convert.test.ts 的 mock 测试）。
import './testing/dom-shim';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import type { Book, FixedBook, ReflowableBook } from '@/core/book';
import { textOf } from '@/core/text';
import { ArchiveChoiceError } from './errors';
import { openBook, probeBook } from './index';
import { __setPdfCanvasFactory } from './pdf';
import { useBlobUrls } from './testing/blob-urls';

const DIR = process.env.MR_SAMPLES_DIR ?? resolve(process.cwd(), 'samples/books');
const MODE = process.env.MR_REAL_BOOKS ?? '1';
const ON = MODE !== '0' && existsSync(DIR);
const NEEDS_SERVER = /\.(cb7|7z|rar|cbr|chm|djvu?)$/i;

useBlobUrls();

__setPdfCanvasFactory((w, h) => {
  const c = createCanvas(w, h);
  return { canvas: c as never, ctx: c.getContext('2d') as never, toBlob: async (type) => new Blob([(type === 'image/png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg')) as BlobPart], { type }) };
});

const files = ON ? readdirSync(DIR).filter((f) => !f.startsWith('.') && f !== 'README.md' && !NEEDS_SERVER.test(f) && statSync(join(DIR, f)).isFile()).sort() : [];
const load = (name: string) => new File([readFileSync(join(DIR, name))], name);
const opts = (name: string, extra?: Record<string, unknown>) => ({ fileName: name, ...(extra ? { extra } : {}) });

async function bodyText(b: ReflowableBook, i: number): Promise<string> {
  const c = await b.sections[i].load();
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${c.bodyHtml}</body></html>`, 'text/html');
  return textOf(doc.body);
}

/** 通用健全性检查：返回 book 供后面的专项检查用 */
async function checkGeneric(name: string): Promise<Book> {
  const probe = await probeBook(load(name), opts(name));
  expect(probe.metadata.title, `${name} probe 书名`).toBeTruthy();
  const book = await openBook(load(name), opts(name));
  expect(book.metadata.title, `${name} 书名`).toBeTruthy();
  expect(book.format).toBe(probe.format);
  if (book.kind === 'reflowable') {
    expect(book.sections.length).toBeGreaterThan(0);
    const total = book.sections.reduce((n, s) => n + s.charCount, 0);
    expect(total, `${name} 总字数`).toBeGreaterThan(10);
    for (const t of book.toc) {
      expect(t.section).toBeGreaterThanOrEqual(0);
      expect(t.section).toBeLessThan(book.sections.length);
    }
    // 第一个有字的章节与最后一个有字的章节：加载后纯文本长度与 charCount 同量级
    const withText = book.sections.map((s, i) => [s, i] as const).filter(([s]) => s.charCount > 0);
    for (const [s, i] of [withText[0], withText[withText.length - 1]]) {
      const text = await bodyText(book, i);
      expect(text.length, `${name} 章节 ${i} charCount`).toBe(s.charCount);
    }
  } else {
    expect(book.pageCount).toBeGreaterThan(0);
    const size = await book.getPageSize(0);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  }
  return book;
}

const SPECIFIC: Record<string, (b: Book) => Promise<void>> = {
  'pg11-alice.epub': async (b) => {
    expect(b.metadata.title).toMatch(/Alice/);
    expect(b.metadata.authors.join()).toMatch(/Carroll/);
    expect(b.toc.length).toBeGreaterThanOrEqual(12);
    expect(await b.getCover()).not.toBeNull();
  },
  'pg11-alice.kf8.mobi': async (b) => {
    expect(b.metadata.title).toMatch(/Alice/);
    expect(b.toc.length).toBeGreaterThanOrEqual(12);
    const r = b as ReflowableBook;
    const i = r.sections.findIndex((s) => s.charCount > 2000);
    const c = await r.sections[i].load();
    expect(c.styles.length).toBeGreaterThan(0);
    expect(await b.getCover()).not.toBeNull();
    // 内部链接都能解析到有效章节
    for (const t of r.toc) expect(r.sections[t.section]).toBeDefined();
  },
  'pg11-alice.mobi': async (b) => {
    expect(b.metadata.title).toMatch(/Alice/);
    expect(b.toc.length).toBeGreaterThanOrEqual(10);
    expect(await b.getCover()).not.toBeNull();
  },
  'pg11-alice.txt': async (b) => {
    expect(b.toc.length).toBeGreaterThanOrEqual(12);
  },
  'pg11-alice.html': async (b) => {
    expect(b.metadata.title).toMatch(/Alice/);
  },
  'hlm-trad-big5.txt': async (b) => {
    expect((b as { encoding?: string }).encoding).toMatch(/big5/);
    expect(await bodyText(b as ReflowableBook, 1)).toMatch(/寶玉|賈/);
  },
  'hlm-simp-gbk.txt': async (b) => {
    expect((b as { encoding?: string }).encoding).toMatch(/gb/);
    expect(await bodyText(b as ReflowableBook, 1)).toMatch(/宝玉|贾/);
  },
  'hlm-simp-gb18030-crlf.txt': async (b) => {
    expect((b as { encoding?: string }).encoding).toMatch(/gb/);
    expect(await bodyText(b as ReflowableBook, 1)).not.toContain('\r');
  },
  'hlm-trad-utf16le.txt': async (b) => {
    expect((b as { encoding?: string }).encoding).toBe('utf-16le');
  },
  'hlm-trad-utf8bom.txt': async (b) => {
    expect((b as { encoding?: string }).encoding).toBe('utf-8');
    expect(b.toc.length).toBeGreaterThan(3);
  },
  'aozora-kokoro-sjis.txt': async (b) => {
    expect((b as { encoding?: string }).encoding).toMatch(/shift|sjis/);
    const r = b as ReflowableBook;
    const html = (await r.sections[0].load()).bodyHtml + (await r.sections[1].load()).bodyHtml;
    expect(html).toContain('<ruby>');
  },
  'aozora-kokoro.zip': async (b) => {
    expect(b.format).toBe('txt');
    expect((b as { encoding?: string }).encoding).toMatch(/shift|sjis/);
  },
  'sample.fb2': async (b) => {
    expect(b.metadata).toMatchObject({ title: expect.stringContaining('Alice'), series: 'Alice', language: 'en' });
    const r = b as ReflowableBook;
    expect(await b.getCover()).not.toBeNull();
    expect(r.toc.some((t) => t.level === 1)).toBe(true);
    const fn = await r.getFootnote!('#n1', 0);
    expect(fn).toContain('First footnote');
  },
  'sample.fb2.zip': async (b) => expect(b.format).toBe('fb2'),
  'sample-ru-cp1251.fb2': async (b) => {
    expect(b.metadata.title).toBe('Война и мир (фрагмент)');
    expect(b.metadata.authors).toEqual(['Лев Толстой']);
  },
  'sample.md': async (b) => {
    const r = b as ReflowableBook;
    expect(r.sections.length).toBeGreaterThanOrEqual(1);
    expect(r.toc.map((t) => t.title)).toEqual(['第一章 开始', '第二章 继续']);
    const html = (await r.sections[0].load()).bodyHtml;
    expect(html).toContain('<table');
    expect(html).toContain('<pre');
  },
  'sample-gbk.html': async (b) => {
    expect(b.metadata.title).toBe('HTML 样书 - 某作者');
    const html = (await (b as ReflowableBook).sections[0].load()).bodyHtml;
    expect(html).toContain('中文内容');
    expect(html).not.toMatch(/onclick|javascript:|<script/i);
  },
  'sample.rtf': async (b) => {
    expect(b.metadata).toMatchObject({ title: 'RTF 样书', authors: ['某作者'] });
    const text = await bodyText(b as ReflowableBook, 0);
    expect(text).toContain('这是 GBK 编码的 RTF');
    expect(text).toContain('第一章 开始');
  },
  'sample.docx': async (b) => {
    expect(b.metadata).toMatchObject({ title: 'DOCX 样书', authors: ['某作者'] });
    const r = b as ReflowableBook;
    expect(r.toc.length).toBe(2);
    const html = (await r.sections[0].load()).bodyHtml;
    expect(html).toMatch(/<strong>粗体<\/strong>/);
    expect(html).toContain('<table');
    expect(html).toMatch(/<img[^>]+src="blob:/);
    // 脚注段在最后一节
    const last = (await r.sections[r.sections.length - 1].load()).bodyHtml;
    expect(last).toContain('DOCX 脚注内容');
  },
  'sample.odt': async (b) => {
    expect(b.metadata).toMatchObject({ title: 'ODT 样书', authors: ['某作者'] });
    const html = (await (b as ReflowableBook).sections[0].load()).bodyHtml;
    expect(html).toMatch(/<strong>粗体<\/strong>/);
    expect(html).toMatch(/<img[^>]+src="blob:/);
    expect(await b.getCover()).not.toBeNull();
  },
  'sample.umd': async (b) => {
    expect(b.metadata).toMatchObject({ title: 'UMD 样书', authors: ['某作者'] });
    expect((b as ReflowableBook).toc.map((t) => t.title)).toEqual(['第一章 开始', '第二章 继续', '尾声']);
  },
  'sample.cbz': async (b) => {
    const f = b as FixedBook;
    expect(f.pageCount).toBe(6); // __MACOSX 里的垃圾文件被忽略
    expect(b.metadata).toMatchObject({ title: 'Alice 漫画样本', authors: ['Lewis Carroll'], series: 'Alice' });
    expect(await f.getPageSize(0)).toEqual({ width: 300, height: 450 });
    expect(await f.getCover()).not.toBeNull();
  },
  'sample-manga-rtl.cbz': async (b) => {
    expect(b.metadata.direction).toBe('rtl');
    expect((b as FixedBook).pageCount).toBe(4);
  },
  'sample-palmdoc.prc': async (b) => expect(b.format).toBe('mobi'),
  'zip-single-epub.zip': async (b) => {
    expect(b.format).toBe('epub');
    expect(b.metadata.title).toMatch(/Alice/);
  },
  'zip-images-only.zip': async (b) => {
    expect(b.kind).toBe('fixed');
    expect((b as FixedBook).pageCount).toBe(5);
  },
  'zip-gbk-name.zip': async (b) => {
    expect(b.format).toBe('txt');
    expect(b.metadata.title).toBe('红楼梦');
    expect(b.metadata.authors).toEqual(['曹雪芹']);
  },
  'tracemonkey.pdf': async (b) => {
    const f = b as FixedBook;
    expect(f.pageCount).toBe(14);
    const t = await f.getPageText!(0);
    expect(t!.text).toContain('Trace-based');
    expect(t!.items.length).toBeGreaterThan(50);
    for (const it of t!.items) {
      expect(it.x).toBeGreaterThanOrEqual(0);
      expect(it.x + it.w).toBeLessThanOrEqual(1.0001);
    }
    const img = await f.renderPage(0, { width: 200, height: 260, dpr: 1 });
    expect((img as unknown as { width: number }).width).toBeGreaterThan(0);
    expect(await f.getCover()).not.toBeNull();
  },
};

describe.skipIf(!ON)('真实样书（samples/books）', () => {
  it('样书目录不为空', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const name of files) {
    if (name === 'encrypted-abc.pdf' || name === 'zip-two-books.zip') continue; // 下面单独测
    it(name, { timeout: 180_000 }, async () => {
      const book = await checkGeneric(name);
      await SPECIFIC[name]?.(book);
      book.destroy();
    });
  }

  it('encrypted-abc.pdf：缺密码/错密码/正确密码', { timeout: 60_000 }, async () => {
    const name = 'encrypted-abc.pdf';
    if (!existsSync(join(DIR, name))) return;
    await expect(openBook(load(name), opts(name))).rejects.toMatchObject({ name: 'PasswordRequiredError', reason: 'need' });
    await expect(openBook(load(name), opts(name, { password: 'wrong' }))).rejects.toMatchObject({ reason: 'incorrect' });
    const ok = (await openBook(load(name), opts(name, { password: 'abc' }))) as FixedBook;
    expect(ok.pageCount).toBeGreaterThan(0);
    ok.destroy();
    // 导入书架（probe）：没有密码也不报错，只是没有封面
    const p = await probeBook(load(name), opts(name));
    expect(p.format).toBe('pdf');
  });

  it('zip-two-books.zip：多本书时让用户选，选中后能打开', { timeout: 60_000 }, async () => {
    const name = 'zip-two-books.zip';
    if (!existsSync(join(DIR, name))) return;
    const err = await openBook(load(name), opts(name)).catch((e) => e);
    expect(err).toBeInstanceOf(ArchiveChoiceError);
    expect((err as ArchiveChoiceError).entries.sort()).toEqual(['a.epub', 'b.txt']);
    const b = await openBook(load(name), opts(name, { entry: 'b.txt' }));
    expect(b.format).toBe('txt');
    b.destroy();
  });
});
