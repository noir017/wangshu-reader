// 真实浏览器里验证格式解析的小页面（开发用，不进生产包）：选一个文件 → window.__run(extra) 返回摘要。
// 构建与运行方法见 project-scripts/moonreader-formats/browser-check.sh；主要用来确认 PDF 的 ?worker&inline 在浏览器里真能跑。
import type { Book } from '@/core/book';
import { openBook, probeBook } from '../index';

const progress = (s: string) => ((window as unknown as { __progress: string }).__progress = s);

async function summarize(book: Book) {
  const base = { kind: book.kind, format: book.format, title: book.metadata.title, authors: book.metadata.authors, toc: book.toc.length, cover: (await book.getCover())?.size ?? 0 };
  if (book.kind === 'reflowable') {
    const first = book.sections.findIndex((s) => s.charCount > 0);
    const c = first >= 0 ? await book.sections[first].load() : null;
    return { ...base, sections: book.sections.length, chars: book.sections.reduce((n, s) => n + s.charCount, 0), firstHtml: c?.bodyHtml.slice(0, 120) };
  }
  const size = await book.getPageSize(0);
  progress('render');
  const src = await book.renderPage(0, { width: 300, height: Math.round((300 * size.height) / size.width), dpr: 1 });
  // PDF 返回画布，漫画返回 ImageBitmap/Image：统一画到一张画布上数像素
  const w = (src as { width: number }).width;
  const h = (src as { height: number }).height;
  const img = document.createElement('canvas');
  img.width = w;
  img.height = h;
  const ctx = img.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  let dark = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] < 128) dark++;
  const text = await book.getPageText?.(0);
  return { ...base, pageCount: book.pageCount, size, rendered: { w: img.width, h: img.height, darkPixels: dark }, text: text?.text.slice(0, 80) ?? null, textItems: text?.items.length ?? 0 };
}

(window as unknown as { __run: unknown }).__run = async (extra?: Record<string, unknown>) => {
  const input = document.getElementById('f') as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) throw new Error('no file');
  try {
    progress('probe');
    const probe = await probeBook(file, { fileName: file.name, extra });
    progress('open');
    const book = await openBook(file, { fileName: file.name, extra });
    const s = await summarize(book);
    book.destroy();
    return { ok: true, probe: { format: probe.format, title: probe.metadata.title, cover: probe.cover?.size ?? 0 }, ...s };
  } catch (e) {
    const err = e as Error & { code?: string; reason?: string };
    return { ok: false, name: err.name, code: err.code, reason: err.reason, message: err.message };
  }
};
