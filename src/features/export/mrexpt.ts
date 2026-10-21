// .mrexpt 标注文件编解码（spec 03 §4.4.3，原 BookDb.exportNotesToText / importNotesFromText）。
// 目标：尽量与原 app 互通。格式：
//   <原书字节数>\nindent:<bool>\ntrim:<bool>\n  然后每条记录 "#\n" + notes 表 16 列各占一行（换行写成 <BR>）。
// 偏移只在原 app 同样的排版管线下有意义，所以导入时以 original 文本重新定位（见 import.ts）。
import type { AnnotationRecord, HighlightStyle } from '@/core/library';
import { argbIntToCss, cssToArgbInt } from '../common/colors';

export interface MrexptRecord {
  id: number;
  book: string;
  filename: string;
  lowerFilename: string;
  chapter: number;
  split: number;
  position: number;
  /** 高亮：显示长度；书签：书签颜色（ARGB int，0 = 无色） */
  length: number;
  /** 高亮颜色（有符号 ARGB int） */
  color: number;
  /** 毫秒时间戳 */
  time: number;
  /** 非空 = 书签，内容是书签名 */
  bookmark: string;
  note: string;
  original: string;
  underline: boolean;
  strikethrough: boolean;
  squiggly: boolean;
  /** 墓碑（bak = *DELETED*） */
  deleted: boolean;
}

export interface MrexptFile {
  size: number;
  indent: boolean;
  trim: boolean;
  records: MrexptRecord[];
}

const FIELDS_PER_RECORD = 16;
const DELETED = '*DELETED*';

const esc = (s: string) => s.replace(/\r\n|\r|\n/g, '<BR>');
const unesc = (s: string) => s.replace(/<BR>/g, '\n');

export function encodeMrexpt(file: MrexptFile): string {
  const out: string[] = [String(file.size), `indent:${file.indent}`, `trim:${file.trim}`];
  for (const r of file.records) {
    out.push('#');
    if (r.deleted) {
      // 墓碑：与 deletedNotesToText 一致，只有位置、时间、书签名、笔记有意义
      out.push('0', '0', '0', '0', String(r.chapter), String(r.split), String(r.position), '0', '0', String(r.time), esc(r.bookmark), esc(r.note), '0', '0', '0', DELETED);
      continue;
    }
    out.push(
      String(r.id),
      esc(r.book),
      esc(r.filename),
      esc(r.lowerFilename),
      String(r.chapter),
      String(r.split),
      String(r.position),
      String(r.length),
      String(r.color),
      String(r.time),
      esc(r.bookmark),
      esc(r.note),
      esc(r.original),
      r.underline ? '1' : '0',
      r.strikethrough ? '1' : '0',
      r.squiggly ? '1' : '0',
    );
  }
  return out.join('\n') + '\n';
}

export class MrexptError extends Error {}

const int = (s: string | undefined, def = 0): number => {
  const n = Number((s ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : def;
};

export function parseMrexpt(text: string): MrexptFile {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines.length < 1 || !/^\s*\d+\s*$/.test(lines[0] ?? '')) throw new MrexptError('不是 .mrexpt 标注文件');
  const size = int(lines[0]);
  let indent = false;
  let trim = false;
  let i = 1;
  for (; i < lines.length && lines[i] !== '#'; i++) {
    const m = /^(indent|trim):(true|false)$/.exec(lines[i].trim());
    if (m) (m[1] === 'indent' ? (indent = m[2] === 'true') : (trim = m[2] === 'true'));
  }
  const records: MrexptRecord[] = [];
  // 与原实现一致：遇到 "#" 且后面至少还有 16 行才算一条记录
  while (i < lines.length) {
    if (lines[i] === '#' && lines.length - i - 1 >= FIELDS_PER_RECORD) {
      const f = lines.slice(i + 1, i + 1 + FIELDS_PER_RECORD);
      const deleted = f[15] === DELETED;
      records.push({
        id: int(f[0]),
        book: unesc(f[1]),
        filename: unesc(f[2]),
        lowerFilename: unesc(f[3]),
        chapter: int(f[4]),
        split: int(f[5]),
        position: int(f[6]),
        length: int(f[7]),
        color: int(f[8]),
        time: int(f[9]),
        bookmark: unesc(f[10]),
        note: unesc(f[11]),
        original: unesc(f[12]),
        underline: f[13].trim() === '1',
        strikethrough: f[14].trim() === '1',
        squiggly: f[15].trim() === '1',
        deleted,
      });
      i += 1 + FIELDS_PER_RECORD;
    } else {
      i++;
    }
  }
  return { size, indent, trim, records };
}

export interface ExportContext {
  title: string;
  fileName: string;
  size: number;
  /** 当前 highlightColor（书签行的 highlightColor 列填它，和原 app 一样） */
  defaultHighlightColor: string;
  indent?: boolean;
  trim?: boolean;
}

export function styleFlags(style: HighlightStyle): Pick<MrexptRecord, 'underline' | 'strikethrough' | 'squiggly'> {
  return { underline: style === 'underline', strikethrough: style === 'strikethrough', squiggly: style === 'squiggly' };
}

export function flagsToStyle(r: Pick<MrexptRecord, 'underline' | 'strikethrough' | 'squiggly'>): HighlightStyle {
  return r.underline ? 'underline' : r.strikethrough ? 'strikethrough' : r.squiggly ? 'squiggly' : 'highlight';
}

/** 标注 → .mrexpt 记录。chapter = 章节序号，position = 章内偏移（我们自己的导出，导入时可直接对上） */
export function annotationsToMrexpt(list: AnnotationRecord[], ctx: ExportContext, deleted: AnnotationRecord[] = []): MrexptFile {
  const records: MrexptRecord[] = [];
  let id = 1;
  for (const a of list) {
    const bm = a.kind === 'bookmark';
    records.push({
      id: id++,
      book: ctx.title,
      filename: ctx.fileName,
      lowerFilename: ctx.fileName.toLowerCase(),
      chapter: a.range.section,
      split: 0,
      position: a.range.start,
      length: bm ? cssToArgbInt(a.color) : a.range.end - a.range.start,
      color: bm ? cssToArgbInt(ctx.defaultHighlightColor) : cssToArgbInt(a.color),
      time: a.updatedAt,
      bookmark: bm ? (a.title ?? '') || '(书签)' : '',
      note: a.note ?? '',
      original: bm ? '' : a.text,
      ...(bm ? { underline: false, strikethrough: false, squiggly: false } : styleFlags(a.style)),
      deleted: false,
    });
  }
  for (const a of deleted) {
    records.push({
      id: id++, book: '', filename: '', lowerFilename: '', chapter: a.range.section, split: 0, position: a.range.start, length: 0, color: 0,
      time: a.deletedAt ?? a.updatedAt, bookmark: a.kind === 'bookmark' ? (a.title ?? '') : '', note: a.note ?? '', original: '',
      underline: false, strikethrough: false, squiggly: false, deleted: true,
    });
  }
  return { size: ctx.size, indent: ctx.indent ?? false, trim: ctx.trim ?? false, records };
}

/** 记录里的颜色 → CSS（书签取 length 列；0 = 无色 → ''） */
export function recordColor(r: MrexptRecord): string {
  if (r.bookmark) return r.length === 0 ? '' : argbIntToCss(r.length);
  return argbIntToCss(r.color);
}
