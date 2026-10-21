// 书架上的操作（无界面）：打开、收藏、标签、阅读状态、置顶、移除/删除、重命名收藏夹、拖拽排序。界面确认框在 dialogs.tsx。
import { navigate } from '@/core/router';
import type { BookRecord } from '@/core/library';
import {
  clearHistory,
  clearPositions,
  clearStats,
  deleteBook,
  getBook,
  getDb,
  listBooks,
  removeManyFromHistory,
  touchHistory,
  updateBook,
} from '@/storage/db';
import { DEFAULT_FAV } from './settings';
import { reorderManual } from './shelf-model';

export async function touchOpened(bookId: string): Promise<void> {
  await touchHistory(bookId);
}

/** 加入/修改收藏夹；fav 为 '' 表示移出收藏夹。不在书架上的书（只打开过）会同时上架 */
export async function setFavorite(ids: string[], fav: string): Promise<void> {
  for (const id of ids) await updateBook(id, { favorite: fav, ...(fav ? { onShelf: true } : {}) });
}

/** 批量加标签：只增不删，新标签插在现有前面（LIB-015） */
export async function addTags(ids: string[], tags: string[]): Promise<void> {
  const add = tags.map((t) => t.trim()).filter(Boolean);
  if (!add.length) return;
  for (const id of ids) {
    const b = await getBook(id);
    if (!b) continue;
    await updateBook(id, { tags: [...new Set([...add, ...b.tags])] });
  }
}

/** state 为 undefined = 自动（删除手动值，LIB-016） */
export async function setReadState(ids: string[], state: 1 | 2 | 3 | undefined): Promise<void> {
  for (const id of ids) await updateBook(id, { readState: state });
}

export async function setPinned(ids: string[], pinned: boolean): Promise<void> {
  const base = Date.now();
  for (const [i, id] of ids.entries()) await updateBook(id, { pinnedAt: pinned ? base + (ids.length - i) : undefined });
}

/** 把一本书挪到列表中的目标位置（手动排序，仅在按书名排序时有意义）。拖到最前且已有置顶书 = 置顶（LIB-018） */
export async function moveBook(list: BookRecord[], bookId: string, targetIndex: number): Promise<void> {
  const hasPinned = list.some((b) => b.pinnedAt);
  const moved = list.find((b) => b.id === bookId);
  if (hasPinned && targetIndex === 0 && moved && !moved.pinnedAt) {
    await setPinned([bookId], true);
    return;
  }
  if (moved?.pinnedAt && targetIndex > 0) await updateBook(bookId, { pinnedAt: undefined });
  for (const r of reorderManual(list, bookId, targetIndex)) await updateBook(r.id, { manualOrder: r.manualOrder });
}

export async function clearManualOrder(): Promise<void> {
  for (const b of await listBooks()) if (b.manualOrder !== undefined) await updateBook(b.id, { manualOrder: undefined });
}

/** 从书架移除（保留文件、进度、标注；书仍可从最近阅读打开）。收藏夹视图下只清 favorite */
export async function removeFromShelf(ids: string[], opts: { onlyFavorite?: boolean } = {}): Promise<void> {
  for (const id of ids) {
    if (opts.onlyFavorite) await updateBook(id, { favorite: '' });
    else await updateBook(id, { onShelf: false, favorite: '', pinnedAt: undefined, manualOrder: undefined });
  }
}

/** 彻底删除：文件、封面；alsoProgress 时连进度、标注、统计一起删（LIB-026） */
export async function deleteBooksForever(ids: string[], alsoProgress: boolean): Promise<void> {
  for (const id of ids) await deleteBook(id, { keepAnnotations: !alsoProgress, keepProgress: !alsoProgress });
  await removeManyFromHistory(ids);
}

export async function removeFromRecent(ids: string[]): Promise<void> {
  await removeManyFromHistory(ids);
}

/** 重命名收藏夹：对该收藏夹所有书批量改（LIB-014） */
export async function renameFavorite(oldName: string, newName: string): Promise<number> {
  let n = 0;
  for (const b of await listBooks()) {
    if ((b.favorite ?? '') === oldName) {
      await updateBook(b.id, { favorite: newName || DEFAULT_FAV });
      n++;
    }
  }
  return n;
}

/** 清空书架（LIB-025）：书记录与封面全部删掉；不动标注/进度/统计/历史 */
export async function emptyShelf(): Promise<void> {
  const books = await listBooks();
  for (const b of books) await deleteBook(b.id, { keepAnnotations: true, keepProgress: true });
}

/** 清空全部阅读统计，可选同时清最近阅读与全部进度（STAT-005） */
export async function clearAllStatistics(alsoRecent: boolean): Promise<void> {
  await clearStats();
  if (alsoRecent) {
    await clearHistory();
    await clearPositions();
  }
}

/** 找出文件已不存在的书（备份恢复时没带书籍文件等情况，LIB-025） */
export async function findBooksMissingFile(): Promise<BookRecord[]> {
  const db = await getDb();
  const keys = new Set((await db.getAllKeys('files')) as string[]);
  return (await listBooks()).filter((b) => !keys.has(b.id));
}

/** 为一本书补上文件（重新选择文件）。指纹必须一致才视为同一本书 */
export async function relinkBookFile(bookId: string, file: Blob): Promise<void> {
  const db = await getDb();
  await db.put('files', { bookId, blob: file });
  await updateBook(bookId, {});
}

/** 随机挑一本（LIB-027） */
export function pickRandom<T>(list: T[]): T | undefined {
  return list.length ? list[Math.floor(Math.random() * list.length)] : undefined;
}

export function goRead(bookId: string): void {
  navigate('read', bookId);
}

