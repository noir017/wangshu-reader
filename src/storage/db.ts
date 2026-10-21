// IndexedDB 存储层。所有模块经这里读写书库数据；写操作会广播 change 事件，书架/阅读页据此刷新。
// 升级表结构：只能加版本号并在 upgrade 里按 oldVersion 递增处理，不能改已有版本的分支。
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { Emitter } from '@/core/emitter';
import type {
  AnnotationRecord,
  BookRecord,
  CoverKind,
  FontRecord,
  PositionRecord,
  ReadingStatRecord,
} from '@/core/library';

export const DB_NAME = 'moonreader';
export const DB_VERSION = 1;

interface MoonDB extends DBSchema {
  books: { key: string; value: BookRecord; indexes: { lowerFileName: string; addedAt: number; lastReadAt: number; tags: string } };
  files: { key: string; value: { bookId: string; blob: Blob } };
  covers: { key: [string, CoverKind]; value: { bookId: string; kind: CoverKind; blob: Blob } };
  positions: { key: string; value: PositionRecord };
  annotations: { key: string; value: AnnotationRecord; indexes: { bookId: string; updatedAt: number } };
  stats: { key: string; value: ReadingStatRecord };
  fonts: { key: string; value: FontRecord };
  /** 杂项键值：最近阅读历史、搜索历史、OPDS 书库、置顶项等。键名用 `模块.用途` */
  kv: { key: string; value: { key: string; value: unknown } };
}

export type StoreName = 'books' | 'files' | 'covers' | 'positions' | 'annotations' | 'stats' | 'fonts' | 'kv';

export interface DbEvents {
  [k: string]: unknown;
  change: { store: StoreName; key?: string; bookId?: string };
}

export const dbEvents = new Emitter<DbEvents>();

let dbPromise: Promise<IDBPDatabase<MoonDB>> | undefined;

export function getDb(): Promise<IDBPDatabase<MoonDB>> {
  dbPromise ??= openDB<MoonDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('lowerFileName', 'lowerFileName');
        books.createIndex('addedAt', 'addedAt');
        books.createIndex('lastReadAt', 'lastReadAt');
        books.createIndex('tags', 'tags', { multiEntry: true });
        db.createObjectStore('files', { keyPath: 'bookId' });
        db.createObjectStore('covers', { keyPath: ['bookId', 'kind'] });
        db.createObjectStore('positions', { keyPath: 'bookId' });
        const ann = db.createObjectStore('annotations', { keyPath: 'id' });
        ann.createIndex('bookId', 'bookId');
        ann.createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('stats', { keyPath: 'bookId' });
        db.createObjectStore('fonts', { keyPath: 'id' });
        db.createObjectStore('kv', { keyPath: 'key' });
      }
    },
    blocked() {
      console.warn('[db] 升级被其他标签页阻塞，请关闭其他打开本应用的标签页');
    },
  });
  return dbPromise;
}

/** 测试用：关闭并丢弃连接 */
export async function closeDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = undefined;
}

const changed = (store: StoreName, key?: string, bookId?: string) => dbEvents.emit('change', { store, key, bookId });

// ───────────── 设备 id（同步时区分来源） ─────────────
export function deviceId(): string {
  const k = 'mr.deviceId';
  let id = globalThis.localStorage?.getItem(k);
  if (!id) {
    id = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    globalThis.localStorage?.setItem(k, id);
  }
  return id;
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ───────────── books ─────────────
type StoredBook = BookRecord & { lowerFileName: string };

export async function listBooks(): Promise<BookRecord[]> {
  return (await getDb()).getAll('books');
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  return (await getDb()).get('books', id);
}

export async function findBooksByFileName(fileName: string): Promise<BookRecord[]> {
  return (await getDb()).getAllFromIndex('books', 'lowerFileName', fileName.toLowerCase());
}

export async function putBook(rec: BookRecord): Promise<void> {
  const stored: StoredBook = { ...rec, lowerFileName: rec.fileName.toLowerCase() };
  await (await getDb()).put('books', stored);
  changed('books', rec.id, rec.id);
}

export async function updateBook(id: string, patch: Partial<BookRecord>): Promise<BookRecord | undefined> {
  const db = await getDb();
  const tx = db.transaction('books', 'readwrite');
  const cur = await tx.store.get(id);
  if (!cur) {
    await tx.done;
    return undefined;
  }
  const next = { ...cur, ...patch, id } as StoredBook;
  next.lowerFileName = next.fileName.toLowerCase();
  await tx.store.put(next);
  await tx.done;
  changed('books', id, id);
  return next;
}

/** 删除书：书记录、文件、封面、进度、统计；标注默认一并删除（keepAnnotations 时保留，便于重新导入后恢复） */
export async function deleteBook(id: string, opts: { keepAnnotations?: boolean } = {}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['books', 'files', 'covers', 'positions', 'stats', 'annotations'], 'readwrite');
  await tx.objectStore('books').delete(id);
  await tx.objectStore('files').delete(id);
  for (const kind of ['thumb', 'cover', 'edit', 'net'] as CoverKind[]) await tx.objectStore('covers').delete([id, kind]);
  await tx.objectStore('positions').delete(id);
  await tx.objectStore('stats').delete(id);
  if (!opts.keepAnnotations) {
    const keys = await tx.objectStore('annotations').index('bookId').getAllKeys(id);
    for (const k of keys) await tx.objectStore('annotations').delete(k);
  }
  await tx.done;
  changed('books', id, id);
}

// ───────────── files / covers ─────────────
export async function getBookFile(bookId: string): Promise<Blob | undefined> {
  return (await (await getDb()).get('files', bookId))?.blob;
}

export async function putBookFile(bookId: string, blob: Blob): Promise<void> {
  await (await getDb()).put('files', { bookId, blob });
  changed('files', bookId, bookId);
}

export async function getCover(bookId: string, kind: CoverKind = 'thumb'): Promise<Blob | undefined> {
  return (await (await getDb()).get('covers', [bookId, kind]))?.blob;
}

export async function putCover(bookId: string, kind: CoverKind, blob: Blob): Promise<void> {
  await (await getDb()).put('covers', { bookId, kind, blob });
  changed('covers', `${bookId}:${kind}`, bookId);
}

export async function deleteCover(bookId: string, kind: CoverKind): Promise<void> {
  await (await getDb()).delete('covers', [bookId, kind]);
  changed('covers', `${bookId}:${kind}`, bookId);
}

// ───────────── positions ─────────────
export async function getPosition(bookId: string): Promise<PositionRecord | undefined> {
  return (await getDb()).get('positions', bookId);
}

/** 保存进度，同时更新书记录上的 progress / lastReadAt 缓存 */
export async function savePosition(rec: Omit<PositionRecord, 'updatedAt' | 'deviceId'> & Partial<PositionRecord>): Promise<void> {
  const full: PositionRecord = { updatedAt: Date.now(), deviceId: deviceId(), ...rec };
  const db = await getDb();
  const tx = db.transaction(['positions', 'books'], 'readwrite');
  await tx.objectStore('positions').put(full);
  const book = await tx.objectStore('books').get(rec.bookId);
  if (book) await tx.objectStore('books').put({ ...book, progress: full.progress, lastReadAt: full.updatedAt });
  await tx.done;
  changed('positions', rec.bookId, rec.bookId);
}

// ───────────── annotations ─────────────
export async function listAnnotations(bookId: string, opts: { includeDeleted?: boolean } = {}): Promise<AnnotationRecord[]> {
  const all = await (await getDb()).getAllFromIndex('annotations', 'bookId', bookId);
  return opts.includeDeleted ? all : all.filter((a) => !a.deletedAt);
}

export async function listAllAnnotations(opts: { includeDeleted?: boolean } = {}): Promise<AnnotationRecord[]> {
  const all = await (await getDb()).getAll('annotations');
  return opts.includeDeleted ? all : all.filter((a) => !a.deletedAt);
}

export async function putAnnotation(a: AnnotationRecord): Promise<void> {
  await (await getDb()).put('annotations', { ...a, updatedAt: a.updatedAt || Date.now() });
  changed('annotations', a.id, a.bookId);
}

/** 软删除（保留墓碑供同步传播）；purge=true 时物理删除 */
export async function deleteAnnotation(id: string, purge = false): Promise<void> {
  const db = await getDb();
  const cur = await db.get('annotations', id);
  if (!cur) return;
  if (purge) await db.delete('annotations', id);
  else await db.put('annotations', { ...cur, deletedAt: Date.now(), updatedAt: Date.now() });
  changed('annotations', id, cur.bookId);
}

// ───────────── stats ─────────────
export function dayNumber(at = Date.now()): number {
  const d = new Date(at);
  return Math.floor((at - d.getTimezoneOffset() * 60_000) / 86_400_000);
}

export async function getStats(bookId: string): Promise<ReadingStatRecord | undefined> {
  return (await getDb()).get('stats', bookId);
}

export async function listStats(): Promise<ReadingStatRecord[]> {
  return (await getDb()).getAll('stats');
}

/** 累加阅读时长与字数（STAT-001），按本地日期归档 */
export async function addReadingTime(bookId: string, ms: number, words: number, at = Date.now()): Promise<void> {
  if (ms <= 0 && words <= 0) return;
  const db = await getDb();
  const tx = db.transaction('stats', 'readwrite');
  const cur = (await tx.store.get(bookId)) ?? { bookId, usedMs: 0, words: 0, days: {} };
  const day = dayNumber(at);
  const d = cur.days[day] ?? { ms: 0, words: 0 };
  cur.days[day] = { ms: d.ms + ms, words: d.words + words };
  cur.usedMs += ms;
  cur.words += words;
  await tx.store.put(cur);
  await tx.done;
  changed('stats', bookId, bookId);
}

export async function clearStats(bookId?: string): Promise<void> {
  const db = await getDb();
  if (bookId) await db.delete('stats', bookId);
  else await db.clear('stats');
  changed('stats', bookId, bookId);
}

// ───────────── fonts ─────────────
export async function listFonts(): Promise<FontRecord[]> {
  return (await getDb()).getAll('fonts');
}

export async function putFont(f: FontRecord): Promise<void> {
  await (await getDb()).put('fonts', f);
  changed('fonts', f.id);
}

export async function deleteFont(id: string): Promise<void> {
  await (await getDb()).delete('fonts', id);
  changed('fonts', id);
}

// ───────────── kv ─────────────
export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await (await getDb()).get('kv', key))?.value as T | undefined;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('kv', { key, value });
  changed('kv', key);
}

export async function deleteKV(key: string): Promise<void> {
  await (await getDb()).delete('kv', key);
  changed('kv', key);
}

// ───────────── 最近阅读历史（原 history.txt，LIB-042） ─────────────
const HISTORY_KEY = 'library.history';
const HISTORY_MAX = 200;

export async function getHistory(): Promise<{ bookId: string; at: number }[]> {
  return (await getKV<{ bookId: string; at: number }[]>(HISTORY_KEY)) ?? [];
}

export async function touchHistory(bookId: string, at = Date.now()): Promise<void> {
  const list = (await getHistory()).filter((h) => h.bookId !== bookId);
  list.unshift({ bookId, at });
  await setKV(HISTORY_KEY, list.slice(0, HISTORY_MAX));
}

export async function removeFromHistory(bookId: string): Promise<void> {
  await setKV(HISTORY_KEY, (await getHistory()).filter((h) => h.bookId !== bookId));
}
