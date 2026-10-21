// 标注导出（ANNO-010 / BAK-003）：TXT 分享文本、Markdown、JSON、.mrexpt（与原版 .an 同一文本格式，未压缩）。
import type { AnnotationRecord, BookRecord } from '@/core/library';
import { annotationToMoonNote, encodeAnText } from '@/storage/moon-formats';

export interface ChapterNames {
  /** section → 章节标题 */
  get(section: number): string | undefined;
}

const sortByPosition = (a: AnnotationRecord, b: AnnotationRecord) => a.range.section - b.range.section || a.range.start - b.range.start;

export function bookLabel(book: Pick<BookRecord, 'title' | 'authors'>): string {
  return book.authors.length ? `${book.title} - ${book.authors.join(' & ')}` : book.title;
}

/** 原 app 的分享文本：头 + 分隔线，每条 "▪ 原文 (笔记)"；可按章分组（章名取标注写入时的快照） */
export function toShareText(book: Pick<BookRecord, 'title' | 'authors'>, anns: AnnotationRecord[], withChapter = true): string {
  const hl = anns.filter((a) => a.kind === 'highlight' && !a.deletedAt);
  const notes = hl.filter((a) => a.note).length;
  const lines = [`${bookLabel(book)} (高亮: ${hl.length - notes}; 标注: ${notes})`, '───────────────'];
  const sorted = [...hl].sort(sortByPosition);
  let lastChapter: string | undefined;
  for (const a of sorted) {
    if (withChapter && a.chapterTitle && a.chapterTitle !== lastChapter) {
      lines.push('', `◆ ${a.chapterTitle}`);
      lastChapter = a.chapterTitle;
    }
    lines.push('', `${withChapter ? '  ' : ''}▪ ${a.text}${a.note ? ` (${a.note})` : ''}`);
  }
  return lines.join('\n');
}

export function toMarkdown(book: Pick<BookRecord, 'title' | 'authors'>, anns: AnnotationRecord[]): string {
  const live = [...anns].filter((a) => !a.deletedAt).sort(sortByPosition);
  const out = [`# ${book.title}`, ''];
  if (book.authors.length) out.push(`*${book.authors.join(' & ')}*`, '');
  const marks = live.filter((a) => a.kind === 'bookmark');
  const hls = live.filter((a) => a.kind === 'highlight');
  let chapter: string | undefined;
  for (const a of hls) {
    const c = a.chapterTitle ?? `#${a.range.section + 1}`;
    if (c !== chapter) {
      out.push(`## ${c}`, '');
      chapter = c;
    }
    out.push(`> ${a.text.replace(/\n+/g, '\n> ')}`, '');
    if (a.note) out.push(a.note, '');
  }
  if (marks.length) {
    out.push('## 书签', '');
    for (const m of marks) out.push(`- ${m.title || m.text || `#${m.range.section + 1}`}${m.chapterTitle ? `（${m.chapterTitle}）` : ''}`);
    out.push('');
  }
  return out.join('\n');
}

export function toJson(book: BookRecord, anns: AnnotationRecord[]): string {
  return JSON.stringify({ book: { id: book.id, title: book.title, authors: book.authors, fileName: book.fileName, size: book.size }, annotations: anns.filter((a) => !a.deletedAt) }, null, 2);
}

/** .mrexpt：原版标注导出文件（首行为书文件字节数；含墓碑，供对端删除） */
export function toMrexpt(book: BookRecord, anns: AnnotationRecord[]): string {
  return encodeAnText({ fileSize: book.size, notes: anns.map((a) => annotationToMoonNote(a, book)) });
}
