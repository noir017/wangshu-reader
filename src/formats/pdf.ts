// PDF（PDF-001/003 + FMT-018 元数据/封面）：pdfjs-dist → FixedBook。
// - worker 用 `?worker&inline` 打进包里（单文件构建也能用）；所有文档共享一个 worker，引用计数，闲置 5 秒后回收。
// - 密码：opts.extra.password；缺密码/密码错抛 PasswordRequiredError（reason 区分），阅读页据此弹密码框后带 password 重试。
// - CJK 预定义 CMap（非内嵌字体的中日韩 PDF 需要）从包里懒加载；标准字体、JPX/ICC 的 wasm 不打包（回退到系统字体/跳过这类图片）。
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { Book, BookMetadata, BookProbe, FixedBook, FixedPageText, FormatParser, OpenOptions, TocEntry } from '@/core/book';
import { PasswordRequiredError, UnsupportedFormatError, corrupt } from './errors';
import { readBytes, startsWithAscii } from './lib/bytes';
import { metaFromFileName } from './lib/text';

type Pdfjs = typeof import('pdfjs-dist');

// ───────────────────────── CMap（懒加载，只打包常用的 CJK 集合） ─────────────────────────
const CMAP_LOADERS = import.meta.glob(['/node_modules/pdfjs-dist/cmaps/*.bcmap', '!/node_modules/pdfjs-dist/cmaps/*UTF32*', '!/node_modules/pdfjs-dist/cmaps/*UTF8*', '!/node_modules/pdfjs-dist/cmaps/UniJIS2004*', '!/node_modules/pdfjs-dist/cmaps/UniJISX*'], {
  query: '?inline',
  import: 'default',
}) as Record<string, () => Promise<string>>;

function dataUriToBytes(uri: string): Uint8Array {
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class BundledBinaryData {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (kind !== 'cMapUrl') throw new Error(`未打包的数据：${kind}`);
    const load = CMAP_LOADERS[`/node_modules/pdfjs-dist/cmaps/${filename}`];
    if (!load) throw new Error(`未打包的 CMap：${filename}`);
    return dataUriToBytes(await load());
  }
}

// ───────────────────────── 画布（浏览器用 canvas，没有 DOM 时退到 OffscreenCanvas；测试可注入） ─────────────────────────
export interface CanvasHandle {
  canvas: CanvasImageSource & { width: number; height: number };
  ctx: CanvasRenderingContext2D;
  toBlob(type: string, quality?: number): Promise<Blob | null>;
}
let canvasFactory: ((w: number, h: number) => CanvasHandle) | null = null;
/** 测试用：在没有真实 canvas 的环境（Node）里注入画布实现 */
export function __setPdfCanvasFactory(f: ((w: number, h: number) => CanvasHandle) | null): void {
  canvasFactory = f;
}

function makeCanvas(w: number, h: number): CanvasHandle {
  if (canvasFactory) return canvasFactory(w, h);
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) return { canvas: c, ctx, toBlob: (type, q) => new Promise((res) => c.toBlob(res, type, q)) };
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
    return { canvas: c, ctx, toBlob: (type, q) => c.convertToBlob({ type, quality: q }) };
  }
  throw new Error('当前环境没有可用的 canvas，无法渲染 PDF');
}

// ───────────────────────── pdfjs 与 worker（共享，引用计数） ─────────────────────────
let pdfjsPromise: Promise<Pdfjs> | null = null;
function loadPdfjs(): Promise<Pdfjs> {
  return (pdfjsPromise ??= import('pdfjs-dist'));
}

interface SharedWorker {
  worker: InstanceType<Pdfjs['PDFWorker']>;
  port: Worker | null;
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
}
let shared: SharedWorker | null = null;

async function createPort(): Promise<Worker | null> {
  if (typeof Worker === 'undefined') return null; // Node/测试：pdfjs 自己用主线程「假 worker」
  const mod = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline');
  return new mod.default();
}

async function acquireWorker(pdfjs: Pdfjs): Promise<SharedWorker> {
  if (!shared) {
    const port = await createPort();
    shared = { worker: port ? new pdfjs.PDFWorker({ port }) : new pdfjs.PDFWorker(), port, refs: 0 };
  }
  clearTimeout(shared.timer);
  shared.refs++;
  return shared;
}

function releaseWorker(w: SharedWorker): void {
  w.refs--;
  if (w.refs > 0) return;
  w.timer = setTimeout(() => {
    if (shared === w && w.refs <= 0) {
      shared = null;
      try {
        w.worker.destroy();
      } finally {
        w.port?.terminate();
      }
    }
  }, 5000);
}

// ───────────────────────── 元数据 / 目录 ─────────────────────────
/** 原版 validatedPdfMetaTitle：含 < 与 > 的标题（多半是乱码或 XML 残片）不要 */
export function validPdfTitle(t: unknown): t is string {
  return typeof t === 'string' && t.trim() !== '' && !(t.includes('<') && t.includes('>'));
}

async function readMeta(doc: PDFDocumentProxy, fileName: string): Promise<BookMetadata> {
  const fm = metaFromFileName(fileName);
  const meta: BookMetadata = { title: fm.title, authors: fm.authors };
  try {
    const md = await doc.getMetadata();
    const info = (md.info ?? {}) as Record<string, unknown>;
    const dcTitle = (md.metadata as { get?: (k: string) => unknown } | null)?.get?.('dc:title');
    const title = validPdfTitle(info.Title) ? info.Title : validPdfTitle(dcTitle) ? dcTitle : undefined;
    if (title) meta.title = title.trim();
    if (typeof info.Author === 'string' && info.Author.trim()) meta.authors = [info.Author.trim()];
    if (typeof info.Subject === 'string' && info.Subject.trim() && info.Subject.trim() !== meta.title) meta.description = info.Subject.trim();
    if (typeof info.Keywords === 'string' && info.Keywords.trim()) meta.subjects = info.Keywords.split(/[,;，；]\s*/).map((s) => s.trim()).filter(Boolean);
    if (typeof info.Language === 'string' && info.Language.trim()) meta.language = info.Language.trim();
  } catch {
    /* 元数据损坏：用文件名 */
  }
  return meta;
}

async function readOutline(doc: PDFDocumentProxy): Promise<TocEntry[]> {
  let outline: Awaited<ReturnType<PDFDocumentProxy['getOutline']>> | null = null;
  try {
    outline = await doc.getOutline();
  } catch {
    return [];
  }
  if (!outline) return [];
  const toPage = async (dest: unknown): Promise<number | null> => {
    try {
      let d = dest;
      if (typeof d === 'string') d = await doc.getDestination(d);
      if (!Array.isArray(d) || !d.length) return null;
      const ref = d[0];
      if (ref && typeof ref === 'object') return await doc.getPageIndex(ref as never);
      if (Number.isInteger(ref)) return ref as number;
    } catch {
      /* 目的地损坏 */
    }
    return null;
  };
  const out: TocEntry[] = [];
  const walk = async (items: typeof outline, level: number) => {
    for (const it of items ?? []) {
      const title = (it.title ?? '').replace(/\s+/g, ' ').trim();
      const page = await toPage(it.dest);
      if (title && page !== null) out.push({ title: title.length > 403 ? `${title.slice(0, 400)}...` : title, level, section: Math.min(page, doc.numPages - 1) });
      if (it.items?.length) await walk(it.items as typeof outline, level + 1);
    }
  };
  await walk(outline, 0);
  return out;
}

// ───────────────────────── 打开 ─────────────────────────
interface Opened {
  doc: PDFDocumentProxy;
  pdfjs: Pdfjs;
  release: () => Promise<void>;
}

async function openDoc(file: Blob, opts: OpenOptions): Promise<Opened> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (!new TextDecoder('latin1').decode(head).includes('%PDF-')) throw new UnsupportedFormatError('不是有效的 PDF 文件');
  const pdfjs = await loadPdfjs();
  const w = await acquireWorker(pdfjs);
  const password = typeof opts.extra?.password === 'string' ? opts.extra.password : undefined;
  const task = pdfjs.getDocument({
    data: await readBytes(file),
    password,
    worker: w.worker,
    verbosity: 0,
    isEvalSupported: false,
    BinaryDataFactory: BundledBinaryData as never,
    useWasm: false,
  });
  const release = async () => {
    try {
      await task.destroy();
    } finally {
      releaseWorker(w);
    }
  };
  try {
    const doc = await task.promise;
    return { doc, pdfjs, release };
  } catch (e) {
    await release().catch(() => undefined);
    if (e instanceof pdfjs.PasswordException || (e as { name?: string })?.name === 'PasswordException') {
      const code = (e as { code?: number }).code;
      throw new PasswordRequiredError(code === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'need');
    }
    if ((e as { name?: string })?.name === 'InvalidPDFException') throw new UnsupportedFormatError('PDF 文件已损坏或格式不正确');
    throw corrupt(e);
  }
}

export interface PdfBook extends FixedBook {
  format: 'pdf';
}

export async function openPdf(file: Blob, opts: OpenOptions): Promise<PdfBook> {
  const { doc, release } = await openDoc(file, opts);
  const metadata = await readMeta(doc, opts.fileName);
  const toc = await readOutline(doc);
  const pageCache = new Map<number, Promise<PDFPageProxy>>();
  const getPage = (i: number) => {
    if (i < 0 || i >= doc.numPages) return Promise.reject(new RangeError('页码越界'));
    let p = pageCache.get(i);
    if (!p) {
      p = doc.getPage(i + 1);
      pageCache.set(i, p);
      if (pageCache.size > 12) pageCache.delete(pageCache.keys().next().value as number);
    }
    return p;
  };
  let destroyed = false;

  const book: PdfBook = {
    kind: 'fixed',
    format: 'pdf',
    metadata,
    toc,
    pageCount: doc.numPages,
    async getPageSize(index) {
      const v = (await getPage(index)).getViewport({ scale: 1 });
      return { width: v.width, height: v.height };
    },
    async renderPage(index, o) {
      const page = await getPage(index);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min((o.width * o.dpr) / base.width, (o.height * o.dpr) / base.height);
      const viewport = page.getViewport({ scale: scale > 0 && Number.isFinite(scale) ? scale : 1 });
      const h = makeCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
      const task = page.render({ canvasContext: h.ctx, canvas: null, viewport } as never);
      const onAbort = () => task.cancel();
      o.signal?.addEventListener('abort', onAbort);
      try {
        if (o.signal?.aborted) task.cancel();
        await task.promise;
      } catch (e) {
        if ((e as { name?: string })?.name === 'RenderingCancelledException') throw new DOMException('已取消', 'AbortError');
        throw e;
      } finally {
        o.signal?.removeEventListener('abort', onAbort);
        page.cleanup();
      }
      return h.canvas;
    },
    async getPageText(index): Promise<FixedPageText | null> {
      const page = await getPage(index);
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      let text = '';
      const items: FixedPageText['items'] = [];
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        const it = raw as { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };
        const start = text.length;
        text += it.str;
        if (it.str) {
          const [a, b, c, d, e, f] = it.transform;
          const wl = Math.hypot(a, b) || 1;
          const hl = Math.hypot(c, d) || 1;
          const ux = [a / wl, b / wl];
          const uy = [c / hl, d / hl];
          const w = it.width;
          const h = it.height || hl;
          const corners = [
            [e, f],
            [e + ux[0] * w, f + ux[1] * w],
            [e + uy[0] * h, f + uy[1] * h],
            [e + ux[0] * w + uy[0] * h, f + ux[1] * w + uy[1] * h],
          ].map(([x, y]) => vp.convertToViewportPoint(x, y));
          const xs = corners.map((p) => p[0]);
          const ys = corners.map((p) => p[1]);
          const x0 = Math.min(...xs);
          const y0 = Math.min(...ys);
          const clamp = (v: number) => Math.max(0, Math.min(1, v));
          items.push({ start, end: text.length, x: clamp(x0 / vp.width), y: clamp(y0 / vp.height), w: clamp((Math.max(...xs) - x0) / vp.width), h: clamp((Math.max(...ys) - y0) / vp.height) });
        }
        if (it.hasEOL) text += '\n';
      }
      return { text, items };
    },
    async getCover() {
      const size = await book.getPageSize(0);
      const w = 360;
      const img = (await book.renderPage(0, { width: w, height: (w * size.height) / size.width, dpr: 1 })) as CanvasImageSource & { toBlob?: unknown };
      return canvasToBlob(img);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pageCache.clear();
      void release().catch(() => undefined);
    },
  };
  return book;
}

/** 封面用：把 renderPage 返回的画布转成 JPEG */
async function canvasToBlob(img: CanvasImageSource): Promise<Blob | null> {
  const c = img as unknown as { toBlob?: (cb: (b: Blob | null) => void, t?: string, q?: number) => void; convertToBlob?: (o: { type: string; quality: number }) => Promise<Blob>; toBuffer?: (t: string) => Uint8Array };
  if (typeof c.toBlob === 'function') return new Promise((res) => c.toBlob!((b) => res(b), 'image/jpeg', 0.85));
  if (typeof c.convertToBlob === 'function') return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  if (typeof c.toBuffer === 'function') return new Blob([c.toBuffer('image/jpeg') as BlobPart], { type: 'image/jpeg' });
  return null;
}

export async function probePdf(file: Blob, opts: OpenOptions): Promise<BookProbe> {
  const fm = metaFromFileName(opts.fileName);
  let book: PdfBook;
  try {
    book = await openPdf(file, opts);
  } catch (e) {
    // 加密 PDF 没给密码：导入书架时仍应能入库（只是没有封面/元数据）
    if (e instanceof PasswordRequiredError) return { format: 'pdf', metadata: { title: fm.title, authors: fm.authors }, cover: null };
    throw e;
  }
  try {
    let cover: Blob | null = null;
    try {
      cover = await book.getCover();
    } catch {
      /* 渲染失败：没有封面 */
    }
    return { format: 'pdf', metadata: book.metadata, cover, size: { pages: book.pageCount } };
  } finally {
    book.destroy();
  }
}

export const pdfParser: FormatParser = {
  format: 'pdf',
  extensions: ['pdf'],
  sniff: (head) => startsWithAscii(head, '%PDF-') || new TextDecoder('latin1').decode(head.subarray(0, 1024)).includes('%PDF-'),
  open: (file, opts): Promise<Book> => openPdf(file, opts),
  probe: probePdf,
};
