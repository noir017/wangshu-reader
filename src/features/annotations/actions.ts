// 标注的增删改（写 IndexedDB，dbEvents 会驱动列表与装饰刷新）。
import type { Locator, TextRange } from '@/core/book';
import type { AnnotationRecord, HighlightStyle } from '@/core/library';
import type { ReaderSession } from '@/core/reader-session';
import { deleteAnnotation, newId, putAnnotation } from '@/storage/db';
import { getSectionText } from '../common/section-text';
import { chapterTitleOf, progressOf } from '../toc/toc-utils';
import { currentAnnotations } from './store';
import { findSamePosition, quoteAround, relocate } from './model';

/** 书签保存的原文长度（用于偏移失效时重定位） */
const BOOKMARK_QUOTE = 24;

export interface HighlightInput {
  range: TextRange;
  style: HighlightStyle;
  color: string;
  note?: string;
  /** 选区原文；不给就从章节文本取 */
  text?: string;
}

/** 创建（或覆盖同位置的）高亮/笔记 */
export async function createHighlight(session: ReaderSession, input: HighlightInput): Promise<AnnotationRecord> {
  const { book, controller, bookId } = session;
  const { range } = input;
  const secText = await getSectionText(controller, range.section).catch(() => '');
  const text = input.text ?? secText.slice(range.start, range.end);
  const q = quoteAround(secText, range.start, range.end);
  const now = Date.now();
  const same = findSamePosition(currentAnnotations(), { kind: 'highlight', range });
  const rec: AnnotationRecord = {
    id: same?.id ?? newId(),
    bookId,
    kind: 'highlight',
    range,
    text,
    prefix: q.prefix,
    suffix: q.suffix,
    note: input.note ?? same?.note,
    color: input.color,
    style: input.style,
    chapterTitle: chapterTitleOf(book, range.section),
    progress: progressOf(book, range.section, range.start),
    createdAt: same?.createdAt ?? now,
    updatedAt: now,
  };
  await putAnnotation(rec);
  return rec;
}

export async function patchAnnotation(id: string, patch: Partial<AnnotationRecord>, list = currentAnnotations()): Promise<AnnotationRecord | undefined> {
  const cur = list.find((a) => a.id === id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, id: cur.id, bookId: cur.bookId, updatedAt: Date.now() };
  await putAnnotation(next);
  return next;
}

export async function removeAnnotation(id: string): Promise<void> {
  await deleteAnnotation(id);
}

export async function removeAnnotations(ids: string[]): Promise<void> {
  for (const id of ids) await deleteAnnotation(id);
}

/** 书签：位置 + 名称 + 颜色（'' = 无色） */
export async function createBookmark(session: ReaderSession, at: Locator, title: string, color: string): Promise<AnnotationRecord> {
  const { book, controller, bookId } = session;
  const secText = await getSectionText(controller, at.section).catch(() => '');
  const text = secText.slice(at.offset, at.offset + BOOKMARK_QUOTE);
  const q = quoteAround(secText, at.offset, at.offset + text.length);
  const now = Date.now();
  const rec: AnnotationRecord = {
    id: newId(),
    bookId,
    kind: 'bookmark',
    range: { section: at.section, start: at.offset, end: at.offset },
    text,
    prefix: q.prefix,
    suffix: q.suffix,
    title,
    color,
    style: 'highlight',
    chapterTitle: chapterTitleOf(book, at.section),
    progress: progressOf(book, at.section, at.offset),
    createdAt: now,
    updatedAt: now,
  };
  await putAnnotation(rec);
  return rec;
}

/**
 * 取标注在当前书里的有效区间（偏移失效时用 prefix+text+suffix 重定位）。
 * 书签返回 start=end；找不到（孤儿）时退回存储偏移，保证至少能跳到那一章。
 */
export async function resolveRange(session: ReaderSession, a: AnnotationRecord): Promise<{ range: TextRange; orphan: boolean }> {
  const secText = await getSectionText(session.controller, a.range.section).catch(() => undefined);
  if (secText === undefined) return { range: a.range, orphan: false };
  const isBm = a.kind === 'bookmark';
  const r = relocate(secText, { range: isBm ? { ...a.range, end: a.range.start + a.text.length } : a.range, text: a.text, prefix: a.prefix, suffix: a.suffix });
  if (!r) return { range: a.range, orphan: true };
  return { range: { section: a.range.section, start: r.start, end: isBm ? r.start : r.end }, orphan: false };
}

/** 跳转到标注：高亮/笔记带闪烁，书签按位置 */
export async function goToAnnotation(session: ReaderSession, a: AnnotationRecord): Promise<void> {
  const { range } = await resolveRange(session, a);
  if (a.kind === 'bookmark') await session.controller.goTo({ section: range.section, offset: range.start });
  else await session.controller.goTo({ range, flash: true });
}
