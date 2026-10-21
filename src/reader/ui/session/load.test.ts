import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/core/book';
import type { BookRecord } from '@/core/library';
import { putBook, putBookFile } from '@/storage/db';

const openBook = vi.fn();
const detect = vi.fn();
const check = vi.fn();
vi.mock('@/formats', () => ({ openBook: (...a: unknown[]) => openBook(...a), detectFormat: (...a: unknown[]) => detect(...a) }));
vi.mock('@/core/server', () => ({ checkServer: () => check() }));

import { BookNotFoundError, PasswordNeededError, ServerNeededError, asPasswordError, loadBook } from './load';
import { clearSavedPassword, getSavedPassword, savePassword } from './password';

const rec = (id: string, fileName = 'a.pdf'): BookRecord => ({ id, fileName, format: 'pdf', size: 1, title: 't', authors: [], tags: [], addedAt: 1, onShelf: true, hasCover: false });

async function seed(id: string, fileName?: string) {
  await putBook(rec(id, fileName));
  await putBookFile(id, new Blob(['x']));
}

beforeEach(() => {
  openBook.mockReset();
  detect.mockReset().mockReturnValue({ needsServer: false, format: 'pdf' });
  check.mockReset().mockResolvedValue(true);
});

describe('asPasswordError：识别各种密码异常', () => {
  it('pdf.js PasswordException（code 1 需要 / 2 错误）', () => {
    expect(asPasswordError({ name: 'PasswordException', code: 1 })?.wrong).toBe(false);
    expect(asPasswordError({ name: 'PasswordException', code: 2 })?.wrong).toBe(true);
  });
  it('按消息文字识别', () => {
    expect(asPasswordError(new Error('Password required'))).toBeInstanceOf(PasswordNeededError);
    expect(asPasswordError(new Error('Incorrect password'))?.wrong).toBe(true);
    expect(asPasswordError(new Error('boom'))).toBeNull();
    expect(asPasswordError(null)).toBeNull();
  });
});

describe('loadBook：错误分类与保存的密码', () => {
  it('书或文件不存在', async () => {
    await expect(loadBook('nope')).rejects.toBeInstanceOf(BookNotFoundError);
  });

  it('需要服务端的格式在服务端不可用时给出专门的错误', async () => {
    await seed('srv', 'a.doc');
    detect.mockReturnValue({ needsServer: true, format: 'doc' });
    check.mockResolvedValue(false);
    await expect(loadBook('srv')).rejects.toBeInstanceOf(ServerNeededError);
    expect(openBook).not.toHaveBeenCalled();
  });

  it('解析抛 ServerUnavailableError 也归为需要服务端', async () => {
    await seed('srv2');
    openBook.mockRejectedValue(Object.assign(new Error('x'), { name: 'ServerUnavailableError' }));
    await expect(loadBook('srv2')).rejects.toBeInstanceOf(ServerNeededError);
  });

  it('需要密码 → PasswordNeededError；带密码重试成功', async () => {
    await seed('pw1');
    const book = { destroy: vi.fn() } as unknown as Book;
    openBook.mockRejectedValueOnce(Object.assign(new Error('need'), { name: 'PasswordException', code: 1 }));
    await expect(loadBook('pw1')).rejects.toMatchObject({ name: 'PasswordNeededError', wrong: false });
    openBook.mockResolvedValueOnce(book);
    const r = await loadBook('pw1', { password: 'secret' });
    expect(r.book).toBe(book);
    expect(openBook.mock.calls.at(-1)?.[1]).toMatchObject({ extra: { password: 'secret' } });
  });

  it('保存过的密码自动带上；失效后清掉并转为手动输入', async () => {
    await seed('pw2');
    await savePassword('pw2', '密码🔑');
    expect(await getSavedPassword('pw2')).toBe('密码🔑');
    const book = {} as Book;
    openBook.mockResolvedValueOnce(book);
    await loadBook('pw2');
    expect(openBook.mock.calls.at(-1)?.[1]).toMatchObject({ extra: { password: '密码🔑' } });

    openBook.mockRejectedValueOnce(Object.assign(new Error('bad'), { name: 'PasswordException', code: 2 }));
    await expect(loadBook('pw2')).rejects.toMatchObject({ name: 'PasswordNeededError', wrong: false });
    expect(await getSavedPassword('pw2')).toBeUndefined();
  });

  it('清除保存的密码', async () => {
    await savePassword('pw3', 'a');
    await clearSavedPassword('pw3');
    expect(await getSavedPassword('pw3')).toBeUndefined();
  });
});
