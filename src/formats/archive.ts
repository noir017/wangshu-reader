// 压缩包里只有一本书时直接打开内部那本（FMT-001/FMT-020）：
//   ZIP 在浏览器里解；RAR/7z 走服务端（列目录 + 取条目，全是图片就整包转 CBZ 当漫画）。
// 里面有多本书 → ArchiveChoiceError（entries 给界面让用户选，选中后用 opts.extra.entry 重试）；一本也没有 → 「压缩包里没有可阅读的文件」。
// 内部文件名按「压缩包?内部路径」传给内层解析器，书名/作者的文件名规则取内部那个名字。
import type { Book, BookFormat, BookProbe, FormatParser, OpenOptions } from '@/core/book';
import { ArchiveChoiceError, BookOpenError, UnsupportedFormatError, corrupt, fmtMsg } from './errors';
import { isZip, startsWithAscii } from './lib/bytes';
import { convertViaServer, extractArchiveEntryViaServer, listArchiveViaServer } from './lib/convert';
import { candidateExts, isHiddenEntry } from './lib/names';
import { isImageName } from './lib/mime';
import { metaFromFileName } from './lib/text';
import { openZip, type ZipArchive } from './lib/zip';

/** 不当成「书」的 txt：压缩包里常见的说明文件 */
const NOISE_TXT = /(^|\/)(read\s*me|readme|说明|使用说明|声明|必读|免责声明|版权|license|copying|changelog|更新说明|下载说明|广告|manifest)[^/]*\.(txt|text|log)$/i;
const ARCHIVE_FORMATS = new Set<string>(['zip', 'rar', '7z']);

type Getter = () => FormatParser[];

function bookParserOf(name: string, parsers: FormatParser[]): FormatParser | null {
  for (const ext of candidateExts(name)) {
    const hit = parsers.find((p) => !ARCHIVE_FORMATS.has(p.format) && p.extensions.includes(ext));
    if (hit) return hit;
  }
  return null;
}

interface Selection {
  /** 要打开的内部条目；没有时表示整包当漫画 */
  entry?: string;
}

/** 从条目列表里决定打开哪一个（用户已指定 extra.entry 时直接用） */
export function selectEntry(names: string[], opts: OpenOptions, parsers: FormatParser[]): Selection {
  const wanted = opts.extra?.entry;
  if (typeof wanted === 'string' && wanted) {
    const hit = names.find((n) => n === wanted) ?? names.find((n) => n.toLowerCase() === wanted.toLowerCase());
    if (!hit) throw new UnsupportedFormatError(fmtMsg('emptyArchive'));
    return { entry: hit };
  }
  const files = names.filter((n) => !isHiddenEntry(n));
  const books = files.filter((n) => bookParserOf(n, parsers) && !isImageName(n));
  const images = files.filter((n) => isImageName(n));
  const real = books.filter((n) => !NOISE_TXT.test(n));
  const candidates = real.length ? real : books;
  const onlyText = candidates.length > 0 && candidates.every((n) => bookParserOf(n, parsers)?.format === 'txt');
  // 一堆图片外加一两个 txt 说明：漫画包
  if (images.length >= 3 && (!candidates.length || onlyText)) return {};
  if (candidates.length === 1) return { entry: candidates[0] };
  if (candidates.length > 1) throw new ArchiveChoiceError([...candidates].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  if (images.length) return {};
  throw new UnsupportedFormatError(fmtMsg('emptyArchive'));
}

function innerName(outer: string, entry: string): string {
  return `${outer.split('?')[0]}?${entry}`;
}

function innerOpts(opts: OpenOptions, entry: string): OpenOptions {
  const { entry: _drop, ...extra } = (opts.extra ?? {}) as Record<string, unknown>;
  return { ...opts, fileName: innerName(opts.fileName, entry), extra };
}

function byFormat(parsers: FormatParser[], format: BookFormat): FormatParser {
  const p = parsers.find((x) => x.format === format);
  if (!p) throw new UnsupportedFormatError();
  return p;
}

/** 一个 zip 本身其实是 EPUB/DOCX/ODT（扩展名被改成 .zip）：直接按那种格式打开 */
function disguisedFormat(zip: ZipArchive): BookFormat | null {
  if (zip.has('META-INF/container.xml')) return 'epub';
  if (zip.has('word/document.xml')) return 'docx';
  if (zip.has('content.xml') && zip.has('mimetype')) return 'odt';
  return null;
}

function fileNameProbe(format: BookFormat, opts: OpenOptions): BookProbe {
  const m = metaFromFileName(opts.fileName);
  return { format, metadata: { title: m.title, authors: m.authors }, cover: null };
}

async function loadZip(file: Blob): Promise<ZipArchive> {
  try {
    return await openZip(file);
  } catch (e) {
    throw corrupt(e);
  }
}

async function innerFromZip(zip: ZipArchive, entry: string, parsers: FormatParser[]): Promise<{ blob: Blob; parser: FormatParser }> {
  const parser = bookParserOf(entry, parsers);
  if (!parser) throw new UnsupportedFormatError();
  return { blob: await zip.blob(entry, 'application/octet-stream'), parser };
}

export function makeZipParser(getParsers: Getter): FormatParser {
  return {
    format: 'zip',
    extensions: ['zip'],
    sniff: (head) => isZip(head),
    async open(file, opts): Promise<Book> {
      const parsers = getParsers();
      const zip = await loadZip(file);
      const disguise = disguisedFormat(zip);
      if (disguise) return byFormat(parsers, disguise).open(file, opts);
      const sel = selectEntry(zip.names, opts, parsers);
      if (!sel.entry) return byFormat(parsers, 'cbz').open(file, opts);
      const { blob, parser } = await innerFromZip(zip, sel.entry, parsers);
      return parser.open(blob, innerOpts(opts, sel.entry));
    },
    async probe(file, opts): Promise<BookProbe> {
      const parsers = getParsers();
      const zip = await loadZip(file);
      const disguise = disguisedFormat(zip);
      if (disguise) return byFormat(parsers, disguise).probe(file, opts);
      let sel: Selection;
      try {
        sel = selectEntry(zip.names, opts, parsers);
      } catch (e) {
        // 多本书：导入书架时只记个名字，打开时再让用户选
        if (e instanceof ArchiveChoiceError) return fileNameProbe('zip', opts);
        throw e;
      }
      if (!sel.entry) return byFormat(parsers, 'cbz').probe(file, opts);
      const { blob, parser } = await innerFromZip(zip, sel.entry, parsers);
      return parser.probe(blob, innerOpts(opts, sel.entry));
    },
  };
}

/** RAR / 7z：全部交给服务端。一本书 → 取出来打开；全是图片 → 转 CBZ 当漫画 */
function makeServerArchive(format: 'rar' | '7z', comicFormat: BookFormat, magic: (head: Uint8Array) => boolean, getParsers: Getter): FormatParser {
  const label = format.toUpperCase();
  const open = async (file: Blob, opts: OpenOptions, probe: boolean): Promise<Book | BookProbe> => {
    const parsers = getParsers();
    const entries = await listArchiveViaServer(file, opts.fileName, label, opts.signal);
    const sel = selectEntry(
      entries.filter((e) => !e.dir).map((e) => e.path),
      opts,
      parsers,
    );
    if (sel.entry) {
      const blob = await extractArchiveEntryViaServer(file, opts.fileName, sel.entry, label, opts.signal);
      const parser = bookParserOf(sel.entry, parsers);
      if (!parser) throw new UnsupportedFormatError();
      return probe ? parser.probe(blob, innerOpts(opts, sel.entry)) : parser.open(blob, innerOpts(opts, sel.entry));
    }
    const cbz = await convertViaServer(file, opts.fileName, 'cbz', { label, signal: opts.signal });
    const cbzParser = byFormat(parsers, 'cbz');
    if (probe) return { ...(await cbzParser.probe(cbz, opts)), format: comicFormat };
    return { ...(await cbzParser.open(cbz, opts)), format: comicFormat } as Book;
  };
  return {
    format,
    extensions: [format],
    needsServer: true,
    sniff: magic,
    open: (file, opts) => open(file, opts, false) as Promise<Book>,
    async probe(file, opts) {
      try {
        return (await open(file, opts, true)) as BookProbe;
      } catch (e) {
        // 服务端不可用/多本书：入库只记文件名，打开时再给出具体提示
        if (e instanceof ArchiveChoiceError || (e instanceof BookOpenError && e.code === 'server')) return fileNameProbe(format, opts);
        throw e;
      }
    },
  };
}

export const makeRarParser = (getParsers: Getter) => makeServerArchive('rar', 'cbr', (h) => startsWithAscii(h, 'Rar!'), getParsers);
export const make7zParser = (getParsers: Getter) => makeServerArchive('7z', 'cb7', (h) => h.length >= 6 && h[0] === 0x37 && h[1] === 0x7a && h[2] === 0xbc && h[3] === 0xaf && h[4] === 0x27 && h[5] === 0x1c, getParsers);

