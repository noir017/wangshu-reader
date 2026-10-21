// 取书与打开：书记录 + 文件 → openBook → Book；区分「找不到 / 需要服务端 / 需要密码」几类错误，界面据此给出清楚提示。
import type { Book } from '@/core/book';
import type { BookRecord } from '@/core/library';
import { checkServer } from '@/core/server';
import { getBook, getBookFile } from '@/storage/db';
import { textSettings } from '@/reader/settings';
import { detectFormat, openBook } from '@/formats';

export class BookNotFoundError extends Error {
  constructor() {
    super('book not found');
    this.name = 'BookNotFoundError';
  }
}

export class ServerNeededError extends Error {
  constructor(public readonly format: string) {
    super(`format ${format} needs the server`);
    this.name = 'ServerNeededError';
  }
}

export class PasswordNeededError extends Error {
  constructor(public readonly wrong: boolean) {
    super(wrong ? 'incorrect password' : 'password required');
    this.name = 'PasswordNeededError';
  }
}

/** pdf.js 的 PasswordException：code 1 = 需要密码，2 = 密码错误；其他解析器可抛 name 为 PasswordException 的错误 */
export function asPasswordError(e: unknown): PasswordNeededError | null {
  const err = e as { name?: string; code?: number; message?: string } | null;
  if (!err) return null;
  if (err.name === 'PasswordException' || /need.*password|password.*(required|needed)/i.test(err.message ?? '') || /incorrect password|wrong password/i.test(err.message ?? '')) {
    return new PasswordNeededError(err.code === 2 || /incorrect|wrong/i.test(err.message ?? ''));
  }
  return null;
}

export interface LoadedBook {
  record: BookRecord;
  book: Book;
}

export async function loadBook(bookId: string, opts: { password?: string; signal?: AbortSignal } = {}): Promise<LoadedBook> {
  const record = await getBook(bookId);
  const file = record ? await getBookFile(bookId) : undefined;
  if (!record || !file) throw new BookNotFoundError();

  const parser = detectFormat(record.fileName);
  if (parser?.needsServer && !(await checkServer())) throw new ServerNeededError(record.format || parser.format);

  const enc = textSettings.get().textEncode;
  try {
    const book = await openBook(file, {
      fileName: record.fileName,
      encoding: enc && enc !== 'auto' ? enc : undefined,
      signal: opts.signal,
      extra: opts.password !== undefined ? { password: opts.password } : undefined,
    });
    return { record, book };
  } catch (e) {
    const pw = asPasswordError(e);
    if (pw) throw pw;
    // 服务端不可用导致的转换失败也归为「需要服务端」
    if ((e as Error)?.name === 'ServerUnavailableError') throw new ServerNeededError(record.format);
    throw e;
  }
}
