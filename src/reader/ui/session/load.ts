// 取书与打开：书记录 + 文件 → openBook → Book；区分「找不到 / 需要服务端 / 需要密码」几类错误，界面据此给出清楚提示。
import type { Book } from '@/core/book';
import type { BookRecord } from '@/core/library';
import { checkServer } from '@/core/server';
import { getBook, getBookFile } from '@/storage/db';
import { textSettings } from '@/reader/settings';
import { detectFormat, openBook } from '@/formats';
import { clearSavedPassword, getSavedPassword } from './password';

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

/**
 * 认密码异常：formats 的 PasswordRequiredError（code='password'，reason 区分需要/错误，消息是中文）；
 * 直接冒上来的 pdf.js PasswordException（code 1 = 需要密码，2 = 密码错误）；其他解析器按英文消息识别
 */
export function asPasswordError(e: unknown): PasswordNeededError | null {
  const err = e as { name?: string; code?: number | string; message?: string; reason?: string } | null;
  if (!err) return null;
  if (err.code === 'password' || err.name === 'PasswordRequiredError') return new PasswordNeededError(err.reason === 'incorrect');
  if (err.name === 'PasswordException' || /need.*password|password.*(required|needed)/i.test(err.message ?? '') || /incorrect password|wrong password/i.test(err.message ?? '')) {
    return new PasswordNeededError(err.code === 2 || /incorrect|wrong/i.test(err.message ?? ''));
  }
  return null;
}

export interface LoadedBook {
  record: BookRecord;
  book: Book;
}

/** 压缩包里有多本书（formats 的 ArchiveChoiceError）：让用户挑一本，再带 entry 重开（FMT-020） */
export class ArchiveChoiceNeededError extends Error {
  constructor(public readonly entries: string[]) {
    super('archive has multiple books');
    this.name = 'ArchiveChoiceNeededError';
  }
}

export async function loadBook(bookId: string, opts: { password?: string; entry?: string; signal?: AbortSignal } = {}): Promise<LoadedBook> {
  const record = await getBook(bookId);
  const file = record ? await getBookFile(bookId) : undefined;
  if (!record || !file) throw new BookNotFoundError();

  const parser = detectFormat(record.fileName);
  if (parser?.needsServer && !(await checkServer())) throw new ServerNeededError(record.format || parser.format);

  const enc = textSettings.get().textEncode;
  // 没有现成的密码时先试保存过的那个；它失效了（文件换了密码）就清掉，转入手动输入
  const saved = opts.password === undefined ? await getSavedPassword(bookId) : undefined;
  const password = opts.password ?? saved;
  try {
    const book = await openBook(file, {
      fileName: record.fileName,
      encoding: enc && enc !== 'auto' ? enc : undefined,
      signal: opts.signal,
      extra: password !== undefined || opts.entry ? { ...(password !== undefined ? { password } : {}), ...(opts.entry ? { entry: opts.entry } : {}) } : undefined,
    });
    return { record, book };
  } catch (e) {
    const multi = e as { code?: string; entries?: unknown };
    if (multi?.code === 'multiple' && Array.isArray(multi.entries)) throw new ArchiveChoiceNeededError(multi.entries as string[]);
    const pw = asPasswordError(e);
    if (pw) {
      if (saved !== undefined) {
        await clearSavedPassword(bookId);
        throw new PasswordNeededError(false);
      }
      throw pw;
    }
    // 服务端不可用导致的转换失败也归为「需要服务端」
    if ((e as Error)?.name === 'ServerUnavailableError') throw new ServerNeededError(record.format);
    throw e;
  }
}
