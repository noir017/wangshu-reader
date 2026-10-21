// 上一本/下一本（阅读页动作 2/3）：按书架当前的视图（分类、分组、排序、过滤）排出的顺序取相邻的书。
import type { BookRecord } from '@/core/library';
import { getHistory, listBooks } from '@/storage/db';
import { shelfSettings } from './settings';
import { computeShelf, sortBooks, type HistoryItem, type ShelfView } from './shelf-model';

/** 纯函数：给定书与历史、书架视图，算出 bookId 的相邻书。当前书不在视图里（被过滤掉、在别的分组）时退回「全部书籍」按同样排序 */
export function adjacentIn(all: BookRecord[], history: HistoryItem[], view: ShelfView, bookId: string, dir: 1 | -1): string | null {
  const shown = computeShelf(all, history, { ...view, query: '' });
  let list = shown.groups ? [] : shown.books;
  let i = list.findIndex((b) => b.id === bookId);
  if (i < 0) {
    list = sortBooks(
      all.filter((b) => b.onShelf !== false),
      view.sortBy,
      history,
    );
    i = list.findIndex((b) => b.id === bookId);
  }
  if (i < 0) return null;
  return list[i + dir]?.id ?? null;
}

export async function getAdjacentBook(bookId: string, dir: 1 | -1): Promise<string | null> {
  const [all, history] = await Promise.all([listBooks(), getHistory()]);
  const st = shelfSettings.get();
  const view: ShelfView = {
    category: st.category,
    sub: st.subCollection,
    subAuthor: st.subAuthor,
    sortBy: st.sortBy,
    filter: { states: { unread: st.filterUnread, reading: st.filterReading, finished: st.filterFinished }, allTypes: st.filterAll, types: st.filterTypes },
  };
  return adjacentIn(all, history, view, bookId, dir);
}
