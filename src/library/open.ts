// 打开一本书：检查文件是否还在（失效书籍处理，LIB-025）、云同步预检（SYNC-006）、写最近阅读，然后跳到阅读页。
import { navigate } from '@/core/router';
import { toast } from '@/ui';
import { getBook, hasBookFile, touchHistory } from '@/storage/db';
import { askMissingBook } from './missing';
import { preOpenSync } from './sync-service';
import { t } from './i18n';

export async function openBook(bookId: string): Promise<void> {
  const book = await getBook(bookId);
  if (!book) {
    toast(t('noBookToContinue'));
    return;
  }
  if (!(await hasBookFile(bookId))) {
    await askMissingBook(book);
    return;
  }
  await touchHistory(bookId);
  await preOpenSync(bookId);
  navigate('read', bookId);
}
