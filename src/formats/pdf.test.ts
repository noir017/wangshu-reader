import './testing/dom-shim';
import { createCanvas } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FixedBook } from '@/core/book';
import { PasswordRequiredError, UnsupportedFormatError } from './errors';
import { detectFormat, openBook, probeBook } from './index';
import { BundledBinaryData, __setPdfCanvasFactory, toClassicWorkerSource, validPdfTitle } from './pdf';
import { asFile, buildPdf, u8 } from './testing/builders';

/** pdf.js 测试库的 issue6010_1.pdf（AES-256 加密，用户密码 abc），1.1KB */
const ENCRYPTED_B64 = 'JVBERi0xLjcKJYCBgoMKMSAwIG9iago8PC9QYWdlcyA2IDAgUi9UeXBlL0NhdGFsb2c+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL0VuY29kaW5nL0Jhc2VFbmNvZGluZy9XaW5BbnNpRW5jb2Rpbmc+PgplbmRvYmoKMyAwIG9iago8PC9QYXJlbnQgNiAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pi9NZWRpYUJveFswIDAgMjAwIDUwXS9UeXBlL1BhZ2UvQ29udGVudHMgNCAwIFI+PgplbmRvYmoKNCAwIG9iago8PC9GaWx0ZXIvRmxhdGVEZWNvZGUvTGVuZ3RoIDY0Pj4Kc3RyZWFtCoLVBjaQMojW9XxRJGq+lYOvXoJCSEpDPAF337LGTSVYMzN17LC6GTsBvSqhHqwYgmnNu8Te9kv2zzmzpq1JUvEKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L0Jhc2VGb250L1RpbWVzLVJvbWFuL1N1YnR5cGUvVHlwZTEvVHlwZS9Gb250L0VuY29kaW5nIDIgMCBSPj4KZW5kb2JqCjYgMCBvYmoKPDwvTWVkaWFCb3hbMCAwIDIwMCA1MF0vS2lkc1szIDAgUl0vVHlwZS9QYWdlcy9Db3VudCAxPj4KZW5kb2JqCnhyZWYKMCA3IAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2MCAwMDAwMCBuIAowMDAwMDAwMTIzIDAwMDAwIG4gCjAwMDAwMDAyMzQgMDAwMDAgbiAKMDAwMDAwMDM2NSAwMDAwMCBuIAowMDAwMDAwNDQ1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA3L0lEWygXZ1VlPi9qv1+DODqCO9sSKSgXZ1VlPi9qv1+DODqCO9sSKV0vRW5jcnlwdDw8L0ZpbHRlci9TdGFuZGFyZC9WIDUvQ0Y8PC9TdGRDRjw8L0xlbmd0aCAzMi9BdXRoRXZlbnQvRG9jT3Blbi9DRk0vQUVTVjM+Pj4+L0VuY3J5cHRNZXRhZGF0YSB0cnVlL0xlbmd0aCAyNTYvUiA2L08oBBDp9Dbi1lwoq1QjuPODiY8TazZQUemOklxumujjYECUtRok775L/uudEGXA+SBGhOIpL1Uo7+nLIDTJNPWafj5XhW5ULfs6hMb4fXxYU3ZmMiwXON+bXpcs6n13o4czXGbc3f0HkCkvUCAtNC9TdHJGL1N0ZENGL1N0bUYvU3RkQ0YvUGVybXMo1+zA7xGnXHIQMdYP6W8Yi3UpL09FKMU/0U+DnevmnVwoHlG4EzVGC/3pUhNWgsZK0v8sHFZZ9ikvVUUoRWLubHC3S8M1f7FQTK3c+skDAUZxSRX2RDydgD74PPQpPj4vUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgo1MTcKJSVFT0YK';
const encrypted = () => Uint8Array.from(atob(ENCRYPTED_B64), (c) => c.charCodeAt(0));

beforeAll(() => {
  __setPdfCanvasFactory((w, h) => {
    const c = createCanvas(w, h);
    return { canvas: c as never, ctx: c.getContext('2d') as never, toBlob: async () => new Blob([c.toBuffer('image/jpeg') as BlobPart], { type: 'image/jpeg' }) };
  });
});
afterAll(() => __setPdfCanvasFactory(null));

const pdf = (bytes: Uint8Array, name = 'a.pdf') => asFile(new Blob([bytes as BlobPart]), name);
const SPEC = {
  pages: [['Hello PDF world', 'Second line of page one'], ['Page two text'], ['Third page']],
  info: { Title: 'Test Title', Author: 'Test Author', Subject: 'About tests', Keywords: 'alpha, beta; gamma' },
  outline: [
    { title: 'Chapter 1', page: 0, level: 0 },
    { title: 'Section 1.1', page: 1, level: 1 },
    { title: 'Chapter 2', page: 2, level: 0 },
  ],
};

describe('PDF（PDF-001/003、FMT-018）', () => {
  it('识别格式：扩展名与文件头', () => {
    expect(detectFormat('a.pdf')?.format).toBe('pdf');
    expect(detectFormat('noext', u8('%PDF-1.4\n'))?.format).toBe('pdf');
  });

  it('元数据、页数、页尺寸、目录', { timeout: 30_000 }, async () => {
    const b = (await openBook(pdf(buildPdf(SPEC)), { fileName: 'a.pdf' })) as FixedBook;
    expect(b.kind).toBe('fixed');
    expect(b.format).toBe('pdf');
    expect(b.pageCount).toBe(3);
    expect(b.metadata).toMatchObject({ title: 'Test Title', authors: ['Test Author'], description: 'About tests', subjects: ['alpha', 'beta', 'gamma'] });
    expect(await b.getPageSize(0)).toEqual({ width: 612, height: 792 });
    expect(b.toc).toEqual([
      { title: 'Chapter 1', level: 0, section: 0 },
      { title: 'Section 1.1', level: 1, section: 1 },
      { title: 'Chapter 2', level: 0, section: 2 },
    ]);
    await expect(b.getPageSize(9)).rejects.toThrow(RangeError);
    b.destroy();
  });

  it('getPageText：纯文本 + 归一化坐标（0..1，左上角为原点）', { timeout: 30_000 }, async () => {
    const b = (await openBook(pdf(buildPdf(SPEC)), { fileName: 'a.pdf' })) as FixedBook;
    const t = await b.getPageText!(0);
    expect(t!.text).toContain('Hello PDF world');
    expect(t!.text).toContain('Second line of page one');
    expect(t!.items.length).toBeGreaterThanOrEqual(2);
    const first = t!.items[0];
    expect(t!.text.slice(first.start, first.end)).toContain('Hello');
    // 第一行在页面上方（y 小），第二行在它下面；都在页内
    expect(first.y).toBeGreaterThan(0);
    expect(first.y).toBeLessThan(0.3);
    expect(t!.items[1].y).toBeGreaterThan(first.y);
    for (const it of t!.items) {
      for (const v of [it.x, it.y, it.w, it.h]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(it.end).toBeGreaterThan(it.start);
    }
    b.destroy();
  });

  it('renderPage：按目标尺寸（含 dpr）出图；可取消', { timeout: 30_000 }, async () => {
    const b = (await openBook(pdf(buildPdf(SPEC)), { fileName: 'a.pdf' })) as FixedBook;
    const img = (await b.renderPage(0, { width: 306, height: 396, dpr: 2 })) as unknown as { width: number; height: number };
    expect(img.width).toBe(612);
    expect(img.height).toBe(792);
    const ac = new AbortController();
    ac.abort();
    await expect(b.renderPage(0, { width: 100, height: 100, dpr: 1, signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    b.destroy();
  });

  it('中文 PDF（未内嵌 CJK 字体，靠随包 CMap）：能抽出文字、能渲染', { timeout: 30_000 }, async () => {
    const b = (await openBook(pdf(buildPdf({ pages: [['中文测试，你好世界']], cjk: true }), 'zh.pdf'), { fileName: 'zh.pdf' })) as FixedBook;
    const t = await b.getPageText!(0);
    expect(t!.text).toContain('中文测试，你好世界');
    await b.renderPage(0, { width: 100, height: 130, dpr: 1 });
    b.destroy();
  });

  it('封面 = 首页渲染；probe 带页数', { timeout: 30_000 }, async () => {
    const p = await probeBook(pdf(buildPdf(SPEC)), { fileName: 'a.pdf' });
    expect(p).toMatchObject({ format: 'pdf', size: { pages: 3 }, metadata: { title: 'Test Title' } });
    expect(p.cover?.type).toBe('image/jpeg');
  });

  it('没有文档信息时用文件名「书名 - 作者」；无书签时目录为空', { timeout: 30_000 }, async () => {
    const b = await openBook(pdf(buildPdf({ pages: [['x']] }), '论文 - 某人.pdf'), { fileName: '论文 - 某人.pdf' });
    expect(b.metadata).toMatchObject({ title: '论文', authors: ['某人'] });
    expect(b.toc).toEqual([]);
    b.destroy();
  });

  it('validPdfTitle：含 < 与 > 的标题（XML 残片/乱码）不要', () => {
    expect(validPdfTitle('Good Title')).toBe(true);
    expect(validPdfTitle('<?xpacket begin?>')).toBe(false);
    expect(validPdfTitle('  ')).toBe(false);
    expect(validPdfTitle(undefined)).toBe(false);
  });

  it('加密 PDF：缺密码 → need；错密码 → incorrect；正确密码可打开（PDF-001）', { timeout: 30_000 }, async () => {
    const f = () => pdf(encrypted(), 'enc.pdf');
    const need = await openBook(f(), { fileName: 'enc.pdf' }).catch((e) => e);
    expect(need).toBeInstanceOf(PasswordRequiredError);
    expect(need).toMatchObject({ reason: 'need', code: 'password' });
    expect(need.message).toBeTruthy();
    const wrong = await openBook(f(), { fileName: 'enc.pdf', extra: { password: 'nope' } }).catch((e) => e);
    expect(wrong).toMatchObject({ reason: 'incorrect' });
    const ok = (await openBook(f(), { fileName: 'enc.pdf', extra: { password: 'abc' } })) as FixedBook;
    expect(ok.pageCount).toBe(1);
    expect((await ok.getPageText!(0))!.text.length).toBeGreaterThan(0);
    ok.destroy();
  });

  it('加密 PDF 导入书架（probe）：没有密码也不报错，只是没有封面', { timeout: 30_000 }, async () => {
    const p = await probeBook(pdf(encrypted(), '机密 - 某人.pdf'), { fileName: '机密 - 某人.pdf' });
    expect(p).toMatchObject({ format: 'pdf', cover: null, metadata: { title: '机密', authors: ['某人'] } });
  });

  it('不是 PDF / 损坏的 PDF → 可识别的错误', { timeout: 30_000 }, async () => {
    await expect(openBook(pdf(u8('hello'), 'a.pdf'), { fileName: 'a.pdf' })).rejects.toBeInstanceOf(UnsupportedFormatError);
    const bad = await openBook(pdf(u8('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ngarbage'), 'a.pdf'), { fileName: 'a.pdf' }).catch((e) => e);
    expect(bad).toMatchObject({ name: expect.stringMatching(/Error/) });
    expect(bad.code).toMatch(/unsupported|corrupt/);
  });
});

describe('随包数据（CMap / 标准字体 / wasm）', () => {
  const bd = new BundledBinaryData();
  it('CJK CMap、标准字体、JBIG2/JPX 解码器都能从包里取出', { timeout: 30_000 }, async () => {
    const cmap = await bd.fetch({ kind: 'cMapUrl', filename: 'UniGB-UCS2-H.bcmap' });
    expect(cmap.length).toBeGreaterThan(1000);
    const font = await bd.fetch({ kind: 'standardFontDataUrl', filename: 'LiberationSans-Regular.ttf' });
    expect(font.length).toBeGreaterThan(50_000);
    const pfb = await bd.fetch({ kind: 'standardFontDataUrl', filename: 'FoxitSerif.pfb' });
    expect(pfb.length).toBeGreaterThan(10_000);
    for (const f of ['jbig2.wasm', 'openjpeg.wasm']) {
      const wasm = await bd.fetch({ kind: 'wasmUrl', filename: f });
      expect(WebAssembly.validate(wasm as BufferSource)).toBe(true);
    }
  });
  it('没打包的文件给出明确错误（pdf.js 会回退到备用方案）', async () => {
    await expect(bd.fetch({ kind: 'cMapUrl', filename: 'Nope.bcmap' })).rejects.toThrow(/未打包/);
    await expect(bd.fetch({ kind: 'iccUrl', filename: 'x.icc' })).rejects.toThrow(/未打包/);
  });
});

describe('worker 脚本改造（file:// 下只能用经典 blob worker）', () => {
  it('去掉结尾的 export、把 import.meta.url 换成 self.location.href，其余原样', () => {
    const src = 'const a=1;var n=import.meta.url;try{new URL(".",n).href}catch{}var b=import.meta.url;globalThis.pdfjsWorker={W};export{W};';
    expect(toClassicWorkerSource(src)).toBe('const a=1;var n=self.location.href;try{new URL(".",n).href}catch{}var b=self.location.href;globalThis.pdfjsWorker={W};');
    expect(toClassicWorkerSource('x;export { A as B, C };\n')).toBe('x;');
    expect(toClassicWorkerSource('no module syntax here')).toBe('no module syntax here');
  });
  it('真实的 pdf.js worker 脚本改造后不再含模块语法', async () => {
    const { default: raw } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw');
    const out = toClassicWorkerSource(raw);
    expect(out).not.toContain('import.meta');
    expect(out).not.toMatch(/export\s*\{/);
    expect(out.length).toBeGreaterThan(raw.length - 200);
  });
});
