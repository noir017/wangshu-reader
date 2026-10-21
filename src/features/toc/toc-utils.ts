import type { AnnotFilter } from '../annotations/model';
// 目录相关纯逻辑：标题清洗、扁平化、当前章判定、书内进度估算。
import type { Book, TocEntry } from '@/core/book';

/** 标题清洗（TOC-002）：折叠空白；条目多（>20）且标题>150 字符时截成 147+... */
export function cleanChapterTitle(title: string, entryCount = 0): string {
  const t = title.replace(/[\s　]+/g, ' ').trim();
  if (t.length > 150 && entryCount > 20) return t.slice(0, 147) + '...';
  return t;
}

export interface FlatToc {
  entry: TocEntry;
  /** 树中缩进层级（0 起） */
  depth: number;
  /** 在先序展开中的序号（= 文档顺序） */
  index: number;
  hasChildren: boolean;
  /** 路径键，用于记录展开/折叠状态 */
  key: string;
  parentKey?: string;
}

export function flattenToc(toc: TocEntry[]): FlatToc[] {
  const out: FlatToc[] = [];
  const walk = (list: TocEntry[], depth: number, parentKey?: string) => {
    list.forEach((entry, i) => {
      const key = parentKey ? `${parentKey}.${i}` : String(i);
      const hasChildren = !!entry.children?.length;
      out.push({ entry, depth, index: out.length, hasChildren, key, parentKey });
      if (hasChildren) walk(entry.children!, depth + 1, key);
    });
  };
  walk(toc, 0);
  return out;
}

/** 按折叠状态得到当前可见的行 */
export function visibleRows(flat: FlatToc[], collapsed: ReadonlySet<string>): FlatToc[] {
  const hidden = new Set<string>();
  const out: FlatToc[] = [];
  for (const row of flat) {
    if (row.parentKey && (hidden.has(row.parentKey) || collapsed.has(row.parentKey))) {
      hidden.add(row.key);
      continue;
    }
    out.push(row);
  }
  return out;
}

/** 目录为空时，用书里各章自己的标题兜底（TXT 分章等） */
export function fallbackToc(book: Book): TocEntry[] {
  if (book.kind !== 'reflowable') return [];
  return book.sections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.linear && !!s.title)
    .map(({ s, i }) => ({ title: s.title!, level: 1, section: i }));
}

export function effectiveToc(book: Book): TocEntry[] {
  return book.toc.length ? book.toc : fallbackToc(book);
}

/**
 * 当前所在目录条目（扁平序号）。anchorOffsets：同一章内带锚点的条目 → 锚点在章内的偏移（取不到的不给），
 * 用来区分同章多个条目；没有就取该章第一个条目。
 */
export function currentTocIndex(flat: FlatToc[], loc: { section: number; offset: number }, anchorOffsets?: Map<number, number>, titleHint?: string): number {
  let idx = -1;
  for (const row of flat) {
    if (row.entry.section <= loc.section) idx = row.index;
    else break;
  }
  if (idx < 0) return -1;
  const sec = flat[idx].entry.section;
  if (sec !== loc.section) {
    // 当前章没有直接对应的条目：取之前最近一章里最后那条
    return idx;
  }
  const same = flat.filter((r) => r.entry.section === sec);
  if (same.length === 1) return same[0].index;
  if (anchorOffsets && anchorOffsets.size) {
    let best = same[0].index;
    for (const r of same) {
      const off = anchorOffsets.get(r.index);
      if (r.entry.anchor === undefined) {
        if (best === same[0].index) best = r.index;
        continue;
      }
      if (off !== undefined && off <= loc.offset) best = r.index;
    }
    return best;
  }
  if (titleHint) {
    const hit = same.find((r) => r.entry.title.trim() === titleHint.trim());
    if (hit) return hit.index;
  }
  return same[0].index;
}

/** 条目在目录里的祖先键（展开到当前章用） */
export function ancestorKeys(flat: FlatToc[], index: number): string[] {
  const byKey = new Map(flat.map((r) => [r.key, r] as const));
  const out: string[] = [];
  for (let r: FlatToc | undefined = flat[index]; r?.parentKey; r = byKey.get(r.parentKey)) out.push(r.parentKey);
  return out;
}

/** (章节, 章内偏移) → 全书进度 0..1，按各章 charCount 加权；固定版式按页 */
export function progressOf(book: Book, section: number, offset: number): number {
  if (book.kind === 'fixed') return book.pageCount > 1 ? Math.max(0, Math.min(1, section / (book.pageCount - 1))) : 0;
  const total = book.sections.reduce((n, s) => n + Math.max(0, s.charCount), 0);
  if (total <= 0) return book.sections.length > 1 ? section / (book.sections.length - 1) : 0;
  let before = 0;
  for (let i = 0; i < Math.min(section, book.sections.length); i++) before += Math.max(0, book.sections[i].charCount);
  const cur = book.sections[section]?.charCount ?? 0;
  return Math.max(0, Math.min(1, (before + Math.min(Math.max(0, offset), cur)) / total));
}

/** 章节标题：目录里不晚于该章的最后一条；没有就用章节自带标题 */
export function chapterTitleOf(book: Book, section: number): string | undefined {
  const flat = flattenToc(effectiveToc(book));
  let title: string | undefined;
  for (const row of flat) {
    if (row.entry.section <= section) title = row.entry.title;
    else break;
  }
  if (title) return cleanChapterTitle(title);
  if (book.kind === 'reflowable') return book.sections[section]?.title;
  return undefined;
}

/** 批量算进度用：预先累加各章字数，之后每次 O(1) */
export function progressFn(book: Book): (section: number, offset: number) => number {
  if (book.kind === 'fixed') return (section) => (book.pageCount > 1 ? Math.max(0, Math.min(1, section / (book.pageCount - 1))) : 0);
  const prefix: number[] = [0];
  for (const s of book.sections) prefix.push(prefix[prefix.length - 1] + Math.max(0, s.charCount));
  const total = prefix[prefix.length - 1];
  const n = book.sections.length;
  return (section, offset) => {
    if (total <= 0) return n > 1 ? section / (n - 1) : 0;
    const sec = Math.max(0, Math.min(section, n));
    const cur = book.sections[sec]?.charCount ?? 0;
    return Math.max(0, Math.min(1, (prefix[sec] + Math.min(Math.max(0, offset), cur)) / total));
  };
}

/** toc.open 的 tab → 面板请求：笔记/高亮是书签页里的筛选（0 全部 1 书签 2 标注 3 高亮） */
export function tocRequestOf(tab: 'toc' | 'bookmarks' | 'notes' | 'highlights' | undefined): { tab: 'toc' | 'bookmarks'; filter?: AnnotFilter } {
  switch (tab) {
    case 'bookmarks':
      return { tab: 'bookmarks' };
    case 'notes':
      return { tab: 'bookmarks', filter: 2 };
    case 'highlights':
      return { tab: 'bookmarks', filter: 3 };
    default:
      return { tab: 'toc' };
  }
}
