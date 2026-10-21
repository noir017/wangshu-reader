import './testing/dom-shim';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FixedBook, ReflowableBook } from '@/core/book';
import { BookOpenError, ServerRequiredError, fmtMsg } from './errors';
import { openBook, probeBook } from './index';
import { __setPdfCanvasFactory } from './pdf';
import { asFile, buildEpub, buildPdf, makePng, zipBlob } from './testing/builders';

const h = vi.hoisted(() => ({
  has: true,
  calls: [] as { path: string; init?: RequestInit }[],
  respond: (_path: string, _init?: RequestInit): Promise<Response> => Promise.reject(new Error('unmocked')),
}));

vi.mock('@/core/server', () => {
  class ServerUnavailableError extends Error {
    constructor(msg = '未配置或无法连接服务端') {
      super(msg);
      this.name = 'ServerUnavailableError';
    }
  }
  return {
    ServerUnavailableError,
    hasServer: () => h.has,
    apiFetch: async (path: string, init?: RequestInit) => {
      h.calls.push({ path, init });
      return h.respond(path, init);
    },
    apiJson: async (path: string, init?: RequestInit) => {
      h.calls.push({ path, init });
      return (await h.respond(path, init)).json();
    },
  };
});

// happy-dom 的 Response 不认 Node 的 Blob（body 变成空），所以只造生产代码用到的 blob()/json() 两个方法
const bin = (bytes: Uint8Array | Blob, _type = 'application/octet-stream') => ({ blob: async () => new Blob([bytes as BlobPart]) }) as unknown as Response;
const json = (o: unknown) => ({ json: async () => o }) as unknown as Response;
const blobOf = async (spec: Parameters<typeof buildEpub>[0]) => buildEpub(spec);
const cbzBlob = () => zipBlob({ '1.png': makePng(10, 20), '2.png': makePng(10, 20), 'ComicInfo.xml': '<ComicInfo><Title>转出的漫画</Title></ComicInfo>' });
const file = (name: string, content: BlobPart = 'raw archive bytes') => asFile(new Blob([content]), name);
const convertCalls = () => h.calls.filter((c) => c.path.startsWith('/api/convert'));

beforeEach(() => {
  h.has = true;
  h.calls.length = 0;
  h.respond = () => Promise.reject(new Error('unmocked'));
});

describe('CHM → EPUB（FMT-014）', () => {
  const epub = () => blobOf({ title: 'CHM 手册', authors: ['某作者'], chapters: [{ id: 'c1', file: 'c1.xhtml', body: '<h1>第一章</h1><p>正文内容</p>' }] });

  it('POST /api/convert?to=epub&name=…，body 是原文件；结果当 EPUB 解析，format 保持 chm', async () => {
    const src = file('手册.chm', 'ITSF....');
    h.respond = async () => bin(await epub(), 'application/epub+zip');
    const b = (await openBook(src, { fileName: '手册.chm' })) as ReflowableBook;
    expect(b.format).toBe('chm');
    expect(b.metadata).toMatchObject({ title: 'CHM 手册', authors: ['某作者'] });
    expect(b.sections).toHaveLength(1);
    expect(convertCalls()).toHaveLength(1);
    const c = convertCalls()[0];
    expect(c.path).toBe(`/api/convert?to=epub&name=${encodeURIComponent('手册.chm')}`);
    expect(c.init?.method).toBe('POST');
    expect(c.init?.body).toBe(src);
    expect((c.init?.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
  });

  it('服务端没配置 → ServerRequiredError，中文提示', async () => {
    h.has = false;
    const e = await openBook(file('a.chm'), { fileName: 'a.chm' }).catch((x) => x);
    expect(e).toBeInstanceOf(ServerRequiredError);
    expect(e.code).toBe('server');
    expect(e.message).toContain('CHM');
    expect(e.message).toContain(fmtMsg('serverNone')); // 界面语言随设置，这里不写死中英文
    expect(h.calls).toHaveLength(0);
  });

  it('连不上服务端 → ServerRequiredError（带原因）；服务端报错 → BookOpenError(server)', async () => {
    const { ServerUnavailableError } = await import('@/core/server');
    h.respond = () => Promise.reject(new ServerUnavailableError('无法连接服务端 http://x：refused'));
    const a = await openBook(file('a.chm'), { fileName: 'a.chm' }).catch((x) => x);
    expect(a).toBeInstanceOf(ServerRequiredError);
    expect(a.message).toContain('refused');
    h.respond = () => Promise.reject(new Error('服务端 /api/convert 出错：chmlib 失败'));
    const b = await openBook(file('b.chm'), { fileName: 'b.chm' }).catch((x) => x);
    expect(b).toBeInstanceOf(BookOpenError);
    expect(b).not.toBeInstanceOf(ServerRequiredError);
    expect(b.code).toBe('server');
    expect(b.message).toBe(fmtMsg('serverFail', { why: '服务端 /api/convert 出错：chmlib 失败' }));
    expect(b.message).toContain('chmlib');
  });

  it('取消（AbortError）原样抛出，不包装', async () => {
    h.respond = () => Promise.reject(new DOMException('aborted', 'AbortError'));
    await expect(openBook(file('a.chm'), { fileName: 'a.chm' })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('probe：服务端可用时取元数据与封面；不可用时只用文件名，不报错', async () => {
    h.respond = async () => bin(await epub());
    const p = await probeBook(file('手册 - 某人.chm'), { fileName: '手册 - 某人.chm' });
    expect(p).toMatchObject({ format: 'chm', metadata: { title: 'CHM 手册' } });
    h.has = false;
    const q = await probeBook(file('手册 - 某人.chm'), { fileName: '手册 - 某人.chm' });
    expect(q).toMatchObject({ format: 'chm', metadata: { title: '手册', authors: ['某人'] }, cover: null });
  });

  it('同一个文件先 probe 再 open：只转换一次', async () => {
    h.respond = async () => bin(await epub());
    const src = file('a.chm');
    await probeBook(src, { fileName: 'a.chm' });
    await openBook(src, { fileName: 'a.chm' });
    expect(convertCalls()).toHaveLength(1);
  });

  it('转换失败后不缓存失败结果，可以重试', async () => {
    const src = file('a.chm');
    h.respond = () => Promise.reject(new Error('boom'));
    await expect(openBook(src, { fileName: 'a.chm' })).rejects.toBeInstanceOf(BookOpenError);
    h.respond = async () => bin(await epub());
    await expect(openBook(src, { fileName: 'a.chm' })).resolves.toMatchObject({ format: 'chm' });
  });
});

describe('CBR / CB7 → CBZ（FMT-020、COMIC-001）', () => {
  for (const ext of ['cbr', 'cb7'] as const) {
    it(`.${ext}：to=cbz，format 保持 ${ext}`, async () => {
      h.respond = async () => bin(await cbzBlob());
      const b = (await openBook(file(`漫画.${ext}`), { fileName: `漫画.${ext}` })) as FixedBook;
      expect(b.kind).toBe('fixed');
      expect(b.format).toBe(ext);
      expect(b.pageCount).toBe(2);
      expect(b.metadata.title).toBe('转出的漫画');
      expect(convertCalls()[0].path).toContain('to=cbz');
      const p = await probeBook(file(`漫画.${ext}`), { fileName: `漫画.${ext}` });
      expect(p).toMatchObject({ format: ext, size: { pages: 2 } });
      expect(p.cover?.type).toBe('image/png');
    });
  }
  it('没有服务端：打开报错、probe 退回文件名', async () => {
    h.has = false;
    await expect(openBook(file('a.cbr'), { fileName: 'a.cbr' })).rejects.toBeInstanceOf(ServerRequiredError);
    expect(await probeBook(file('a.cbr'), { fileName: 'a.cbr' })).toMatchObject({ format: 'cbr', cover: null });
  });
});

describe('DJVU → PDF（PDF-010）', () => {
  it('to=pdf；health 报告有 djvulibre 才转；结果是 PDF，format 保持 djvu', { timeout: 30_000 }, async () => {
    __setPdfCanvasFactory(null);
    h.respond = async (path) => (path === '/api/health' ? json({ ok: true, features: { 'convert.djvu': true } }) : bin(buildPdf({ pages: [['djvu text page']] }), 'application/pdf'));
    const b = (await openBook(file('扫描书.djvu'), { fileName: '扫描书.djvu' })) as FixedBook;
    expect(b.format).toBe('djvu');
    expect(b.pageCount).toBe(1);
    expect(convertCalls()[0].path).toContain('to=pdf');
    expect((await b.getPageText!(0))!.text).toContain('djvu text page');
    b.destroy();
  });

  it('服务端没装 djvulibre：给出明确提示，不去上传大文件', async () => {
    h.respond = async () => json({ ok: true, features: { 'convert.djvu': false } });
    const e = await openBook(file('a.djvu'), { fileName: 'a.djvu' }).catch((x) => x);
    expect(e).toBeInstanceOf(ServerRequiredError);
    expect(e.message).toContain('convert.djvu');
    expect(convertCalls()).toHaveLength(0);
  });

  it('probe 不触发整本转换，只用文件名', async () => {
    const p = await probeBook(file('扫描书 - 某人.djv'), { fileName: '扫描书 - 某人.djv' });
    expect(p).toMatchObject({ format: 'djvu', metadata: { title: '扫描书', authors: ['某人'] }, cover: null });
    expect(h.calls).toHaveLength(0);
  });
});

describe('RAR / 7z（服务端列目录 + 取条目）', () => {
  const entries = (...paths: string[]) => json({ entries: paths.map((path) => ({ path, size: 1, dir: false })) });

  it('里面只有一本书：取出来打开，书名/作者按内部文件名', async () => {
    h.respond = async (path) => {
      if (path.startsWith('/api/archive/list')) return entries('说明.txt', 'books/书名 - 作者.epub');
      if (path.startsWith('/api/archive/extract')) return bin(await blobOf({ chapters: [{ id: 'c', file: 'c.xhtml', body: '<p>内容</p>' }] }));
      throw new Error(path);
    };
    const b = await openBook(file('pack.rar'), { fileName: 'pack.rar' });
    expect(b.format).toBe('epub');
    expect(b.metadata).toMatchObject({ title: '书名', authors: ['作者'] });
    const extract = h.calls.find((c) => c.path.startsWith('/api/archive/extract'))!;
    expect(extract.path).toBe(`/api/archive/extract?name=pack.rar&entry=${encodeURIComponent('books/书名 - 作者.epub')}`);
  });

  it('全是图片：整包转 CBZ 当漫画，format 为 cbr / cb7', async () => {
    h.respond = async (path) => (path.startsWith('/api/archive/list') ? entries('001.jpg', '002.jpg', '003.jpg') : bin(await cbzBlob()));
    const r = (await openBook(file('a.rar'), { fileName: 'a.rar' })) as FixedBook;
    expect(r).toMatchObject({ kind: 'fixed', format: 'cbr', pageCount: 2 });
    const z = (await openBook(file('a.7z'), { fileName: 'a.7z' })) as FixedBook;
    expect(z.format).toBe('cb7');
  });

  it('多本书 → ArchiveChoiceError；extra.entry 指定后打开；probe 只记文件名', async () => {
    h.respond = async (path) => {
      if (path.startsWith('/api/archive/list')) return entries('a.epub', 'b.txt', 'c.jpg');
      if (path.startsWith('/api/archive/extract')) return bin(new TextEncoder().encode('第一行\n第二行'));
      throw new Error(path);
    };
    const e = await openBook(file('a.7z'), { fileName: 'a.7z' }).catch((x) => x);
    expect(e).toMatchObject({ name: 'ArchiveChoiceError', code: 'multiple', entries: ['a.epub', 'b.txt'] });
    const b = await openBook(file('a.7z'), { fileName: 'a.7z', extra: { entry: 'b.txt' } });
    expect(b.format).toBe('txt');
    expect(await probeBook(file('a.7z'), { fileName: 'a.7z' })).toMatchObject({ format: '7z', cover: null });
  });

  it('没有服务端：open 报 ServerRequiredError，probe 退回文件名', async () => {
    h.has = false;
    await expect(openBook(file('a.rar'), { fileName: 'a.rar' })).rejects.toBeInstanceOf(ServerRequiredError);
    expect(await probeBook(file('a - b.rar'), { fileName: 'a - b.rar' })).toMatchObject({ format: 'rar', metadata: { title: 'a', authors: ['b'] } });
  });
});
