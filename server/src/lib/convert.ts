// 格式转换：压缩包 → cbz、chm → epub、djvu → pdf。
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { extractAll, listArchive, assertExtractable, walkRegularFiles } from './archive';
import { convertChmToEpub } from './chm';
import { ZipWriter } from './zipwriter';
import { run, findCommand } from '../util/exec';
import { extOf, httpError } from '../util/http';
import { naturalCompare } from '../util/text';

export const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg']);

/** 漫画压缩包的扩展名（→ cbz） */
export const COMIC_ARCHIVE_EXTS = new Set(['cbr', 'cb7', 'rar', '7z', 'zip', 'cbz', 'cbt', 'tar']);

export interface ConversionPlan {
  kind: 'archive-to-cbz' | 'chm-to-epub' | 'djvu-to-pdf';
  to: 'cbz' | 'epub' | 'pdf';
}

export function planConversion(srcExt: string, to: string): ConversionPlan | undefined {
  if (to === 'cbz' && COMIC_ARCHIVE_EXTS.has(srcExt)) return { kind: 'archive-to-cbz', to: 'cbz' };
  if (to === 'epub' && srcExt === 'chm') return { kind: 'chm-to-epub', to: 'epub' };
  if (to === 'pdf' && (srcExt === 'djvu' || srcExt === 'djv')) return { kind: 'djvu-to-pdf', to: 'pdf' };
  return undefined;
}

/** 按文件头猜扩展名（前端没给 name 或扩展名不对时兜底） */
export async function sniffExt(file: string): Promise<string | undefined> {
  const fh = await open(file, 'r');
  try {
    const b = Buffer.alloc(16);
    await fh.read(b, 0, 16, 0);
    if (b.subarray(0, 4).toString('latin1') === 'Rar!') return 'rar';
    if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) return '7z';
    if (b.subarray(0, 4).toString('latin1') === 'ITSF') return 'chm';
    if (b.subarray(0, 8).toString('latin1') === 'AT&TFORM') return 'djvu';
    if (b[0] === 0x50 && b[1] === 0x4b) return 'zip';
    return undefined;
  } finally {
    await fh.close();
  }
}

/** 压缩包里取出图片（和 ComicInfo.xml）按自然顺序重新打成 cbz */
export async function archiveToCbz(inFile: string, outFile: string, workDir: string, maxExtractBytes: number): Promise<{ pages: number }> {
  const listing = await listArchive(inFile, { cache: false });
  assertExtractable(listing, maxExtractBytes);
  const xdir = path.join(workDir, 'x');
  await mkdir(xdir, { recursive: true });
  await extractAll(inFile, xdir, listing.codepage);
  const files = (await walkRegularFiles(xdir))
    .filter((f) => {
      const segs = f.rel.split('/');
      if (segs.some((s) => s.startsWith('.') || s === '__MACOSX')) return false;
      return IMAGE_EXTS.has(extOf(f.rel)) || segs[segs.length - 1].toLowerCase() === 'comicinfo.xml';
    })
    .sort((a, b) => naturalCompare(a.rel, b.rel));
  const pages = files.filter((f) => IMAGE_EXTS.has(extOf(f.rel))).length;
  if (!pages) throw httpError(422, '压缩包里没有找到图片');
  const zip = new ZipWriter(outFile);
  try {
    for (const f of files) await zip.add(f.rel, await readFile(f.abs), { compress: extOf(f.rel) === 'svg' || extOf(f.rel) === 'xml', mtime: new Date(f.mtime) });
    await zip.finish();
  } catch (e) {
    zip.abort();
    throw e;
  }
  return { pages };
}

export async function chmToEpub(inFile: string, outFile: string, workDir: string, fallbackTitle: string, maxExtractBytes: number): Promise<void> {
  const xdir = path.join(workDir, 'x');
  await mkdir(xdir, { recursive: true });
  await convertChmToEpub(inFile, outFile, xdir, { fallbackTitle, maxExtractBytes });
}

export async function djvuToPdf(inFile: string, outFile: string): Promise<void> {
  const bin = findCommand('ddjvu');
  if (!bin) throw httpError(501, '服务端没有安装 djvulibre（ddjvu），无法转换 DJVU');
  await run(bin, ['-format=pdf', inFile, outFile], { timeoutMs: 600_000, maxBuffer: 1024 * 1024 });
  const st = await stat(outFile).catch(() => null);
  if (!st || st.size === 0) throw httpError(422, 'DJVU 转换失败（文件可能已损坏）');
}
