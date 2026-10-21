// 与原版 Moon+ Reader 互通的文本格式：位置串、.po、.an/.mrexpt、recent.list、统计日期（spec 01 §4.2、§4.4）。
// 全部是纯函数，便于单测；网络与存储在 sync.ts / backup.ts。
import { unzlibSync, zlibSync, strFromU8, strToU8 } from 'fflate';
import type { AnnotationRecord, HighlightStyle } from '@/core/library';

// ───────────── 位置串 ─────────────
export interface MoonPosition {
  chapter: number;
  split: number;
  position: number;
  /** 0..100，没有则 undefined */
  percent?: number;
}

/** 解析 `[章][@分段]#位置[:百分比]`（A:5677-5731）。无 `#` 时 `:` 前整体为位置（PDF/CBZ 的页号） */
export function parsePositionString(s: string): MoonPosition | null {
  const str = s.trim();
  if (!str) return null;
  let percent: number | undefined;
  let body = str;
  const colon = str.lastIndexOf(':');
  if (colon >= 0) {
    const p = parseFloat(str.slice(colon + 1));
    if (Number.isFinite(p)) percent = p;
    body = str.slice(0, colon);
  }
  const hash = body.indexOf('#');
  let chapter = 0;
  let split = 0;
  let position: number;
  if (hash >= 0) {
    const head = body.slice(0, hash);
    const at = head.indexOf('@');
    if (at >= 0) {
      chapter = toInt(head.slice(0, at));
      split = toInt(head.slice(at + 1));
    } else chapter = toInt(head);
    position = toInt(body.slice(hash + 1));
  } else {
    position = toInt(body);
  }
  return { chapter, split, position, percent };
}

function toInt(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

/** 生成位置串。fixed=true（PDF/漫画）写成 `页:百分比` */
export function formatPositionString(p: { chapter: number; split?: number; position: number; percent?: number }, fixed = false): string {
  const pct =
    p.percent === undefined ? '' : `:${p.percent >= 100 ? '100' : p.percent.toFixed(fixed ? 1 : 2)}%`;
  if (fixed) return `${p.chapter}${pct}`;
  return `${p.chapter}@${p.split ?? 0}#${p.position}${pct}`;
}

// ───────────── .po ─────────────
export interface PoFile {
  deviceId: string;
  position: string;
  webY?: number;
}

export function encodePo(po: PoFile): string {
  return `${po.deviceId}*${po.position}${po.webY !== undefined ? `|${po.webY}` : ''}`;
}

export function decodePo(text: string): PoFile | null {
  const t = text.replace(/^﻿/, '').trim();
  const star = t.indexOf('*');
  if (star <= 0) return null;
  let position = t.slice(star + 1);
  let webY: number | undefined;
  const bar = position.lastIndexOf('|');
  if (bar >= 0) {
    const y = parseInt(position.slice(bar + 1), 10);
    if (Number.isFinite(y)) webY = y;
    position = position.slice(0, bar);
  }
  if (!position) return null;
  return { deviceId: t.slice(0, star), position, webY };
}

// ───────────── recent.list ─────────────
export interface RecentItem {
  cloudPath: string;
  title: string;
  at: number;
  size: number;
  localPath: string;
  deviceId: string;
  position: string;
}

export function encodeRecent(r: RecentItem): string {
  return `${r.cloudPath}??1${r.title}??2${r.at}??3${r.size}??4${r.localPath}??5${r.deviceId}*${r.position}`;
}

export function decodeRecent(text: string): RecentItem | null {
  const t = text.replace(/^﻿/, '').trim();
  const i1 = t.indexOf('??1');
  const i2 = t.indexOf('??2');
  const i3 = t.indexOf('??3');
  const i4 = t.indexOf('??4');
  const i5 = t.indexOf('??5');
  if ([i1, i2, i3, i4, i5].some((i) => i < 0) || !(i1 < i2 && i2 < i3 && i3 < i4 && i4 < i5)) return null;
  const tail = t.slice(i5 + 3);
  const star = tail.indexOf('*');
  if (star <= 0) return null;
  return {
    cloudPath: t.slice(0, i1),
    title: t.slice(i1 + 3, i2),
    at: Number(t.slice(i2 + 3, i3)) || 0,
    size: Number(t.slice(i3 + 3, i4)) || 0,
    localPath: t.slice(i4 + 3, i5),
    deviceId: tail.slice(0, star),
    position: tail.slice(star + 1),
  };
}

// ───────────── .an / .mrexpt ─────────────
/** notes 表的一行（16 列，顺序同 DDL） */
export interface MoonNote {
  id: number;
  book: string;
  filename: string;
  lowerFilename: string;
  chapter: number;
  split: number;
  position: number;
  /** 高亮：字符数；书签：书签颜色 */
  length: number;
  /** 有符号 ARGB 整数 */
  color: number;
  time: number;
  bookmark: string;
  note: string;
  original: string;
  underline: number;
  strikethrough: number;
  /** '1' 波浪线；'*DELETED*' 墓碑 */
  bak: string;
}

export const DELETED = '*DELETED*';

const esc = (s: string) => s.replace(/\r?\n/g, '<BR>');
const unesc = (s: string) => s.replace(/<BR>/g, '\n');

export interface AnExport {
  /** 书文件字节数（对端据此判断是否同一本书） */
  fileSize: number;
  indent?: boolean;
  trim?: boolean;
  notes: MoonNote[];
}

export function encodeAnText(x: AnExport): string {
  const lines: string[] = [String(x.fileSize), `indent:${x.indent ?? false}`, `trim:${x.trim ?? false}`];
  for (const n of x.notes) {
    lines.push(
      '#',
      String(n.id),
      esc(n.book),
      esc(n.filename),
      esc(n.lowerFilename),
      String(n.chapter),
      String(n.split),
      String(n.position),
      String(n.length),
      String(n.color),
      String(n.time),
      esc(n.bookmark),
      esc(n.note),
      esc(n.original),
      String(n.underline),
      String(n.strikethrough),
      esc(n.bak),
    );
  }
  return lines.join('\n') + '\n';
}

export interface AnImport {
  fileSize: number;
  notes: MoonNote[];
}

export function decodeAnText(text: string): AnImport | null {
  const lines = text.replace(/^﻿/, '').replace(/\r/g, '').split('\n');
  const fileSize = parseInt(lines[0], 10);
  if (!Number.isFinite(fileSize)) return null;
  const notes: MoonNote[] = [];
  // 原实现：第 i 行为 '#' 且后面至少还有 15 行才算一条
  for (let i = 3; i < lines.length; i++) {
    if (lines[i] !== '#' || i + 16 > lines.length) continue;
    const f = lines.slice(i + 1, i + 17);
    notes.push({
      id: toInt(f[0]),
      book: unesc(f[1]),
      filename: unesc(f[2]),
      lowerFilename: unesc(f[3]),
      chapter: toInt(f[4]),
      split: toInt(f[5]),
      position: toInt(f[6]),
      length: toInt(f[7]),
      color: toInt(f[8]),
      time: Number(f[9]) || 0,
      bookmark: unesc(f[10]),
      note: unesc(f[11]),
      original: unesc(f[12]),
      underline: toInt(f[13]),
      strikethrough: toInt(f[14]),
      bak: unesc(f[15] ?? ''),
    });
    i += 16;
  }
  return { fileSize, notes };
}

/** .an = zlib(UTF-8 文本)，Java DeflaterOutputStream 默认的 RFC1950 */
export function compressAn(text: string): Uint8Array {
  return zlibSync(strToU8(text));
}

/** 自动识别 zlib（头字节 0x78）与未压缩的 .mrexpt 纯文本 */
export function decompressAn(data: Uint8Array): string {
  if (data.length > 2 && data[0] === 0x78) {
    try {
      return strFromU8(unzlibSync(data));
    } catch {
      /* 恰好以 x 开头的纯文本，当作未压缩处理 */
    }
  }
  return strFromU8(data);
}

// ───────────── 颜色 / 样式 / 标注互转 ─────────────
/** 有符号 ARGB 整数 → CSS 颜色（alpha=255 时 #rrggbb，否则 #rrggbbaa） */
export function argbToCss(n: number): string {
  const u = n >>> 0;
  const a = (u >>> 24) & 255;
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  const rgb = hex((u >>> 16) & 255) + hex((u >>> 8) & 255) + hex(u & 255);
  return a === 255 || a === 0 ? `#${rgb}` : `#${rgb}${hex(a)}`;
}

export function cssToArgb(css: string): number {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(css.trim());
  if (!m) return 0x77ffeb3b | 0;
  const a = m[2] ? parseInt(m[2], 16) : 255;
  return ((a << 24) | parseInt(m[1], 16)) | 0;
}

export function annotationToMoonNote(a: AnnotationRecord, book: { fileName: string }): MoonNote {
  const isBookmark = a.kind === 'bookmark';
  const color = cssToArgb(a.color);
  return {
    id: 0,
    book: book.fileName,
    filename: book.fileName,
    lowerFilename: book.fileName.toLowerCase(),
    chapter: a.range.section,
    split: 0,
    position: a.range.start,
    length: isBookmark ? color : Math.max(0, a.range.end - a.range.start),
    color: isBookmark ? cssToArgb('#77ffeb3b') : color,
    time: a.updatedAt || a.createdAt,
    bookmark: isBookmark ? a.title || a.text || ' ' : '',
    note: isBookmark ? '' : (a.note ?? ''),
    original: isBookmark ? '' : a.text,
    underline: a.style === 'underline' ? 1 : 0,
    strikethrough: a.style === 'strikethrough' ? 1 : 0,
    bak: a.deletedAt ? DELETED : a.style === 'squiggly' ? '1' : '0',
  };
}

export function moonNoteToAnnotation(n: MoonNote, bookId: string, id: string): AnnotationRecord {
  const isBookmark = n.bookmark !== '';
  const style: HighlightStyle = n.bak === '1' ? 'squiggly' : n.underline ? 'underline' : n.strikethrough ? 'strikethrough' : 'highlight';
  const len = isBookmark ? 0 : Math.max(0, n.length);
  return {
    id,
    bookId,
    kind: isBookmark ? 'bookmark' : 'highlight',
    range: { section: n.chapter, start: n.position, end: n.position + len },
    text: isBookmark ? n.bookmark : n.original,
    note: n.note || undefined,
    title: isBookmark ? n.bookmark : undefined,
    color: argbToCss(isBookmark ? n.length : n.color),
    style,
    createdAt: n.time,
    updatedAt: n.time,
    ...(n.bak === DELETED ? { deletedAt: n.time } : {}),
  };
}

/** 逻辑唯一键：章 + 分段 + 偏移（书签另加标记） */
export function noteKey(n: { chapter: number; split: number; position: number; bookmark: string }): string {
  return `${n.chapter}/${n.split}/${n.position}/${n.bookmark !== '' ? 'b' : 'h'}`;
}

export function annotationKey(a: AnnotationRecord): string {
  return `${a.range.section}/0/${a.range.start}/${a.kind === 'bookmark' ? 'b' : 'h'}`;
}

/** 两条标注内容是否不同（differentNote：书签名、笔记、颜色、样式、长度任一不同） */
export function differentNote(a: AnnotationRecord, n: MoonNote): boolean {
  const r = moonNoteToAnnotation(n, a.bookId, a.id);
  return (
    (a.title ?? '') !== (r.title ?? '') ||
    (a.note ?? '') !== (r.note ?? '') ||
    a.color.toLowerCase() !== r.color.toLowerCase() ||
    a.style !== r.style ||
    a.range.end - a.range.start !== r.range.end - r.range.start
  );
}

// ───────────── 统计日期 ─────────────
/** `statistics.dates`：每行 `{dayNumber}|{毫秒}@{字数}`（旧版仅 `{dayNumber}`） */
export function parseStatDates(text: string): Record<number, { ms: number; words: number }> {
  const out: Record<number, { ms: number; words: number }> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d+)(?:\|(\d+)@(\d+))?$/.exec(line.trim());
    if (!m) continue;
    out[Number(m[1])] = { ms: Number(m[2] ?? 0), words: Number(m[3] ?? 0) };
  }
  return out;
}

export function formatStatDates(days: Record<number, { ms: number; words: number }>): string {
  return Object.keys(days)
    .map(Number)
    .sort((a, b) => a - b)
    .map((d) => `${d}|${Math.round(days[d].ms)}@${Math.round(days[d].words)}`)
    .join('\n');
}

// ───────────── category（标签 + 系列） ─────────────
/** 原 `books.category` → 标签与系列（4.2）。标签忽略 `#` 开头、空与 >100 字的行 */
export function parseCategory(text: string): { tags: string[]; series?: { name: string; index?: number } } {
  const lines = text.replace(/\r/g, '').split('\n');
  const tags: string[] = [];
  let series: { name: string; index?: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('<') && l.length > 1) {
      const m = /^#(.*?)#$/.exec(lines[i + 1] ?? '');
      const idx = m ? parseFloat(m[1]) : NaN;
      series = { name: l.replace(/^<|>$/g, ''), ...(Number.isFinite(idx) ? { index: idx } : {}) };
      if (m) i++;
    } else if (l && !l.startsWith('#') && l.length <= 100) tags.push(l.trim());
  }
  return { tags, series };
}

export function formatCategory(tags: string[], series?: { name: string; index?: number }): string {
  const out: string[] = [];
  if (series?.name) out.push(`<${series.name}>`, `#${Math.max(0, series.index ?? 0)}#`);
  out.push(...tags);
  return out.join('\n') + (out.length ? '\n' : '');
}
