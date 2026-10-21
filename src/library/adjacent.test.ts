import { describe, expect, it } from 'vitest';
import type { BookRecord } from '@/core/library';
import { adjacentIn } from './adjacent';
import type { ShelfView } from './shelf-model';

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
const allFilter = { states: { unread: true, reading: true, finished: true }, allTypes: true, types: [] };
const view = (p: Partial<ShelfView> = {}): ShelfView => ({ category: 0, sub: '', subAuthor: '', sortBy: 0, filter: allFilter, ...p });

describe('上一本/下一本', () => {
  const a = mk({ id: 'a', title: 'a' });
  const b = mk({ id: 'b', title: 'b', favorite: 'x' });
  const c = mk({ id: 'c', title: 'c' });
  const tmp = mk({ id: 't', title: 'aa', onShelf: false });
  const all = [c, tmp, a, b];

  it('按书架当前排序取相邻，首尾返回 null', () => {
    expect(adjacentIn(all, [], view(), 'a', 1)).toBe('b');
    expect(adjacentIn(all, [], view(), 'b', -1)).toBe('a');
    expect(adjacentIn(all, [], view(), 'a', -1)).toBeNull();
    expect(adjacentIn(all, [], view(), 'c', 1)).toBeNull();
  });
  it('只在当前分组内翻（珍藏分组里只有 b）', () => {
    expect(adjacentIn(all, [], view({ category: 1, sub: 'x' }), 'b', 1)).toBeNull();
  });
  it('当前书不在视图里时退回全部书籍；不在书架上的书不参与', () => {
    expect(adjacentIn(all, [], view({ category: 1, sub: 'x' }), 'a', 1)).toBe('b');
    expect(adjacentIn(all, [], view(), 'a', -1)).toBeNull();
    expect(adjacentIn(all, [], view(), 'nope', 1)).toBeNull();
  });
  it('按最近阅读排序', () => {
    const hist = [{ bookId: 'c', at: 3 }, { bookId: 'a', at: 2 }];
    expect(adjacentIn(all, hist, view({ sortBy: 4 }), 'c', 1)).toBe('a');
    expect(adjacentIn(all, hist, view({ sortBy: 4 }), 'a', 1)).toBe('b');
  });
});
