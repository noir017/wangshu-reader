// 封面缩略图：从 EPUB / FB2 / 漫画压缩包 / 图片取封面，并（可用时）缩放成 JPEG。
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { extractEntryBuffer, listArchive, type ArchiveEntry, type ArchiveListing } from './archive';
import { extOf, mimeOf } from '../util/http';
import { naturalCompare } from '../util/text';

const IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp']);
const MAX_COVER_BYTES = 32 * 1024 * 1024;

export interface CoverImage {
  data: Buffer;
  mime: string;
}

const isImageName = (n: string) => IMG_EXTS.has(extOf(n));

/** 压缩包里按自然顺序的第一张图片（漫画封面 = 排序后第一张） */
export function firstImageEntry(listing: ArchiveListing): ArchiveEntry | undefined {
  return listing.entries
    .filter((e) => !e.dir && !e.symlink && !e.encrypted && isImageName(e.path) && !e.path.split('/').some((s) => s.startsWith('.') || s === '__MACOSX'))
    .sort((a, b) => naturalCompare(a.path, b.path))[0];
}

function attrs(tag: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) m.set(a[1].toLowerCase(), a[2] ?? a[3] ?? '');
  return m;
}

function resolveInZip(base: string, href: string): string {
  let h = href.split('#')[0];
  try {
    h = decodeURIComponent(h);
  } catch {
    /* 保持原样 */
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(base), h)).replace(/^\/+/, '');
}

/** 在 OPF 文本里找封面图的 href（相对 OPF） */
export function findEpubCoverHref(opf: string): string | undefined {
  const items = [...opf.matchAll(/<item\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const byId = new Map(items.map((a) => [a.get('id') ?? '', a]));
  const isImg = (a: Map<string, string>) => /^image\//i.test(a.get('media-type') ?? '') || isImageName(a.get('href') ?? '');
  // EPUB 3：properties="cover-image"
  const p3 = items.find((a) => /(^|\s)cover-image(\s|$)/.test(a.get('properties') ?? ''));
  if (p3?.get('href')) return p3.get('href');
  // EPUB 2：<meta name="cover" content="id">
  for (const m of opf.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (a.get('name') === 'cover' && a.get('content')) {
      const it = byId.get(a.get('content')!);
      if (it?.get('href') && isImg(it)) return it.get('href');
    }
  }
  const named = items.find((a) => isImg(a) && /cover/i.test(`${a.get('id')} ${a.get('href')}`));
  if (named?.get('href')) return named.get('href');
  return items.find(isImg)?.get('href');
}

async function epubCover(file: string): Promise<CoverImage | null> {
  const listing = await listArchive(file);
  const find = (p: string) => listing.entries.find((e) => e.path === p);
  const container = find('META-INF/container.xml');
  if (!container) return null;
  const cxml = (await extractEntryBuffer(file, container, listing.codepage, 1024 * 1024)).toString('utf8');
  const opfPath = /full-path\s*=\s*["']([^"']+)["']/i.exec(cxml)?.[1];
  const opfEntry = opfPath ? find(opfPath) : undefined;
  if (!opfPath || !opfEntry) return null;
  const opf = (await extractEntryBuffer(file, opfEntry, listing.codepage, 8 * 1024 * 1024)).toString('utf8');
  const href = findEpubCoverHref(opf);
  if (!href) return null;
  const img = find(resolveInZip(opfPath, href));
  if (!img || img.dir) return null;
  return { data: await extractEntryBuffer(file, img, listing.codepage, MAX_COVER_BYTES), mime: mimeOf(img.path) };
}

async function archiveCover(file: string): Promise<CoverImage | null> {
  const listing = await listArchive(file);
  const first = firstImageEntry(listing);
  if (!first) return null;
  return { data: await extractEntryBuffer(file, first, listing.codepage, MAX_COVER_BYTES), mime: mimeOf(first.path) };
}

/** FB2：<coverpage><image l:href="#id"/> → <binary id="id">base64</binary> */
export function fb2CoverFromXml(xml: string): CoverImage | null {
  const href = /<coverpage\b[\s\S]*?<image\b[^>]*?href\s*=\s*["']#?([^"']+)["']/i.exec(xml)?.[1];
  if (!href) return null;
  const esc = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`<binary\\b[^>]*\\bid\\s*=\\s*["']${esc}["'][^>]*>([\\s\\S]*?)</binary>`, 'i').exec(xml);
  if (!m) return null;
  const ct = /content-type\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? 'image/jpeg';
  const data = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  return data.length ? { data, mime: ct } : null;
}

async function fb2Cover(file: string): Promise<CoverImage | null> {
  const st = await stat(file);
  if (st.size > 200 * 1024 * 1024) return null;
  // 只需要 ASCII 的 base64 部分，按 latin1 读即可，不用关心声明的文本编码
  return fb2CoverFromXml((await readFile(file)).toString('latin1'));
}

async function readHead(file: string, n: number): Promise<Buffer> {
  const fh = await open(file, 'r');
  try {
    const b = Buffer.alloc(n);
    const { bytesRead } = await fh.read(b, 0, n, 0);
    return b.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** 按扩展名取封面；取不到返回 null */
export async function extractCover(file: string): Promise<CoverImage | null> {
  const ext = extOf(file);
  if (isImageName(file)) {
    const st = await stat(file);
    return st.size > MAX_COVER_BYTES ? null : { data: await readFile(file), mime: mimeOf(file) };
  }
  if (ext === 'epub') return epubCover(file);
  if (ext === 'fb2') return fb2Cover(file);
  if (['cbz', 'cbr', 'cb7', 'zip', 'rar', '7z'].includes(ext)) return archiveCover(file);
  if (ext === 'pdf' || ext === 'txt') return null;
  // 扩展名不认识：看文件头是不是 EPUB/zip
  const head = await readHead(file, 4);
  if (head[0] === 0x50 && head[1] === 0x4b) return (await epubCover(file).catch(() => null)) ?? archiveCover(file);
  return null;
}

type CanvasModule = typeof import('@napi-rs/canvas');
let canvasMod: CanvasModule | null | undefined;

async function loadCanvas(): Promise<CanvasModule | null> {
  if (canvasMod !== undefined) return canvasMod;
  try {
    canvasMod = await import('@napi-rs/canvas');
  } catch {
    canvasMod = null;
  }
  return canvasMod;
}

export const canResizeImages = async (): Promise<boolean> => !!(await loadCanvas());

/** 缩放到最长边 ≤ size 并转 JPEG（q80）；没有图像库或解码失败时原样返回 */
export async function makeThumbnail(cover: CoverImage, size: number): Promise<CoverImage> {
  const mod = await loadCanvas();
  if (!mod) return cover;
  try {
    const img = await mod.loadImage(cover.data);
    const scale = Math.min(1, size / Math.max(img.width, img.height));
    if (scale === 1 && cover.mime === 'image/jpeg') return cover;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = mod.createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // 透明 PNG 转 JPEG 时垫白底
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { data: await canvas.encode('jpeg', 80), mime: 'image/jpeg' };
  } catch {
    return cover;
  }
}
