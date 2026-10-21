// UMD（掌上书苑）文本类（FMT-013，spec §4.5，结构照 Umd.java）：魔数 → # 元数据/索引段 → $ 正文块（zlib，UTF-16LE）→ 章节偏移表切章。
import { unzlibSync } from 'fflate';
import type { Book, BookMetadata, BookProbe, BookSection, FormatParser, OpenOptions, ReflowableBook, TocEntry } from '@/core/book';
import { BookOpenError, UnsupportedFormatError, corrupt, fmtMsg } from './errors';
import { readBytes } from './lib/bytes';
import { countWords, metaFromFileName } from './lib/text';
import { countNewlines, languageOf, renderTextLines } from './txt';

const MAGIC = 0xde9a9b89;

export interface UmdInfo {
  title?: string;
  author?: string;
  year?: string;
  month?: string;
  day?: string;
  gender?: string;
  publisher?: string;
  vendor?: string;
  contentLength?: number;
  offsets: number[];
  titles: string[];
  cover?: Uint8Array;
  text: string;
}

class Reader {
  pos = 0;
  readonly dv: DataView;
  constructor(readonly b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  get eof() {
    return this.pos >= this.b.length;
  }
  need(n: number) {
    if (this.pos + n > this.b.length) throw new RangeError('EOF');
  }
  u8() {
    this.need(1);
    return this.b[this.pos++];
  }
  u16() {
    this.need(2);
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  skip(n: number) {
    this.need(Math.max(0, n));
    this.pos += n;
  }
  bytes(n: number) {
    this.need(n);
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  utf16(chars: number) {
    return new TextDecoder('utf-16le').decode(this.bytes(chars * 2));
  }
}

export function parseUmd(bytes: Uint8Array, skipText = false): UmdInfo {
  const r = new Reader(bytes);
  if (bytes.length < 8 || r.u32() !== MAGIC) throw new UnsupportedFormatError('不是 UMD 文件');
  const info: UmdInfo = { offsets: [], titles: [], text: '' };
  const parts: string[] = [];
  const segHeader = (skipBefore: number) => {
    // skipBefore 个字节 + id + '$' + 校验(=id) + 长度
    r.skip(skipBefore);
    const id = r.u32();
    r.skip(1);
    if (r.u32() !== id) throw new UnsupportedFormatError('UMD 段校验失败');
    return r.u32();
  };
  try {
    for (let running = true; running && !r.eof; ) {
      const b = r.u8();
      if (b === 0x23) {
        const tag = r.u16();
        if (tag >= 2 && tag <= 9) {
          r.skip(1);
          const len = r.u8();
          const s = r.utf16(Math.max(0, Math.floor((len - 5) / 2)));
          const key = (['title', 'author', 'year', 'month', 'day', 'gender', 'publisher', 'vendor'] as const)[tag - 2];
          info[key] = s;
          continue;
        }
        switch (tag) {
          case 0x01:
            r.skip(2);
            if (r.u8() !== 1) throw new BookOpenError('unsupported', fmtMsg('notTextUmd'));
            r.skip(2);
            break;
          case 0x0a:
            r.skip(2);
            r.u32();
            break;
          case 0x0b:
            r.skip(2);
            info.contentLength = Math.floor(r.u32() / 2);
            break;
          case 0x0c:
            r.skip(2);
            r.u32();
            running = false;
            break;
          case 0x81: {
            const l = segHeader(2);
            r.skip(Math.floor((l - 9) / 4) * 4);
            break;
          }
          case 0x82: {
            const l = segHeader(3);
            info.cover = r.bytes(Math.max(0, l - 9)).slice();
            break;
          }
          case 0x83: {
            const l = segHeader(2);
            const n = Math.floor((l - 9) / 4);
            info.offsets = Array.from({ length: n }, () => Math.floor(r.u32() / 2));
            break;
          }
          case 0x84: {
            segHeader(2);
            info.titles = [];
            for (let i = 0; i < info.offsets.length; i++) {
              const n = Math.floor(r.u8() / 2);
              info.titles.push(r.utf16(n));
            }
            break;
          }
          case 0x87: {
            const l = segHeader(4);
            r.skip(l - 9);
            break;
          }
          case 0xf1:
            r.skip(2);
            r.skip(16);
            break;
          default:
            running = false;
        }
      } else if (b === 0x24) {
        r.u32();
        const len = r.u32() - 9;
        const data = r.bytes(Math.max(0, len));
        if (!skipText) {
          try {
            const raw = new TextDecoder('utf-16le').decode(unzlibSync(data));
            let end = raw.length;
            while (end > 0 && raw.charCodeAt(end - 1) === 0) end--;
            parts.push(raw.slice(0, end));
          } catch {
            /* 坏块：跳过，章节偏移会对不上但不致命 */
          }
        }
      } else running = false;
    }
  } catch (e) {
    if (!(e instanceof RangeError)) throw e; // 文件被截断：用已解出的部分
  }
  info.text = parts.join('');
  return info;
}

function metaOf(info: UmdInfo, fileName: string): BookMetadata {
  const fm = metaFromFileName(fileName);
  const meta: BookMetadata = { title: info.title?.trim() || fm.title, authors: info.author?.trim() ? [info.author.trim()] : fm.authors };
  if (info.publisher?.trim()) meta.publisher = info.publisher.trim();
  if (info.gender?.trim()) meta.subjects = [info.gender.trim()];
  if (info.year?.trim()) meta.published = [info.year, info.month, info.day].filter((x) => x?.trim()).join('-');
  return meta;
}

export async function openUmd(file: Blob, opts: OpenOptions): Promise<ReflowableBook> {
  let info: UmdInfo;
  try {
    info = parseUmd(await readBytes(file));
  } catch (e) {
    if (e instanceof BookOpenError) throw e;
    throw corrupt(e);
  }
  const text = info.text.replace(/\u2029/g, '\n').replace(/\r\n?/g, '\n');
  const meta = metaOf(info, opts.fileName);
  const lang = languageOf(text);
  if (lang) meta.language = lang;

  // 章节区间（偏移超出总长的章节为空）
  const offs = info.offsets;
  const ranges: { title: string; s: number; e: number }[] = [];
  if (!offs.length) ranges.push({ title: meta.title, s: 0, e: text.length });
  else {
    // 原文用 U+2029 分段，替换成 \n 不改变长度（都是 1 个 UTF-16 单元），所以偏移可以直接用
    offs.forEach((s, i) => ranges.push({ title: info.titles[i] ?? String(i + 1), s: Math.min(s, text.length), e: i + 1 < offs.length ? Math.min(offs[i + 1], text.length) : text.length }));
  }

  const toc: TocEntry[] = [];
  const sections: BookSection[] = ranges.map((rg, i) => {
    const slice = text.slice(rg.s, Math.max(rg.s, rg.e));
    const first = slice.split('\n').find((l) => l.trim())?.trim() ?? '';
    // 章节正文里没带标题行时补一行标题（用 mr-title 类，引擎可按需隐藏）
    const hasTitle = first === rg.title.trim() || first.startsWith(rg.title.trim());
    const body = hasTitle || !rg.title.trim() ? slice : `${rg.title}\n${slice}`;
    if (offs.length) toc.push({ title: rg.title, level: 0, section: i });
    return {
      id: `c${i + 1}`,
      title: rg.title,
      linear: true,
      charCount: body.length - countNewlines(body, 0, body.length),
      load: async () => ({ bodyHtml: renderTextLines(body, false, true), bodyAttrs: { class: 'mr-txt' }, styles: [], ...(lang ? { lang } : {}) }),
    };
  });

  return {
    kind: 'reflowable',
    format: 'umd',
    metadata: meta,
    toc,
    sections,
    resolveHref: () => null,
    getCover: async () => (info.cover?.length ? new Blob([info.cover as BlobPart], { type: 'image/jpeg' }) : null),
    destroy() {
      /* 无外部资源 */
    },
  };
}

export async function probeUmd(file: Blob, opts: OpenOptions): Promise<BookProbe> {
  let info: UmdInfo;
  try {
    info = parseUmd(await readBytes(file), false);
  } catch (e) {
    if (e instanceof BookOpenError) throw e;
    throw corrupt(e);
  }
  return {
    format: 'umd',
    metadata: metaOf(info, opts.fileName),
    cover: info.cover?.length ? new Blob([info.cover as BlobPart], { type: 'image/jpeg' }) : null,
    size: { chars: info.contentLength ?? countWords(info.text) },
  };
}

export const umdParser: FormatParser = {
  format: 'umd',
  extensions: ['umd'],
  sniff: (head) => head.length >= 4 && new DataView(head.buffer, head.byteOffset, 4).getUint32(0, true) === MAGIC,
  open: (file, opts): Promise<Book> => openUmd(file, opts),
  probe: probeUmd,
};
