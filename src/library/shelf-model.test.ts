import { describe, expect, it } from 'vitest';
import type { BookRecord } from '@/core/library';
import {
  ALL_KEY,
  bookHasKey,
  booksInGroup,
  computeShelf,
  filterBooks,
  groupsOf,
  readStateOf,
  reorderManual,
  seriesText,
  sortBooks,
  suggestFor,
  type ShelfFilter,
  type ShelfView,
} from './shelf-model';

let n = 0;
const mk = (p: Partial<BookRecord>): BookRecord => ({
  id: `b${++n}`,
  fileName: `${p.title ?? 'x'}.epub`,
  format: 'epub',
  size: 1,
  title: 'x',
  authors: [],
  tags: [],
  addedAt: n,
  onShelf: true,
  hasCover: false,
  ...p,
});

const allFilter: ShelfFilter = { states: { unread: true, reading: true, finished: true }, allTypes: true, types: [] };
const view = (p: Partial<ShelfView> = {}): ShelfView => ({ category: 0, sub: '', subAuthor: '', sortBy: 0, filter: allFilter, ...p });

describe('阅读状态与过滤', () => {
  it('手动值优先，否则由进度推导', () => {
    expect(readStateOf({})).toBe(1);
    expect(readStateOf({ progress: 0 })).toBe(2);
    expect(readStateOf({ progress: 0.5 })).toBe(2);
    expect(readStateOf({ progress: 1 })).toBe(3);
    expect(readStateOf({ progress: 0.2, readState: 3 })).toBe(3);
    expect(readStateOf({ readState: 1, progress: 1 })).toBe(1);
  });
  it('状态与类型过滤', () => {
    const books = [mk({ title: 'a' }), mk({ title: 'b', progress: 0.3 }), mk({ title: 'c', progress: 1, format: 'pdf' }), mk({ title: 'd', format: 'txt' })];
    const f = (p: Partial<ShelfFilter>): string[] => filterBooks(books, { ...allFilter, ...p }).map((b) => b.title);
    expect(f({})).toEqual(['a', 'b', 'c', 'd']);
    expect(f({ states: { unread: true, reading: false, finished: false } })).toEqual(['a', 'd']);
    expect(f({ states: { unread: false, reading: false, finished: true } })).toEqual(['c']);
    expect(f({ allTypes: false, types: ['epub'] })).toEqual(['a', 'b']);
    expect(f({ allTypes: false, types: ['pdf', 'txt'] })).toEqual(['c', 'd']);
  });
});

describe('排序', () => {
  const books = [
    mk({ title: 'b10', authors: ['丙'], addedAt: 3 }),
    mk({ title: 'b2', authors: ['乙'], addedAt: 1 }),
    mk({ title: 'A', authors: ['甲'], addedAt: 2 }),
  ];
  it('书名：不区分大小写、数字按数值', () => {
    expect(sortBooks(books, 0, []).map((b) => b.title)).toEqual(['A', 'b2', 'b10']);
  });
  it('导入时间新的在前、最近阅读按历史、不在历史的排最后', () => {
    expect(sortBooks(books, 2, []).map((b) => b.title)).toEqual(['b10', 'A', 'b2']);
    const hist = [{ bookId: books[2].id, at: 9 }, { bookId: books[0].id, at: 8 }];
    expect(sortBooks(books, 4, hist).map((b) => b.title)).toEqual(['A', 'b10', 'b2']);
  });
  it('置顶在排序后提前，最新置顶在最前', () => {
    const p = [{ ...books[0], pinnedAt: 5 }, books[1], { ...books[2], pinnedAt: 9 }];
    expect(sortBooks(p, 0, []).map((b) => b.title)).toEqual(['A', 'b10', 'b2']);
  });
  it('手动序号只在书名排序下生效，且有序号的在前', () => {
    const m = [{ ...books[0], manualOrder: 1 }, { ...books[1], manualOrder: 0 }, books[2]];
    expect(sortBooks(m, 0, []).map((b) => b.title)).toEqual(['b2', 'b10', 'A']);
    expect(sortBooks(m, 2, []).map((b) => b.title)).toEqual(['b10', 'A', 'b2']);
    const r = reorderManual(sortBooks(books, 0, []), books[0].id, 0);
    expect(r.map((x) => x.id)).toEqual([books[0].id, books[2].id, books[1].id]);
    expect(r.map((x) => x.manualOrder)).toEqual([0, 1, 2]);
  });
});

describe('分类与下钻', () => {
  const books = [
    mk({ title: '三体1', authors: ['刘慈欣'], series: { name: '三体', index: 1 }, favorite: 'default_fav', tags: ['科幻', '#x'] }),
    mk({ title: '三体2', authors: ['刘慈欣'], series: { name: '三体', index: 2 }, favorite: '默认外', tags: ['科幻'] }),
    mk({ title: '球状闪电', authors: ['刘慈欣'], tags: ['科幻', '小说'] }),
    mk({ title: '活着', authors: ['余华'], favorite: 'default_fav' }),
    mk({ title: '隐藏', authors: ['某'], onShelf: false }),
  ];
  it('我的珍藏：默认分类排最前并显示「(默认分类)」；只有默认则平铺', () => {
    const g = groupsOf(books, 1)!;
    expect(g.map((x) => x.label)).toEqual(['(默认分类)', '默认外']);
    expect(groupsOf(books.filter((b) => b.favorite !== '默认外'), 1)).toBeNull();
  });
  it('标签忽略 # 开头；作者/系列分组计数', () => {
    expect(groupsOf(books, 4)!.map((g) => [g.label, g.count])).toEqual([['科幻', 3], ['小说', 1]]);
    expect(groupsOf(books, 3)!.find((g) => g.key === '刘慈欣')!.count).toBe(3);
    expect(groupsOf(books, 2)!.map((g) => g.key)).toEqual(['三体']);
    const sub = groupsOf(books, 2, '刘慈欣')!;
    expect(sub.map((g) => g.key)).toEqual(['三体', ALL_KEY]);
    expect(sub.at(-1)!.count).toBe(3);
  });
  it('computeShelf：分组列表 → 下钻 → 系列内按序号；不显示 onShelf=false', () => {
    const r0 = computeShelf(books, [], view({ category: 2 }));
    expect(r0.groups).toHaveLength(1);
    const r1 = computeShelf(books, [], view({ category: 2, sub: '三体' }));
    expect(r1.books.map((b) => b.title)).toEqual(['三体1', '三体2']);
    expect(computeShelf(books, [], view()).books).toHaveLength(4);
    expect(computeShelf(books, [], view({ category: 3, sub: '刘慈欣' })).books).toHaveLength(3);
    expect(booksInGroup(books, 4, '小说')).toHaveLength(1);
  });
  it('搜索：书名/作者/文件名；长度>1 才匹配简介', () => {
    const b = mk({ title: 'Hello', authors: ['Bob'], description: 'a tale of woe' });
    expect(bookHasKey(b, 'hel')).toBe(true);
    expect(bookHasKey(b, 'BOB')).toBe(true);
    expect(bookHasKey(b, 'tale')).toBe(true);
    expect(bookHasKey(b, 'w')).toBe(false);
    expect(bookHasKey(b, 'zzz')).toBe(false);
    expect(computeShelf(books, [], view({ query: '活' })).books.map((x) => x.title)).toEqual(['活着']);
    const s = suggestFor(books, '刘');
    expect(s.some((x) => x.kind === 'author' && x.text === '刘慈欣')).toBe(true);
  });
  it('系列文字', () => {
    expect(seriesText({ series: { name: 'S', index: 2 } })).toBe('S [2]');
    expect(seriesText({ series: { name: 'S', index: 1.5 } })).toBe('S [1.5]');
    expect(seriesText({})).toBe('');
  });
});
