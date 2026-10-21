// 开发页挂钩：?mrdev=1 时 ReaderPage 改用假书与假引擎，并预置两本书（#/read/mock-reflow、#/read/mock-fixed）。
import type { BookRecord } from '@/core/library';
import { getBook, putBook, putBookFile } from '@/storage/db';
import type { ReaderDeps } from '../index';
import { createMockBook, createMockFixedBook } from './mock-book';
import { MockReader } from './mock-reader';

function record(id: string, format: string, title: string): BookRecord {
  return {
    id,
    fileName: `${title}.${format}`,
    format,
    size: 1234,
    title,
    authors: format === 'pdf' ? [] : ['Moon Dev'],
    tags: [],
    addedAt: Date.now(),
    onShelf: true,
    hasCover: false,
  };
}

async function seed(): Promise<void> {
  for (const [id, fmt, title] of [
    ['mock-reflow', 'epub', '界面开发样书'],
    ['mock-fixed', 'pdf', '假 PDF'],
  ] as const) {
    if (!(await getBook(id))) {
      await putBook(record(id, fmt, title));
      await putBookFile(id, new Blob(['mock']));
    }
  }
}

export const devDeps: ReaderDeps = {
  async loadBook(bookId) {
    await seed();
    const rec = (await getBook(bookId))!;
    return { record: rec, book: bookId === 'mock-fixed' ? createMockFixedBook(24) : createMockBook({ chapters: 8 }) };
  },
  createReader: (book) => new MockReader(book),
};
