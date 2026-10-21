// 封面体系（LIB-019）：提取到的真实封面 → 缩略图；没有封面时程序生成占位图（不使用 apk 里的图片）；用户自定义封面；在线搜图。
import { useEffect, useState } from 'react';
import type { BookRecord, CoverKind } from '@/core/library';
import { dbEvents, getCover, putCover, deleteCover, updateBook } from '@/storage/db';
import { proxyFetch } from '@/storage/http';
import { shelfSettings } from './settings';

/** 封面查找优先级（LIB-019 的 _3 > _1 > _2 > .png） */
export const COVER_PRIORITY: CoverKind[] = ['edit', 'thumb', 'cover', 'net'];

// ───────────── 占位封面 ─────────────
/** 6 套缺省封面配色（原 app 有 cover100..105 六张内置图，这里用程序生成的渐变） */
export const PALETTES = [
  { from: '#8e6e53', to: '#5d4037', fg: '#fff3e0' },
  { from: '#4a7c8c', to: '#264e5d', fg: '#e0f2f1' },
  { from: '#7a5c8c', to: '#472a5e', fg: '#f3e5f5' },
  { from: '#5c8c5a', to: '#2e5a35', fg: '#e8f5e9' },
  { from: '#3f5f9a', to: '#1f3563', fg: '#e3f2fd' },
  { from: '#a65a4d', to: '#6e2c26', fg: '#fbe9e7' },
] as const;

const isCjk = (ch: string) => /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch);

/** 按显示宽度折行：汉字宽 1，其它约 0.55 */
export function wrapTitle(text: string, limit = 7, maxLines = 5): string[] {
  const lines: string[] = [];
  let cur = '';
  let w = 0;
  for (const ch of [...text.replace(/\s+/g, ' ').trim()]) {
    const cw = isCjk(ch) ? 1 : 0.55;
    if (w + cw > limit && cur) {
      lines.push(cur.trim());
      cur = '';
      w = 0;
      if (ch === ' ') continue;
    }
    cur += ch;
    w += cw;
  }
  if (cur.trim()) lines.push(cur.trim());
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/.?$/, '…');
    return cut;
  }
  return lines;
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 生成封面 SVG 文本（宽高比 70:100） */
export function coverSvg(title: string, author: string, paletteIdx: number): string {
  const p = PALETTES[((paletteIdx % PALETTES.length) + PALETTES.length) % PALETTES.length];
  const lines = wrapTitle(title || ' ', 6.4, 5);
  const fs = 8.4;
  const startY = 38 - ((lines.length - 1) * fs * 1.25) / 2;
  const text = lines.map((l, i) => `<text x="35" y="${(startY + i * fs * 1.25).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="${p.fg}">${xmlEsc(l)}</text>`).join('');
  const au = author ? `<text x="35" y="90" text-anchor="middle" font-size="5.2" fill="${p.fg}" fill-opacity=".8">${xmlEsc(wrapTitle(author, 11, 1)[0] ?? '')}</text>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 100" font-family="system-ui,'PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient></defs>` +
    `<rect width="70" height="100" fill="url(#g)"/><rect x="4" y="4" width="62" height="92" fill="none" stroke="${p.fg}" stroke-opacity=".35" stroke-width=".6"/>` +
    `<rect x="0" width="3" height="100" fill="#000" fill-opacity=".18"/>${text}${au}</svg>`
  );
}

const svgCache = new Map<string, string>();
/** paletteIdx < 0 = 自动：按书名哈希挑一套配色，书架上不至于一片同色 */
export function placeholderUrl(book: Pick<BookRecord, 'id' | 'title' | 'authors'>, paletteSetting = shelfSettings.get().defaultCover): string {
  const paletteIdx = paletteSetting >= 0 ? paletteSetting : hashStr(book.title) % PALETTES.length;
  const key = `${book.id}|${paletteIdx}|${book.title}`;
  let u = svgCache.get(key);
  if (!u) {
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverSvg(book.title, book.authors.join(' & '), paletteIdx))}`;
    if (svgCache.size > 800) svgCache.clear();
    svgCache.set(key, u);
  }
  return u;
}

/** 「封面文字」自定义封面 / 选用内置配色 → 作为 edit 封面保存的 SVG Blob */
export function svgCoverBlob(text: string, author: string, paletteIdx: number): Blob {
  return new Blob([coverSvg(text, author, paletteIdx)], { type: 'image/svg+xml' });
}

// ───────────── 缩略图 ─────────────
/** 缩成约 `height` 高的 JPEG；环境没有画布（测试）或解码失败时原样返回 */
export async function makeThumb(blob: Blob, height = 360): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== 'function') return blob;
    const bmp = await createImageBitmap(blob);
    if (bmp.height <= height) {
      bmp.close?.();
      return blob;
    }
    const w = Math.max(1, Math.round((bmp.width * height) / bmp.height));
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(w, height);
      c.getContext('2d')!.drawImage(bmp, 0, 0, w, height);
      bmp.close?.();
      return await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = height;
    c.getContext('2d')!.drawImage(bmp, 0, 0, w, height);
    bmp.close?.();
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? blob), 'image/jpeg', 0.86));
  } catch {
    return blob;
  }
}

/** 保存提取到的封面：原图 + 缩略图 */
export async function storeExtractedCover(bookId: string, cover: Blob): Promise<void> {
  await putCover(bookId, 'cover', cover);
  await putCover(bookId, 'thumb', await makeThumb(cover));
}

/** 用户自选封面（上传/在线搜图/文字封面）：存为 edit，并保证书记录标记有封面 */
export async function setCustomCover(bookId: string, blob: Blob): Promise<void> {
  const thumb = blob.type === 'image/svg+xml' ? blob : await makeThumb(blob, 480);
  await putCover(bookId, 'edit', thumb);
  await updateBook(bookId, { hasCover: true });
}

/** 恢复默认：删除自定义封面（原「恢复」按钮） */
export async function restoreCover(bookId: string): Promise<void> {
  await deleteCover(bookId, 'edit');
  const rest = await Promise.all((['thumb', 'cover', 'net'] as CoverKind[]).map((k) => getCover(bookId, k)));
  await updateBook(bookId, { hasCover: rest.some(Boolean) });
}

// ───────────── 显示：封面 URL 缓存与 hook ─────────────
interface CacheEntry {
  url?: string;
  promise?: Promise<string | undefined>;
}
const cache = new Map<string, CacheEntry>();
const listeners = new Set<() => void>();

dbEvents.on('change', (e) => {
  if (e.store !== 'covers') return;
  if (e.bookId) {
    const c = cache.get(e.bookId);
    if (c?.url) URL.revokeObjectURL(c.url);
    cache.delete(e.bookId);
  } else {
    // 批量变更（重建封面、恢复备份）：整个缓存作废
    for (const c of cache.values()) if (c.url) URL.revokeObjectURL(c.url);
    cache.clear();
  }
  listeners.forEach((l) => l());
});

export async function loadCoverUrl(bookId: string): Promise<string | undefined> {
  let ent = cache.get(bookId);
  if (ent?.url) return ent.url;
  if (ent?.promise) return ent.promise;
  ent = {};
  ent.promise = (async () => {
    for (const kind of COVER_PRIORITY) {
      const blob = await getCover(bookId, kind);
      if (blob) {
        const url = URL.createObjectURL(blob);
        ent!.url = url;
        return url;
      }
    }
    return undefined;
  })();
  cache.set(bookId, ent);
  const url = await ent.promise;
  if (!url) cache.delete(bookId);
  return url;
}

/** 书的封面地址：有真实封面给 blob URL，否则给程序生成的占位图 */
export function useCoverUrl(book: Pick<BookRecord, 'id' | 'hasCover' | 'title' | 'authors'>): { url: string; real: boolean } {
  const [, force] = useState(0);
  const [url, setUrl] = useState<string | undefined>(() => cache.get(book.id)?.url);
  const palette = shelfSettings.use((s) => s.defaultCover);
  useEffect(() => {
    let live = true;
    const run = () => {
      if (!book.hasCover) {
        setUrl(undefined);
        return;
      }
      void loadCoverUrl(book.id).then((u) => live && setUrl(u));
    };
    run();
    const l = () => {
      run();
      force((n) => n + 1);
    };
    listeners.add(l);
    return () => {
      live = false;
      listeners.delete(l);
    };
  }, [book.id, book.hasCover]);
  if (url) return { url, real: true };
  return { url: placeholderUrl(book, palette), real: false };
}

// ───────────── 在线搜图（P2） ─────────────
export interface CoverCandidate {
  id: string;
  /** 缩略图（<img> 直接显示） */
  thumb: string;
  /** 选中后下载的大图 */
  full: string;
  source: string;
  title?: string;
}

async function getJson(url: string): Promise<any> {
  try {
    const r = await fetch(url);
    if (r.ok) return await r.json();
  } catch {
    /* CORS 或离线：转走服务端代理 */
  }
  const r = await proxyFetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`搜索失败：${r.status}`);
  return r.json();
}

/** 搜索关键字：书名 + 作者，去掉 _ - 与 (TXT)(HTML) 之类标记；太短时补「封面」（原 PrefDownloadCover 的规则） */
export function coverSearchQuery(title: string, author: string): string {
  const q = `${title} ${author}`.replace(/[_-]/g, ' ').replace(/\((TXT|HTML|PDF|DJVU|CBZ)\)/gi, ' ').replace(/\s+/g, ' ').trim();
  return q.length < 8 ? `${q} 封面` : q;
}

export async function searchCovers(title: string, author: string, engine: 'openlibrary' | 'googlebooks' = 'openlibrary'): Promise<CoverCandidate[]> {
  const out: CoverCandidate[] = [];
  const run = async (which: 'openlibrary' | 'googlebooks') => {
    if (which === 'openlibrary') {
      const q = encodeURIComponent(`${title} ${author}`.trim());
      const j = await getJson(`https://openlibrary.org/search.json?q=${q}&limit=24&fields=key,title,cover_i`);
      for (const d of (j.docs ?? []) as { key: string; title: string; cover_i?: number }[]) {
        if (!d.cover_i) continue;
        out.push({ id: `ol${d.cover_i}`, thumb: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`, full: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`, source: 'Open Library', title: d.title });
      }
    } else {
      const q = encodeURIComponent(coverSearchQuery(title, author));
      const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=20`);
      for (const it of (j.items ?? []) as { id: string; volumeInfo?: { title?: string; imageLinks?: { thumbnail?: string; smallThumbnail?: string } } }[]) {
        const img = it.volumeInfo?.imageLinks?.thumbnail ?? it.volumeInfo?.imageLinks?.smallThumbnail;
        if (!img) continue;
        const https = img.replace(/^http:/, 'https:');
        out.push({ id: `gb${it.id}`, thumb: https, full: https.replace('zoom=1', 'zoom=2'), source: 'Google Books', title: it.volumeInfo?.title });
      }
    }
  };
  try {
    await run(engine);
  } catch (e) {
    if (engine === 'openlibrary') await run('googlebooks').catch(() => {
      throw e;
    });
    else throw e;
  }
  if (out.length === 0 && engine === 'openlibrary') await run('googlebooks').catch(() => undefined);
  return out;
}

/** 下载封面图为 Blob：先直连，失败再经代理 */
export async function fetchImageBlob(url: string): Promise<Blob> {
  try {
    const r = await fetch(url);
    if (r.ok) {
      const b = await r.blob();
      if (b.type.startsWith('image/')) return b;
    }
  } catch {
    /* 转代理 */
  }
  const r = await proxyFetch(url, { headers: { Accept: 'image/*' } });
  if (!r.ok) throw new Error(`下载封面失败：${r.status}`);
  const b = await r.blob();
  if (!b.type.startsWith('image/') && b.size < 200) throw new Error('下载到的不是图片');
  return b;
}
