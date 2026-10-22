import { beforeEach, describe, expect, it } from 'vitest';
import type { AnnotationRecord, BookRecord } from '@/core/library';
import { exportAllSettings } from '@/core/settings';
import { appSettings } from '@/core/app-settings';
import { readwiseSettings, shelfSettings } from '@/library/settings';
import { createBackup, parseBackup, restoreBackup, BackupFormatError } from './backup';
import {
  addReadingTime,
  closeDbForTests,
  DB_NAME,
  deviceId,
  getAllRaw,
  getBook,
  getBookFile,
  getCover,
  getHistory,
  getKV,
  getPosition,
  getStats,
  listAnnotations,
  putAnnotation,
  putBook,
  putBookFile,
  putCover,
  savePosition,
  setKV,
  touchHistory,
} from './db';

const book = (id: string, p: Partial<BookRecord> = {}): BookRecord => ({
  id,
  fileName: `${id}.epub`,
  format: 'epub',
  size: 5,
  title: `书${id}`,
  authors: ['作者'],
  tags: ['t'],
  addedAt: 1,
  onShelf: true,
  hasCover: true,
  ...p,
});
const ann = (id: string, bookId: string, updatedAt: number, text = 'x'): AnnotationRecord => ({
  id,
  bookId,
  kind: 'highlight',
  range: { section: 0, start: 1, end: 2 },
  text,
  color: '#ffeb3b',
  style: 'highlight',
  createdAt: 1,
  updatedAt,
});

async function wipe() {
  await closeDbForTests();
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => r();
  });
}

async function seed() {
  await putBook(book('a'));
  await putBook(book('b', { favorite: 'default_fav', onShelf: false }));
  await putBookFile('a', new Blob(['BOOK-A']));
  await putCover('a', 'thumb', new Blob(['COVER'], { type: 'image/png' }));
  await savePosition({ bookId: 'a', locator: { section: 3, offset: 40 }, progress: 0.4, updatedAt: 100 });
  await putAnnotation(ann('n1', 'a', 100, '你好'));
  await putAnnotation({ ...ann('n2', 'a', 200), deletedAt: 200 });
  await addReadingTime('a', 60_000, 300, 86_400_000 * 100, 5);
  await touchHistory('a', 10);
  await setKV('library.catalogs', [{ id: 'c1', title: 'X', password: 'secret-pw' }]);
  await setKV('secret.account.webdav', 'dav-pw');
  await setKV('sync.state.a', { lastKey: 'k' });
}

beforeEach(async () => {
  await wipe();
  localStorage.clear();
  readwiseSettings.reset();
  shelfSettings.reset();
  appSettings.reset();
});

describe('备份与恢复', () => {
  it('ZIP 往返：全部 store、封面、书文件原样回来', async () => {
    await seed();
    shelfSettings.set({ shelfStyle: 2, sortBy: 4 });
    const blob = await createBackup({ covers: true, books: true, format: 'zip' });
    await wipe();
    shelfSettings.reset();

    const parsed = await parseBackup(blob);
    expect(parsed.data.manifest.counts.books).toBe(2);
    const rep = await restoreBackup(parsed, 'replace');
    expect(rep).toMatchObject({ books: 2, positions: 1, annotations: 2, stats: 1, covers: 1, files: 1 });

    expect((await getBook('a'))?.title).toBe('书a');
    expect((await getBook('b'))?.onShelf).toBe(false);
    expect(await (await getBookFile('a'))!.text()).toBe('BOOK-A');
    expect(await (await getCover('a', 'thumb'))!.text()).toBe('COVER');
    expect((await getPosition('a'))!.locator).toEqual({ section: 3, offset: 40 });
    expect((await listAnnotations('a', { includeDeleted: true })).map((a) => a.id).sort()).toEqual(['n1', 'n2']);
    expect((await getStats('a'))!.pages).toBe(5);
    expect((await getHistory()).map((h) => h.bookId)).toEqual(['a']);
    // 设置跟着备份走
    expect(shelfSettings.get()).toMatchObject({ shelfStyle: 2, sortBy: 4 });
    // 书记录里的索引字段不进备份，恢复时由 putManyRaw 重建
    expect(((await getAllRaw('books')) as { lowerFileName?: string }[])[0].lowerFileName).toBeTruthy();
  });

  it('账号口令、令牌、同步状态默认不进备份', async () => {
    await seed();
    readwiseSettings.set({ token: 'rw-token', auto: true });
    shelfSettings.set({ lockEnabled: true, lockSalt: 's', lockHash: 'h' });
    appSettings.set({ serverUrl: 'http://x', serverToken: 'srv-token' });
    const blob = await createBackup({ covers: false, books: false, format: 'json' });
    const text = await blob.text();
    for (const secret of ['secret-pw', 'dav-pw', 'rw-token', 'srv-token', 'http://x']) expect(text).not.toContain(secret);
    const j = JSON.parse(text);
    expect(j.settings['library.readwise'].token).toBeUndefined();
    expect(j.settings['library.readwise'].auto).toBe(true);
    expect(j.settings['library.shelf'].lockHash).toBeUndefined();
    expect(j.kv.some((r: { key: string }) => r.key.startsWith('secret.') || r.key.startsWith('sync.state.'))).toBe(false);
    expect(j.kv.find((r: { key: string }) => r.key === 'library.catalogs').value[0].password).toBe('');
  });

  it('覆盖恢复保留本机的服务端地址与令牌，并重置设备 id', async () => {
    await seed();
    const blob = await createBackup({ covers: false, books: false, format: 'zip' });
    appSettings.set({ serverUrl: 'http://mine', serverToken: 'mine-token' });
    const before = deviceId();
    await restoreBackup(await parseBackup(blob), 'replace');
    expect(appSettings.get()).toMatchObject({ serverUrl: 'http://mine', serverToken: 'mine-token' });
    expect(deviceId()).not.toBe(before);
    expect(exportAllSettings()['library.shelf']).toBeTruthy();
  });

  it('合并恢复：保留本机已有，进度/标注取较新，统计逐日取较大，历史合并', async () => {
    await seed();
    const blob = await createBackup({ covers: true, books: true, format: 'zip' });
    // 本机之后又有变化：进度更新、标注 n1 更新、多读了一些
    await savePosition({ bookId: 'a', locator: { section: 9, offset: 1 }, progress: 0.9, updatedAt: 500 });
    await putAnnotation(ann('n1', 'a', 400, '本机新版'));
    await addReadingTime('a', 30_000, 100, 86_400_000 * 101, 2);
    await putBook(book('c'));
    await touchHistory('c', 20);

    const rep = await restoreBackup(await parseBackup(blob), 'merge');
    expect(rep.books).toBe(0); // a、b 本机已有
    expect((await getPosition('a'))!.locator.section).toBe(9);
    expect((await listAnnotations('a')).find((a) => a.id === 'n1')!.text).toBe('本机新版');
    const st = (await getStats('a'))!;
    expect(Object.keys(st.days).length).toBe(2);
    expect(st.usedMs).toBe(90_000);
    expect((await getHistory()).map((h) => h.bookId)).toEqual(['c', 'a']);
    expect(await getKV('library.catalogs')).toBeTruthy();
  });

  it('合并恢复：备份里更新的进度与新增的书会进来', async () => {
    await seed();
    const blob = await createBackup({ covers: true, books: true, format: 'zip' });
    await wipe();
    await putBook(book('a', { title: '本机书名' }));
    await savePosition({ bookId: 'a', locator: { section: 1, offset: 0 }, progress: 0.1, updatedAt: 50 });
    const rep = await restoreBackup(await parseBackup(blob), 'merge');
    expect(rep.books).toBe(1); // 只有 b 是新的
    expect((await getBook('a'))!.title).toBe('本机书名');
    expect((await getPosition('a'))!.locator.section).toBe(3);
  });

  it('JSON 备份不含二进制；坏文件给出明确错误', async () => {
    await seed();
    const blob = await createBackup({ covers: true, books: true, format: 'json' });
    const p = await parseBackup(blob);
    expect(p.coverBlobs.size + p.fileBlobs.size).toBe(0);
    await expect(parseBackup(new Blob(['not json']))).rejects.toBeInstanceOf(BackupFormatError);
    await expect(parseBackup(new Blob([JSON.stringify({ manifest: { app: 'other' } })]))).rejects.toBeInstanceOf(BackupFormatError);
    await expect(parseBackup(new Blob([new Uint8Array([0x50, 0x4b, 1, 2, 3])]))).rejects.toBeInstanceOf(BackupFormatError);
  });

  it('改名前（manifest.app = moonreader-web）导出的备份照样能恢复', async () => {
    await seed();
    const j = JSON.parse(await (await createBackup({ covers: false, books: false, format: 'json' })).text());
    expect(j.manifest.app).toBe('wangshu-reader');
    j.manifest.app = 'moonreader-web';
    const p = await parseBackup(new Blob([JSON.stringify(j)]));
    expect(p.data.books.length).toBeGreaterThan(0);
  });

  it('不带封面/书籍时 manifest 如实标注', async () => {
    await seed();
    const p = await parseBackup(await createBackup({ covers: false, books: false, format: 'zip' }));
    expect(p.data.manifest.includes).toEqual({ covers: false, books: false });
    expect(p.fileBlobs.size).toBe(0);
  });
});
