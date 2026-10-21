// CBZ 漫画（COMIC-001/002）：zip 里的图片按自然排序成页（固定版式 FixedBook），ComicInfo.xml 提供元数据与阅读方向。
// 渲染：renderPage 返回按目标尺寸解码的 ImageBitmap（调用方用完可 close()）；解码不可用的环境退回 HTMLImageElement。
import type { Book, BookMetadata, BookProbe, FixedBook, FormatParser, OpenOptions } from '@/core/book';
import { UnsupportedFormatError, corrupt, fmtMsg } from './errors';
import { imageSize } from './lib/imgsize';
import { isImageName, mimeOf, sniffImageMime } from './lib/mime';
import { ResourceStore } from './lib/resources';
import { metaFromFileName } from './lib/text';
import { firstDescendant, parseXml, textOfEl } from './lib/xml';
import { openZip, type ZipArchive } from './lib/zip';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 页文件：图片扩展名，排除隐藏文件与 __MACOSX（COMIC-001） */
export function comicPages(names: string[]): string[] {
  return names
    .filter((n) => isImageName(n) && !n.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX') && !/(^|\/)thumbs\.db$/i.test(n))
    .sort((a, b) => collator.compare(a, b));
}

export interface ComicInfo {
  title?: string;
  series?: string;
  number?: string;
  volume?: string;
  summary?: string;
  writer?: string;
  genre?: string;
  publisher?: string;
  year?: string;
  language?: string;
  manga?: string;
}

/** ComicInfo.xml：优先名为 ComicInfo.xml 的文件，否则第一个 .xml（COMIC-002） */
export async function readComicInfo(zip: ZipArchive): Promise<ComicInfo | null> {
  const path = zip.names.find((n) => /(^|\/)comicinfo\.xml$/i.test(n)) ?? zip.names.find((n) => /\.xml$/i.test(n) && !n.includes('__MACOSX'));
  if (!path) return null;
  try {
    const doc = parseXml(await zip.markup(path));
    const get = (n: string) => textOfEl(firstDescendant(doc, n.toLowerCase())) || undefined;
    if (!firstDescendant(doc, 'comicinfo')) return null;
    return { title: get('Title'), series: get('Series'), number: get('Number'), volume: get('Volume'), summary: get('Summary'), writer: get('Writer'), genre: get('Genre'), publisher: get('Publisher'), year: get('Year'), language: get('LanguageISO'), manga: get('Manga') };
  } catch {
    return null;
  }
}

function metaFrom(info: ComicInfo | null, fileName: string): BookMetadata {
  const fm = metaFromFileName(fileName);
  const meta: BookMetadata = { title: info?.title || fm.title, authors: info?.writer ? info.writer.split(/\s*,\s*/).filter(Boolean) : fm.authors };
  if (info) {
    if (info.summary) meta.description = info.summary;
    if (info.genre) meta.subjects = info.genre.split(/\s*,\s*/).filter(Boolean);
    if (info.series) {
      meta.series = info.series;
      const n = Number(info.number);
      if (info.number && !Number.isNaN(n)) meta.seriesIndex = n;
    }
    if (info.publisher) meta.publisher = info.publisher;
    if (info.year) meta.published = info.year;
    if (info.language) meta.language = info.language;
    // Manga=YesAndRightToLeft 才是右到左；Yes 只表示日漫（左到右排版也有）
    if (/righttoleft/i.test(info.manga ?? '')) meta.direction = 'rtl';
  }
  return meta;
}

export interface ComicBook extends FixedBook {
  format: 'cbz';
}

export async function openCbz(file: Blob, opts: OpenOptions): Promise<ComicBook> {
  let zip: ZipArchive;
  try {
    zip = await openZip(file);
  } catch (e) {
    throw corrupt(e);
  }
  const pages = comicPages(zip.names);
  if (!pages.length) throw new UnsupportedFormatError(fmtMsg('emptyArchive'));
  const meta = metaFrom(await readComicInfo(zip), opts.fileName);
  const store = new ResourceStore();
  const sizes = new Map<number, { width: number; height: number }>();

  const pageBlob = async (i: number): Promise<Blob> => {
    const bytes = await zip.bytes(pages[i]);
    return new Blob([bytes as BlobPart], { type: sniffImageMime(bytes) ?? mimeOf(pages[i]) });
  };

  const decode = async (i: number, width: number, height: number, signal?: AbortSignal): Promise<CanvasImageSource> => {
    const blob = await pageBlob(i);
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (typeof createImageBitmap === 'function') {
      const full = await createImageBitmap(blob);
      if (full.width <= width * 1.05 || typeof createImageBitmap !== 'function') return full;
      // 目标比原图小很多：缩一份，省内存
      try {
        const scaled = await createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(width)), resizeHeight: Math.max(1, Math.round(height)), resizeQuality: 'high' });
        full.close();
        return scaled;
      } catch {
        return full;
      }
    }
    const url = store.blobUrl(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = url;
    });
    return img;
  };

  const book: ComicBook = {
    kind: 'fixed',
    format: 'cbz',
    metadata: meta,
    toc: [],
    pageCount: pages.length,
    async getPageSize(index) {
      const hit = sizes.get(index);
      if (hit) return hit;
      const bytes = await zip.bytes(pages[index]);
      let size = imageSize(bytes);
      if (!size && typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
        size = { width: bmp.width, height: bmp.height };
        bmp.close();
      }
      const s = size ?? { width: 1, height: 1 };
      sizes.set(index, s);
      return s;
    },
    async renderPage(index, o) {
      if (index < 0 || index >= pages.length) throw new RangeError('页码越界');
      return decode(index, o.width * o.dpr, o.height * o.dpr, o.signal);
    },
    getCover: async () => pageBlob(0),
    destroy() {
      store.destroy();
      sizes.clear();
    },
  };
  return book;
}

export async function probeCbz(file: Blob, opts: OpenOptions): Promise<BookProbe> {
  let zip: ZipArchive;
  try {
    zip = await openZip(file);
  } catch (e) {
    throw corrupt(e);
  }
  const pages = comicPages(zip.names);
  if (!pages.length) throw new UnsupportedFormatError(fmtMsg('emptyArchive'));
  const bytes = await zip.bytes(pages[0]);
  return {
    format: 'cbz',
    metadata: metaFrom(await readComicInfo(zip), opts.fileName),
    cover: new Blob([bytes as BlobPart], { type: sniffImageMime(bytes) ?? mimeOf(pages[0]) }),
    size: { pages: pages.length },
  };
}

export const cbzParser: FormatParser = {
  format: 'cbz',
  extensions: ['cbz'],
  open: (file, opts): Promise<Book> => openCbz(file, opts),
  probe: probeCbz,
};

