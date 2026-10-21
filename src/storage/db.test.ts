import { beforeEach, describe, expect, it } from 'vitest';
import {
  addReadingTime,
  closeDbForTests,
  DB_NAME,
  deleteAnnotation,
  deleteBook,
  findBooksByFileName,
  getBook,
  getHistory,
  getPosition,
  getStats,
  listAnnotations,
  putAnnotation,
  putBook,
  putBookFile,
  getBookFile,
  savePosition,
  touchHistory,
} from './db';
import { fileFingerprint } from './fingerprint';
import type { BookRecord } from '@/core/library';

const book = (id: string): BookRecord => ({
  id,
  fileName: `Book-${id}.EPUB`,
  format: 'epub',
  size: 10,
  title: `T${id}`,
  authors: [],
  tags: [],
  addedAt: 1,
  onShelf: true,
  hasCover: false,
});

beforeEach(async () => {
  await closeDbForTests();
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => r();
  });
});

describe('storage/db', () => {
  it('书、文件、进度、历史', async () => {
    await putBook(book('a'));
    await putBookFile('a', new Blob(['xyz']));
    expect((await findBooksByFileName('book-a.epub')).map((b) => b.id)).toEqual(['a']);
    expect(await (await getBookFile('a'))!.text()).toBe('xyz');
    await savePosition({ bookId: 'a', locator: { section: 2, offset: 5 }, progress: 0.4 });
    expect((await getPosition('a'))!.locator).toEqual({ section: 2, offset: 5 });
    expect((await getBook('a'))!.progress).toBe(0.4);
    await touchHistory('a', 1);
    await touchHistory('b', 2);
    await touchHistory('a', 3);
    expect((await getHistory()).map((h) => h.bookId)).toEqual(['a', 'b']);
  });

  it('标注软删除与删书级联', async () => {
    await putBook(book('a'));
    await putAnnotation({
      id: 'n1', bookId: 'a', kind: 'highlight', range: { section: 0, start: 1, end: 3 }, text: 'xx',
      color: '#ff0', style: 'highlight', createdAt: 1, updatedAt: 1,
    });
    await deleteAnnotation('n1');
    expect(await listAnnotations('a')).toEqual([]);
    expect((await listAnnotations('a', { includeDeleted: true }))[0].deletedAt).toBeGreaterThan(0);
    await deleteBook('a');
    expect(await getBook('a')).toBeUndefined();
    expect(await listAnnotations('a', { includeDeleted: true })).toEqual([]);
  });

  it('统计按天累加', async () => {
    await addReadingTime('a', 1000, 10, 86_400_000 * 100 + 3600_000);
    await addReadingTime('a', 500, 5, 86_400_000 * 100 + 7200_000);
    const s = (await getStats('a'))!;
    expect(s.usedMs).toBe(1500);
    expect(Object.values(s.days)).toEqual([{ ms: 1500, words: 15 }]);
  });

  it('指纹稳定且区分内容', async () => {
    const a = await fileFingerprint(new Blob(['hello world']));
    expect(a).toBe(await fileFingerprint(new Blob(['hello world'])));
    expect(a).not.toBe(await fileFingerprint(new Blob(['hello worle'])));
    expect(a).toMatch(/^[0-9a-f]{28}$/);
  });
});
