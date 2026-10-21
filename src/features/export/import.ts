// 导入 .mrexpt（ANNO-010）。原 app 的偏移依赖它自己的排版管线，所以以 original 原文在本书里重新定位：
// 先看记录给的章号/偏移处是否对得上，再在该章里就近找，再按「全书累计偏移」换算（TXT 的 lastPosition 是全书偏移），最后全书搜。
import type { TextRange } from '@/core/book';
import type { AnnotationRecord } from '@/core/library';
import type { ReaderSession } from '@/core/reader-session';
import { getSectionText, sectionCount } from '../common/section-text';
import { findSamePosition, quoteAround } from '../annotations/model';
import { chapterTitleOf, progressOf } from '../toc/toc-utils';
import { flagsToStyle, recordColor, type MrexptFile, type MrexptRecord } from './mrexpt';
import { deleteAnnotation, newId, putAnnotation } from '@/storage/db';

/** 原 app 判定「同一本书」的字节差上限 */
export const SAME_BOOK_SIZE_TOLERANCE = 100_000;

export interface LocateContext {
  count: number;
  getText(section: number): Promise<string>;
  /** 各章字数，书签只有百分比时估算章节用 */
  charCounts?: number[];
}

/** 书签名 "(12.3%) 页首文字..." → 页首文字（用来在书里重新找位置） */
export function bookmarkKey(name: string): string {
  return name.replace(/^\(\s*\d+(?:\.\d+)?%\s*\)\s*/, '').replace(/\.\.\.$/, '').trim().slice(0, 24);
}

export function bookmarkPercent(name: string): number | undefined {
  const m = /^\(\s*(\d+(?:\.\d+)?)%\s*\)/.exec(name);
  return m ? Number(m[1]) / 100 : undefined;
}

function nearest(text: string, needle: string, hint: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    const d = Math.abs(i - hint);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
    if (i > hint + bestD) break;
  }
  return best;
}

/** 定位一条记录（高亮用 original，书签用书签名里的页首文字）；找不到返回 null */
export async function locateRecord(r: MrexptRecord, ctx: LocateContext): Promise<{ section: number; start: number; end: number } | null> {
  const isBm = !!r.bookmark;
  const needle = isBm ? bookmarkKey(r.bookmark) : r.original;
  const hintSection = r.chapter >= 0 && r.chapter < ctx.count ? r.chapter : -1;

  if (!needle) {
    // 没有可搜的文字：只能信章号（书签名为空/纯日期）
    if (hintSection >= 0) {
      const t = await ctx.getText(hintSection);
      return { section: hintSection, start: Math.min(r.position, t.length), end: Math.min(r.position, t.length) };
    }
    return null;
  }
  const result = (section: number, start: number) => ({ section, start, end: isBm ? start : start + needle.length });

  // 1) 记录给的章 + 偏移
  if (hintSection >= 0) {
    const t = await ctx.getText(hintSection);
    if (t.slice(r.position, r.position + needle.length) === needle) return result(hintSection, r.position);
    const i = nearest(t, needle, r.position);
    if (i !== -1) return result(hintSection, i);
  }
  // 2) 全书累计偏移（原 app 的 TXT：lastChapter=0，lastPosition=全书偏移）
  let cum = 0;
  for (let s = 0; s < ctx.count; s++) {
    const t = await ctx.getText(s);
    if (r.position < cum + t.length) {
      const local = r.position - cum;
      const i = nearest(t, needle, local);
      if (i !== -1 && Math.abs(i - local) <= 400) return result(s, i);
      break;
    }
    cum += t.length;
  }
  // 3) 全书搜索：从提示章向两侧扩
  const order: number[] = [];
  const center = hintSection >= 0 ? hintSection : 0;
  for (let d = 0; order.length < ctx.count; d++) {
    if (center + d < ctx.count) order.push(center + d);
    if (d > 0 && center - d >= 0) order.push(center - d);
    if (center + d >= ctx.count && center - d < 0) break;
  }
  for (const s of order) {
    const t = await ctx.getText(s);
    const i = t.indexOf(needle);
    if (i !== -1) return result(s, i);
  }
  // 4) 书签：退而用百分比估章节
  if (isBm && ctx.charCounts) {
    const p = bookmarkPercent(r.bookmark);
    if (p !== undefined) {
      const total = ctx.charCounts.reduce((a, b) => a + b, 0);
      let acc = 0;
      for (let s = 0; s < ctx.count; s++) {
        acc += ctx.charCounts[s] ?? 0;
        if (acc >= p * total) return { section: s, start: 0, end: 0 };
      }
    }
  }
  return null;
}

export interface ImportSummary {
  added: number;
  replaced: number;
  removed: number;
  skipped: number;
  failed: number;
}

export function sizeMatches(file: MrexptFile, bookSize: number): boolean {
  return Math.abs(bookSize - file.size) <= SAME_BOOK_SIZE_TOLERANCE;
}

function differs(a: AnnotationRecord, next: Pick<AnnotationRecord, 'note' | 'color' | 'style' | 'title'>): boolean {
  return (a.note ?? '') !== (next.note ?? '') || a.color !== next.color || a.style !== next.style || (a.title ?? '') !== (next.title ?? '');
}

/** 执行导入：对每条记录定位、与现有同位置标注比较，新增/覆盖/按墓碑删除 */
export async function importMrexpt(session: ReaderSession, file: MrexptFile, existing: AnnotationRecord[], onProgress?: (i: number, n: number) => void): Promise<ImportSummary> {
  const { controller, book, bookId } = session;
  const ctx: LocateContext = {
    count: sectionCount(controller),
    getText: (s) => getSectionText(controller, s).catch(() => ''),
    charCounts: book.kind === 'reflowable' ? book.sections.map((s) => s.charCount) : undefined,
  };
  const sum: ImportSummary = { added: 0, replaced: 0, removed: 0, skipped: 0, failed: 0 };
  let list = [...existing];
  for (let i = 0; i < file.records.length; i++) {
    onProgress?.(i, file.records.length);
    const r = file.records[i];
    const kind: AnnotationRecord['kind'] = r.bookmark ? 'bookmark' : 'highlight';
    const loc = r.deleted ? (r.chapter >= 0 && r.chapter < ctx.count ? { section: r.chapter, start: r.position, end: r.position } : null) : await locateRecord(r, ctx);
    if (!loc) {
      sum.failed++;
      continue;
    }
    const range: TextRange = { section: loc.section, start: loc.start, end: loc.end };
    const same = findSamePosition(list, { kind, range });
    if (r.deleted) {
      if (same) {
        await deleteAnnotation(same.id);
        list = list.filter((a) => a.id !== same.id);
        sum.removed++;
      } else sum.skipped++;
      continue;
    }
    const color = recordColor(r);
    const style = flagsToStyle(r);
    const next = { note: r.note || undefined, color, style, title: r.bookmark || undefined };
    if (same && !differs(same, next)) {
      sum.skipped++;
      continue;
    }
    const text = await ctx.getText(loc.section);
    const q = quoteAround(text, loc.start, loc.end);
    const now = Date.now();
    const rec: AnnotationRecord = {
      id: same?.id ?? newId(),
      bookId,
      kind,
      range,
      text: kind === 'bookmark' ? text.slice(loc.start, loc.start + 24) : r.original,
      prefix: q.prefix,
      suffix: q.suffix,
      note: next.note,
      title: next.title,
      color,
      style,
      chapterTitle: chapterTitleOf(book, loc.section),
      progress: progressOf(book, loc.section, loc.start),
      createdAt: same?.createdAt ?? (r.time || now),
      updatedAt: now,
    };
    await putAnnotation(rec);
    list = same ? list.map((a) => (a.id === rec.id ? rec : a)) : [...list, rec];
    if (same) sum.replaced++;
    else sum.added++;
  }
  return sum;
}

