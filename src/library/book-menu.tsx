// 单书溢出菜单与批量操作的流程（LIB-011/012/026）：把「弹对话框 → 调 actions → 提示」串起来。
import type { BookRecord } from '@/core/library';
import { getBook, getBookFile } from '@/storage/db';
import { popupMenu, toast } from '@/ui';
import { askFavorite, askReadState, askRemoveBooks, askTags } from './dialogs';
import { addTags, deleteBooksForever, removeFromRecent, removeFromShelf, setFavorite, setPinned, setReadState } from './actions';
import { openBookInfo } from './BookInfo';
import { openCoverPicker } from './CoverPicker';
import { triggerDownload } from './format';
import { t } from './i18n';

export type MenuContext = 'shelf' | 'shelf-fav' | 'recent' | 'recent-fav';

/** 发送文件：支持文件分享的浏览器用 Web Share，否则直接下载原文件（LIB-037） */
export async function shareBookFile(book: BookRecord): Promise<void> {
  const blob = await getBookFile(book.id);
  if (!blob) {
    toast(t('missingBody', { name: book.title }));
    return;
  }
  const file = new File([blob], book.fileName, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: book.title });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  triggerDownload(file, book.fileName);
}

export async function addToFavoriteFlow(ids: string[]): Promise<void> {
  const first = ids.length === 1 ? await getBook(ids[0]) : undefined;
  const name = await askFavorite(first?.favorite ?? '');
  if (name === null) return;
  await setFavorite(ids, name);
}

export async function removeFlow(books: BookRecord[], ctx: MenuContext): Promise<boolean> {
  if (!books.length) return false;
  if (ctx === 'recent' || ctx === 'recent-fav') {
    // 最近阅读里「移除」= 从历史里去掉，可选同时删除文件
    if (ctx === 'recent-fav') {
      const c = await askRemoveBooks(books, { fromFavorite: true });
      if (!c) return false;
      await removeFromShelf(books.map((b) => b.id), { onlyFavorite: true });
      return true;
    }
    const c = await askRemoveBooks(books);
    if (!c) return false;
    await removeFromRecent(books.map((b) => b.id));
    if (c.deleteFile) await deleteBooksForever(books.map((b) => b.id), c.alsoProgress);
    return true;
  }
  const fromFav = ctx === 'shelf-fav';
  const c = await askRemoveBooks(books, { fromFavorite: fromFav });
  if (!c) return false;
  const ids = books.map((b) => b.id);
  if (fromFav) await removeFromShelf(ids, { onlyFavorite: true });
  else if (c.deleteFile) await deleteBooksForever(ids, c.alsoProgress);
  else await removeFromShelf(ids);
  toast(t('removed'));
  return true;
}

export function showBookMenu(book: BookRecord, x: number, y: number, ctx: MenuContext): void {
  const items = [
    { label: t('bookInfo'), onSelect: () => openBookInfo(book.id) },
    { label: t('addFavorite'), onSelect: () => void addToFavoriteFlow([book.id]) },
    { label: t('sendFile'), onSelect: () => void shareBookFile(book) },
    { label: t('downloadCover'), onSelect: () => openCoverPicker(book.id, { search: true }) },
  ];
  if (ctx === 'shelf' || ctx === 'shelf-fav') {
    items.push({ label: book.pinnedAt ? t('removeFromTop') : t('putOnTop'), onSelect: () => void setPinned([book.id], !book.pinnedAt) });
    items.push({ label: ctx === 'shelf-fav' ? t('removeFavorite') : t('removeFromShelf'), onSelect: () => void removeFlow([book], ctx) });
  } else {
    items.push({ label: ctx === 'recent-fav' ? t('removeFavorite') : t('removeFromRecent'), onSelect: () => void removeFlow([book], ctx) });
  }
  popupMenu(x, y, items);
}

/** 多选工具栏用：批量加标签 / 阅读状态 */
export async function tagsFlow(ids: string[]): Promise<void> {
  const tags = await askTags();
  if (tags) await addTags(ids, tags);
}

export async function readStateFlow(ids: string[]): Promise<void> {
  const r = await askReadState();
  if (r) await setReadState(ids, r.state);
}
