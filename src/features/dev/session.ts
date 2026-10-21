// 开发/测试用的阅读会话：假书 + 假引擎 + 命令总线。
import { Emitter } from '@/core/emitter';
import type { BookRecord } from '@/core/library';
import type { ReaderController } from '@/core/reader';
import type { ReaderCommands, ReaderSession } from '@/core/reader-session';
import { makeDevBook, type DevBookOptions } from './mock-book';
import { MockController } from './mock-controller';

export function makeDevRecord(id: string, title: string): BookRecord {
  return {
    id,
    fileName: `${title}.epub`,
    format: 'epub',
    size: 123456,
    title,
    authors: ['Moon Dev'],
    tags: [],
    addedAt: Date.now(),
    onShelf: true,
    hasCover: false,
  };
}

export function makeDevSession(
  opts: DevBookOptions & { bookId?: string; createController?: (book: ReturnType<typeof makeDevBook>) => ReaderController } = {},
): { session: ReaderSession; controller: ReaderController; book: ReturnType<typeof makeDevBook> } {
  const book = makeDevBook(opts);
  const controller = opts.createController ? opts.createController(book) : new MockController(book);
  const bookId = opts.bookId ?? 'dev-book';
  const session: ReaderSession = { bookId, record: makeDevRecord(bookId, book.metadata.title), book, controller, bus: new Emitter<ReaderCommands>() };
  return { session, controller, book };
}
