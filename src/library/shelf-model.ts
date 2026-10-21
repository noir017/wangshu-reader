// 书架的纯数据逻辑：状态判定、类型过滤、排序、分组下钻、搜索（LIB-006/008/009/010/017/018）。无 DOM、无 IO，便于单测。
import type { BookRecord } from '@/core/library';
import { DEFAULT_FAV, type ShelfCategory, type SortBy } from './settings';

export type ReadState = 1 | 2 | 3; // 未读 / 在读 / 已读

/** 阅读状态：手动值优先；否则看进度（没有进度记录 = 未读；<100% 在读；100% 已读） */
export function readStateOf(b: Pick<BookRecord, 'readState' | 'progress'>): ReadState {
  if (b.readState) return b.readState;
  if (b.progress === undefined || b.progress === null) return 1;
  return b.progress >= 0.995 ? 3 : 2;
}

/** 文件类型过滤分组（LIB-009 类型映射） */
export const TYPE_GROUPS: Record<string, { label: string; formats: string[] }> = {
  epub: { label: 'EPUB', formats: ['epub', 'epub3'] },
  pdf: { label: 'PDF/DJVU', formats: ['pdf', 'djvu'] },
  mobi: { label: 'MOBI/AZW3/PRC', formats: ['mobi', 'azw', 'azw3', 'prc'] },
  fb2: { label: 'FB2', formats: ['fb2', 'fb2.zip'] },
  chm: { label: 'CHM/UMD', formats: ['chm', 'umd'] },
  docx: { label: 'DOCX/ODT/RTF', formats: ['docx', 'odt', 'rtf'] },
  txt: { label: 'TXT', formats: ['txt'] },
  html: { label: 'HTML/MD', formats: ['html', 'htm', 'md'] },
  cbz: { label: 'CBZ/CBR', formats: ['cbz', 'cbr', 'cb7'] },
};

export function typeGroupOf(format: string): string | undefined {
  const f = format.toLowerCase();
  return Object.keys(TYPE_GROUPS).find((k) => TYPE_GROUPS[k].formats.includes(f));
}

export interface ShelfFilter {
  states: { unread: boolean; reading: boolean; finished: boolean };
  allTypes: boolean;
  types: string[];
}

export function filterBooks(books: BookRecord[], f: ShelfFilter): BookRecord[] {
  const allStates = f.states.unread && f.states.reading && f.states.finished;
  if (allStates && f.allTypes) return books;
  return books.filter((b) => {
    if (!allStates) {
      const s = readStateOf(b);
      if (!((s === 1 && f.states.unread) || (s === 2 && f.states.reading) || (s === 3 && f.states.finished))) return false;
    }
    if (!f.allTypes) {
      const g = typeGroupOf(b.format);
      if (!g || !f.types.includes(g)) return false;
    }
    return true;
  });
}

// ───────────── 目录（存储目录视图用的「来源」） ─────────────
export function dirOf(b: BookRecord): string {
  const src = b.source;
  if (src?.kind === 'server-library') {
    const p = (src.url ?? '').split('?')[0];
    const i = p.lastIndexOf('/');
    return i > 0 ? p.slice(0, i) : '/';
  }
  if (src?.kind === 'opds') return `网络书库/${src.catalog ?? ''}`.replace(/\/$/, '');
  if (src?.kind === 'url') return '链接下载';
  if (src?.url) {
    const i = src.url.lastIndexOf('/');
    if (i > 0) return src.url.slice(0, i);
  }
  return '本机导入';
}

// ───────────── 排序 ─────────────
const collator = new Intl.Collator(['zh-Hans-CN', 'en'], { sensitivity: 'base', numeric: true });
export const compareText = (a: string, b: string) => collator.compare(a, b);

export interface HistoryItem {
  bookId: string;
  at: number;
}

export function authorText(b: Pick<BookRecord, 'authors'>): string {
  return b.authors.join(' & ');
}

export function sortBooks(books: BookRecord[], sortBy: SortBy, history: HistoryItem[], opts: { seriesFirst?: boolean } = {}): BookRecord[] {
  const idx = new Map(history.map((h, i) => [h.bookId, i]));
  const byTitle = (a: BookRecord, b: BookRecord) => {
    // 手动排序（LIB-018）只在书名排序下生效：有序号的在前，按序号；其余按书名
    const ma = a.manualOrder;
    const mb = b.manualOrder;
    if (ma !== undefined && mb !== undefined) return ma - mb;
    if (ma !== undefined) return -1;
    if (mb !== undefined) return 1;
    return compareText(a.title, b.title);
  };
  const base = (a: BookRecord, b: BookRecord): number => {
    switch (sortBy) {
      case 1:
        return compareText(authorText(a), authorText(b)) || byTitle(a, b);
      case 2:
        return b.addedAt - a.addedAt;
      case 3:
        return compareText(dirOf(a), dirOf(b)) || compareText(a.fileName, b.fileName);
      case 4: {
        // 不在历史里的排最后并保持书名序
        const ia = idx.get(a.id) ?? Infinity;
        const ib = idx.get(b.id) ?? Infinity;
        if (ia !== ib) return ia === Infinity ? 1 : ib === Infinity ? -1 : ia - ib;
        return compareText(a.title, b.title);
      }
      default:
        return byTitle(a, b);
    }
  };
  const cmp = opts.seriesFirst ? (a: BookRecord, b: BookRecord) => (a.series?.index ?? 0) - (b.series?.index ?? 0) || base(a, b) : base;
  const sorted = [...books].sort(cmp);
  return pinFirst(sorted);
}

/** 置顶书提前（稳定；最新置顶在最前） */
export function pinFirst(books: BookRecord[]): BookRecord[] {
  const pinned = books.filter((b) => b.pinnedAt).sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  if (!pinned.length) return books;
  return [...pinned, ...books.filter((b) => !b.pinnedAt)];
}

// ───────────── 搜索 ─────────────
function nameNoExt(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i > 0 ? fileName.slice(0, i) : fileName;
}

/** 书名 / 作者 / 文件名子串匹配；关键字长度 >1 时再匹配简介（不区分大小写） */
export function bookHasKey(b: BookRecord, key: string): boolean {
  const k = key.trim().toLowerCase();
  if (!k) return true;
  if (b.title.toLowerCase().includes(k)) return true;
  if (b.authors.some((a) => a.toLowerCase().includes(k))) return true;
  if (nameNoExt(b.fileName).toLowerCase().includes(k)) return true;
  return k.length > 1 && !!b.description && b.description.toLowerCase().includes(k);
}

export interface Suggestion {
  kind: 'book' | 'author';
  text: string;
  sub?: string;
  bookId?: string;
}

export function suggestFor(books: BookRecord[], key: string, limit = 8): Suggestion[] {
  const k = key.trim().toLowerCase();
  if (!k) return [];
  const out: Suggestion[] = [];
  const authors = new Set<string>();
  for (const b of books) {
    if (out.filter((s) => s.kind === 'book').length < limit && bookHasKey(b, key)) {
      out.push({ kind: 'book', text: b.title, sub: authorText(b) || b.description?.slice(0, 40), bookId: b.id });
    }
    for (const a of b.authors) if (a.toLowerCase().includes(k)) authors.add(a);
  }
  for (const a of [...authors].slice(0, 4)) out.push({ kind: 'author', text: a });
  return out;
}

// ───────────── 分类与下钻 ─────────────
export interface Group {
  key: string;
  label: string;
  count: number;
}

export const ALL_KEY = '*all*';

export function isRealTag(t: string): boolean {
  return t.length > 0 && t.length <= 100 && !t.startsWith('#');
}

function countBy(keys: (string | string[])[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys.flat()) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function sortedGroups(m: Map<string, number>, label: (k: string) => string, first?: string): Group[] {
  return [...m.entries()]
    .map(([key, count]) => ({ key, label: label(key), count }))
    .sort((a, b) => (first && a.key === first ? -1 : first && b.key === first ? 1 : compareText(a.label, b.label)));
}

/**
 * 分类的一级分组列表。返回 null 表示该分类不分组、直接平铺书（全部书籍；只有默认收藏夹时的「我的珍藏」）。
 * 从「作者」下钻到「系列」时（subAuthor 非空），只列该作者的系列，外加「全部书籍」。
 */
export function groupsOf(books: BookRecord[], category: ShelfCategory, subAuthor = ''): Group[] | null {
  switch (category) {
    case 1: {
      const favs = countBy(books.map((b) => b.favorite ?? '').filter(Boolean));
      if (favs.size === 0 || (favs.size === 1 && favs.has(DEFAULT_FAV))) return null;
      return sortedGroups(favs, (k) => (k === DEFAULT_FAV ? '(默认分类)' : k), DEFAULT_FAV);
    }
    case 2: {
      const src = subAuthor ? books.filter((b) => b.authors.includes(subAuthor)) : books;
      const series = countBy(src.map((b) => b.series?.name ?? '').filter(Boolean));
      const groups = sortedGroups(series, (k) => k);
      if (subAuthor) groups.push({ key: ALL_KEY, label: '全部书籍', count: src.length });
      return groups;
    }
    case 3:
      return sortedGroups(countBy(books.map((b) => b.authors).filter((a) => a.length)), (k) => k);
    case 4:
      return sortedGroups(countBy(books.map((b) => b.tags.filter(isRealTag))), (k) => k);
    case 5:
      return sortedGroups(countBy(books.map(dirOf)), (k) => k);
    default:
      return null;
  }
}

export function booksInGroup(books: BookRecord[], category: ShelfCategory, key: string, subAuthor = ''): BookRecord[] {
  switch (category) {
    case 1:
      return books.filter((b) => (b.favorite ?? '') === key);
    case 2:
      if (key === ALL_KEY) return books.filter((b) => !subAuthor || b.authors.includes(subAuthor));
      return books.filter((b) => b.series?.name === key && (!subAuthor || b.authors.includes(subAuthor)));
    case 3:
      return books.filter((b) => b.authors.includes(key));
    case 4:
      return books.filter((b) => b.tags.includes(key));
    case 5:
      return books.filter((b) => dirOf(b) === key);
    default:
      return books;
  }
}

export interface ShelfView {
  category: ShelfCategory;
  sub: string;
  subAuthor: string;
  sortBy: SortBy;
  filter: ShelfFilter;
  query?: string;
}

export interface ShelfResult {
  /** 非 null = 显示分组列表 */
  groups: Group[] | null;
  /** groups 为 null 时的书列表 */
  books: BookRecord[];
  /** 当前视图可供「仅限当前列表」搜索的书 */
  title: string;
}

/** 计算书架当前该显示什么：先应用阅读状态/类型过滤，再分类下钻，再搜索、排序 */
export function computeShelf(all: BookRecord[], history: HistoryItem[], v: ShelfView): ShelfResult {
  const base = filterBooks(
    all.filter((b) => b.onShelf !== false),
    v.filter,
  );
  // 「我的珍藏」下，只显示收藏夹里的书
  const pool = v.category === 1 ? base.filter((b) => !!b.favorite) : base;
  const groups = groupsOf(pool, v.category, v.subAuthor);
  if (groups && !v.sub) {
    // 分组列表：搜索时只联想分组名，不过滤书
    const q = (v.query ?? '').trim().toLowerCase();
    return { groups: q ? groups.filter((g) => g.label.toLowerCase().includes(q)) : groups, books: [], title: '' };
  }
  let list = groups && v.sub ? booksInGroup(pool, v.category, v.sub, v.subAuthor) : pool;
  if (v.query?.trim()) list = list.filter((b) => bookHasKey(b, v.query!));
  const seriesFirst = v.category === 2 && !!v.sub && v.sub !== ALL_KEY;
  return { groups: null, books: sortBooks(list, v.sortBy, history, { seriesFirst }), title: v.sub };
}

export function groupLabel(category: ShelfCategory, key: string): string {
  if (category === 1 && key === DEFAULT_FAV) return '(默认分类)';
  if (key === ALL_KEY) return '全部书籍';
  return key;
}

/** 系列显示文字：「系列名 [序号]」，序号的 .0 去掉 */
export function seriesText(b: Pick<BookRecord, 'series'>): string {
  const s = b.series;
  if (!s?.name) return '';
  if (s.index === undefined || s.index === null) return s.name;
  return `${s.name} [${s.index}]`;
}

/** 手动拖拽排序：把 moved 挪到 targetIndex（在当前显示顺序 list 中的位置），为整张列表重新编号 */
export function reorderManual(list: BookRecord[], movedId: string, targetIndex: number): { id: string; manualOrder: number }[] {
  const from = list.findIndex((b) => b.id === movedId);
  if (from < 0) return [];
  const ids = list.map((b) => b.id);
  const [m] = ids.splice(from, 1);
  ids.splice(Math.max(0, Math.min(ids.length, targetIndex)), 0, m);
  return ids.map((id, i) => ({ id, manualOrder: i }));
}
