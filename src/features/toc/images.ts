// 书内图片索引（TOC-006）：扫描各章 bodyHtml 里的 <img>/<image>。结果按 Book 缓存。
import type { Book } from '@/core/book';

export interface BookImage {
  src: string;
  section: number;
  /** 在本章第几张（0 起） */
  index: number;
}

const IMG_RE = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi;
const SVG_IMG_RE = /<image\b[^>]*?\b(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi;

/** 从章节 HTML 取出图片地址（文档顺序） */
export function extractImageSrcs(html: string): string[] {
  const found: { at: number; src: string }[] = [];
  for (const re of [IMG_RE, SVG_IMG_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(html); m; m = re.exec(html)) found.push({ at: m.index, src: m[2].replace(/&amp;/g, '&') });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.src);
}

const cache = new WeakMap<Book, Promise<BookImage[]>>();
const existence = new WeakMap<Book, Promise<boolean>>();

export interface ScanOptions {
  onProgress?: (done: number, total: number) => void;
  /** 只是不再等结果：整本扫描是共享且带缓存的，不能因为某个调用方放弃（面板关了、StrictMode 重挂载）就中断 */
  signal?: AbortSignal;
}

const progressListeners = new WeakMap<Book, Set<(done: number, total: number) => void>>();

function waitWithSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
  return Promise.race([p, new Promise<T>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))]);
}

export function scanBookImages(book: Book, opts: ScanOptions = {}): Promise<BookImage[]> {
  if (book.kind !== 'reflowable') return Promise.resolve([]);
  if (opts.onProgress) {
    let set = progressListeners.get(book);
    if (!set) progressListeners.set(book, (set = new Set()));
    set.add(opts.onProgress);
  }
  const hit = cache.get(book);
  if (hit) return waitWithSignal(hit, opts.signal);
  const p = (async () => {
    const out: BookImage[] = [];
    const secs = book.sections;
    for (let s = 0; s < secs.length; s++) {
      try {
        const content = await secs[s].load();
        extractImageSrcs(content.bodyHtml).forEach((src, index) => out.push({ src, section: s, index }));
      } catch {
        /* 单章加载失败不影响其余 */
      }
      for (const fn of progressListeners.get(book) ?? []) fn(s + 1, secs.length);
    }
    return out;
  })();
  p.catch(() => cache.delete(book));
  cache.set(book, p);
  return waitWithSignal(p, opts.signal);
}

/** 是否有图：整本扫描过就用结果，否则抽样最多 40 章（均匀分布）快速判断 */
export function bookHasImages(book: Book): Promise<boolean> {
  if (book.kind !== 'reflowable') return Promise.resolve(false);
  const done = cache.get(book);
  if (done) return done.then((l) => l.length > 0).catch(() => false);
  let p = existence.get(book);
  if (!p) {
    p = (async () => {
      const n = book.sections.length;
      const step = Math.max(1, Math.floor(n / 40));
      for (let s = 0; s < n; s += step) {
        try {
          const c = await book.sections[s].load();
          if (extractImageSrcs(c.bodyHtml).length) return true;
        } catch {
          /* 忽略 */
        }
      }
      return false;
    })();
    existence.set(book, p);
  }
  return p;
}
