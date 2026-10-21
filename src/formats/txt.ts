// TXT 解析器（FMT-002/003/004/005/018，MISC-003）
// 文本 → 统一换行 → 分章 → 章节再按 maxSectionChars 在行边界切段 → 每段一个 BookSection。
// HTML 结构（引擎要认的钩子）：每行一个 <p>；空行 <p class="mr-blank"><br></p>；行首空白（含全角空格）包进 <span class="mr-ind">
// （引擎做「首行缩进/去空行/去多余空格」时隐藏或收起它们，文本节点本身不动，偏移不变）；章节标题行 <p class="mr-title">；body 带 class="mr-txt"。
// 偏移基准：文本节点只含行内文字，不含换行符；段落边界由 <p> 表示。
import type { Book, BookFormat, BookMetadata, BookProbe, BookSection, FormatParser, OpenOptions, ReflowableBook, SectionContent, TocEntry } from '@/core/book';
import { textSettings } from '@/reader/settings';
import { hasAozoraRuby, lineTextLength, renderRubyLine } from './aozora';
import { decodeAuto, normalizeEncoding } from './encoding';
import { UnsupportedFormatError, fmtMsg, BookOpenError } from './errors';
import { readBytes } from './lib/bytes';
import { escapeHtml, countWords, metaFromFileName } from './lib/text';
import { detectChapters, profileText, type TxtChapter } from './txt-chapters';
import { txtSettings, type TxtChapterMode } from './settings';

export interface TxtBook extends ReflowableBook {
  format: 'txt';
  /** 实际使用的编码（TextDecoder 标签），界面「文字编码」显示用 */
  encoding: string;
  /** 编码是自动检测出来的（而非用户指定） */
  encodingDetected: boolean;
}

export interface TxtExtra {
  chapterMode?: TxtChapterMode;
  chapterRegex?: string;
  aozoraRuby?: boolean;
  maxSectionChars?: number;
}

export function normalizeNewlines(s: string): string {
  let t = s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  if (t.includes('\r')) t = t.replace(/\r\n?/g, '\n');
  return t;
}

/** 把区间 [s,e) 在行边界（找不到就在句末标点）切成不超过 max 的若干段，返回各段终点 */
export function splitRange(text: string, s: number, e: number, max: number): [number, number][] {
  const out: [number, number][] = [];
  let a = s;
  while (e - a > max * 1.25) {
    const limit = a + max;
    let cut = text.lastIndexOf('\n', limit - 1);
    if (cut >= a + max / 2) {
      cut += 1;
    } else {
      // 没有换行：在窗口内找最后一个句末标点；再不行硬切（避开代理对）
      let best = -1;
      for (let p = limit; p > a + max / 2; p--) {
        const c = text[p - 1];
        if ('。！？…”」』!?;；'.includes(c) || (c === '.' && text[p] === ' ')) {
          best = p;
          break;
        }
      }
      cut = best > 0 ? best : limit;
      const code = text.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut += 1;
    }
    out.push([a, cut]);
    a = cut;
  }
  out.push([a, e]);
  return out;
}

export function countNewlines(text: string, s: number, e: number): number {
  let n = 0;
  for (let i = text.indexOf('\n', s); i >= 0 && i < e; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** 一段文本（行以 \n 分隔）→ <p> 序列；UMD/RTF 等纯文本格式共用 */
export function renderTextLines(slice: string, ruby: boolean, titleFirst: boolean): string {
  const lines = slice.split('\n');
  if (slice.endsWith('\n')) lines.pop();
  const parts: string[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let i = 0;
    while (i < line.length && /\s/.test(line[i])) i++;
    const ind = i > 0 ? `<span class="mr-ind">${escapeHtml(line.slice(0, i))}</span>` : '';
    if (i === line.length) {
      parts.push(`<p class="mr-blank">${ind}<br></p>`);
      continue;
    }
    const body = ruby ? renderRubyLine(line.slice(i)) : escapeHtml(line.slice(i));
    parts.push(`<p${titleFirst && li === 0 ? ' class="mr-title"' : ''}>${ind}${body}</p>`);
  }
  return parts.join('');
}

export function languageOf(text: string): string | undefined {
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let cyr = 0;
  const sample = text.slice(0, 20000);
  for (const ch of sample) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x4e00 && cp <= 0x9fff) han++;
    else if (cp >= 0x3040 && cp <= 0x30ff) kana++;
    else if (cp >= 0xac00 && cp <= 0xd7af) hangul++;
    else if (cp >= 0x400 && cp <= 0x4ff) cyr++;
  }
  if (kana > han * 0.05 && kana > 10) return 'ja';
  if (hangul > 10 && hangul > han) return 'ko';
  if (han > 10 && han > cyr) return 'zh';
  if (cyr > 20) return 'ru';
  return undefined;
}

export interface TxtParseResult {
  text: string;
  encoding: string;
  detected: boolean;
}

export async function decodeTxtFile(file: Blob, opts: OpenOptions): Promise<TxtParseResult> {
  const bytes = await readBytes(file);
  const hint = opts.encoding ?? textSettings.get().textEncode;
  if (hint && hint.toLowerCase() !== 'auto' && !normalizeEncoding(hint)) {
    throw new BookOpenError('encoding', fmtMsg('badEncoding', { enc: hint }));
  }
  const r = decodeAuto(bytes, hint);
  return { text: normalizeNewlines(r.text), encoding: r.encoding, detected: r.detected };
}

export interface TextBookVariant {
  format: BookFormat;
  metadata?: Partial<BookMetadata>;
  getCover?: () => Promise<Blob | null>;
}

/** 文本 → 可重排书（open 的核心，单测直接调用）。text 必须已规整换行。RTF 等纯文本类格式通过 variant 复用 */
export function buildTxtBook(text: string, opts: OpenOptions, enc: { encoding: string; detected: boolean }, variant?: TextBookVariant): TxtBook {
  const extra = (opts.extra ?? {}) as TxtExtra;
  const cfg = txtSettings.get();
  const mode = extra.chapterMode ?? cfg.chapterMode;
  const regex = extra.chapterRegex ?? cfg.chapterRegex;
  const max = Math.max(2000, extra.maxSectionChars ?? cfg.maxSectionChars);
  const ruby = (extra.aozoraRuby ?? cfg.aozoraRuby) && hasAozoraRuby(text);

  const fileMeta = metaFromFileName(opts.fileName);
  const lang = languageOf(text);
  const prof = profileText(text);
  const chapters: TxtChapter[] = detectChapters(text, { mode, regex }, prof);

  interface Seg {
    id: string;
    title?: string;
    start: number;
    end: number;
    chapter: number;
    first: boolean;
  }
  const segs: Seg[] = [];
  const toc: TocEntry[] = [];
  const addRange = (idBase: string, title: string | undefined, s: number, e: number, chapter: number) => {
    const ranges = splitRange(text, s, e, max);
    ranges.forEach(([a, b], k) => {
      if (chapter >= 0 && k === 0) toc.push({ title: title ?? '', level: 0, section: segs.length });
      segs.push({ id: k === 0 ? idBase : `${idBase}p${k + 1}`, title, start: a, end: b, chapter, first: k === 0 });
    });
  };
  if (!chapters.length) {
    addRange('c1', undefined, 0, text.length, -1);
  } else {
    if (chapters[0].pos > 0 && text.slice(0, chapters[0].pos).trim()) addRange('c0', fileMeta.title || undefined, 0, chapters[0].pos, -1);
    chapters.forEach((c, i) => addRange(`c${i + 1}`, c.title, c.pos, i + 1 < chapters.length ? chapters[i + 1].pos : text.length, i));
  }
  if (!segs.length) segs.push({ id: 'c1', start: 0, end: 0, chapter: -1, first: true });

  const sections: BookSection[] = segs.map((g) => {
    let charCount = g.end - g.start - countNewlines(text, g.start, g.end);
    if (ruby) {
      charCount = 0;
      for (const line of text.slice(g.start, g.end).split('\n')) charCount += lineTextLength(line);
    }
    return {
      id: g.id,
      title: g.title,
      linear: true,
      charCount: Math.max(0, charCount),
      async load(): Promise<SectionContent> {
        const html = renderTextLines(text.slice(g.start, g.end), ruby, g.chapter >= 0 && g.first);
        const out: SectionContent = { bodyHtml: html, bodyAttrs: { class: 'mr-txt' }, styles: [] };
        if (lang) out.lang = lang;
        return out;
      },
    };
  });

  const book: TxtBook = {
    kind: 'reflowable',
    format: (variant?.format ?? 'txt') as 'txt',
    metadata: { title: fileMeta.title, authors: fileMeta.authors, ...(lang ? { language: lang } : {}), ...variant?.metadata },
    toc,
    sections,
    encoding: enc.encoding,
    encodingDetected: enc.detected,
    resolveHref: () => null,
    getCover: variant?.getCover ?? (async () => null),
    destroy() {
      /* 无外部资源 */
    },
  };
  return book;
}

async function probeTxt(file: Blob, opts: OpenOptions): Promise<BookProbe> {
  const meta = metaFromFileName(opts.fileName);
  let chars: number;
  if (file.size <= 8 * 1024 * 1024) {
    const { text } = await decodeTxtFile(file, opts);
    chars = countWords(text);
  } else {
    const head = file.slice(0, 256 * 1024);
    const { text } = await decodeTxtFile(head, opts);
    chars = Math.round((countWords(text) / Math.max(1, head.size)) * file.size);
  }
  return { format: 'txt', metadata: { title: meta.title, authors: meta.authors }, cover: null, size: { chars } };
}

export const txtParser: FormatParser = {
  format: 'txt',
  extensions: ['txt', 'text', 'log'],
  async open(file, opts): Promise<Book> {
    const r = await decodeTxtFile(file, opts);
    if (r.text.split('\u0000').length - 1 > r.text.length / 20) throw new UnsupportedFormatError();
    return buildTxtBook(r.text, opts, { encoding: r.encoding, detected: r.detected });
  },
  probe: probeTxt,
};
