// 导入原版 Moon+ Reader 的整库备份（.mrpro / .mrstd）：书架、系列/标签/珍藏、进度、最近阅读、标注、统计。
// 解析在 storage/mrpro.ts。备份里带了书籍文件的书直接入库（和普通导入一样提取封面）；
// 没带文件的书建「待补文件」的记录（id 以 legacy- 开头），之后点开时选一次原文件即可接上进度与标注（见 legacy-relink.ts）。
import type { BookRecord, ReadingStatRecord } from '@/core/library';
import { detectFormat } from '@/formats';
import { getBook, getKV, newId, putAnnotation, putBook, putCover, putManyRaw, savePosition, setKV, updateBook } from '@/storage/db';
import { moonNoteToAnnotation, parsePositionString } from '@/storage/moon-formats';
import { legacyFileName, parseMrpro, pickLegacyCover, type MrproBook, type MrproData } from '@/storage/mrpro';
import { loadSqlJs } from '@/storage/sqljs-loader';
import { makeThumb } from './covers';
import { importFile } from './import';

export interface MrproReport {
  books: number;
  /** 备份里带了文件、已经能直接读的书 */
  withFiles: number;
  /** 没带文件、需要之后补文件的书 */
  pending: number;
  positions: number;
  annotations: number;
  stats: number;
  history: number;
}

/** 没带文件的书用路径做稳定 id：同一个备份导入两次不会重复 */
export function legacyId(lowerPath: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let i = 0; i < lowerPath.length; i++) {
    const c = lowerPath.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return `legacy-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export const isLegacyId = (id: string) => id.startsWith('legacy-');

/** 原版没有「分数」排序，手动排序靠书名前缀：把前缀字符串的字典序还原成 manualOrder */
function manualOrders(books: MrproBook[]): Map<string, number> {
  if (!books.some((b) => b.rawTitle.includes('#@#'))) return new Map();
  const sorted = [...books].sort((a, b) => a.rawTitle.toLowerCase().localeCompare(b.rawTitle.toLowerCase()));
  return new Map(sorted.map((b, i) => [b.lower, i]));
}

export async function importMrpro(file: Blob, opts: { onProgress?: (done: number, total: number, name: string) => void; signal?: AbortSignal } = {}): Promise<MrproReport> {
  const data = await parseMrpro(file, loadSqlJs);
  return applyMrpro(data, opts);
}

export async function applyMrpro(data: MrproData, opts: { onProgress?: (done: number, total: number, name: string) => void; signal?: AbortSignal } = {}): Promise<MrproReport> {
  const rep: MrproReport = { books: 0, withFiles: 0, pending: 0, positions: 0, annotations: 0, stats: 0, history: 0 };
  const ids = new Map<string, string>(); // 小写路径 → 书 id
  const order = manualOrders(data.books);
  const topIndex = new Map(data.top.map((p, i) => [p.toLowerCase(), i]));
  const now = Date.now();

  for (const [i, b] of data.books.entries()) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.(i, data.books.length, b.title);
    const fileName = legacyFileName(b.path);
    const patch: Partial<BookRecord> = {
      title: b.title,
      authors: b.authors,
      description: b.description || undefined,
      tags: b.tags,
      series: b.series,
      favorite: b.favorite && b.favorite !== '' ? b.favorite : '',
      addedAt: b.addedAt,
      onShelf: true,
      ...(topIndex.has(b.lower) ? { pinnedAt: now - (topIndex.get(b.lower) ?? 0) } : {}),
      ...(order.has(b.lower) ? { manualOrder: order.get(b.lower) } : {}),
      ...(data.readStates.has(b.lower) ? { readState: data.readStates.get(b.lower) } : {}),
    };
    let id: string | undefined;
    const bytesFn = data.bookFiles.get(b.path);
    if (bytesFn) {
      try {
        const f = new File([(await bytesFn()) as unknown as BlobPart], fileName);
        const r = await importFile({ file: f }, { onShelf: true });
        id = r.book.id;
        rep.withFiles++;
        // 手机上用户改过的书名/作者/简介以备份为准（解析器读到的是文件里的原始值）
        await updateBook(id, { ...patch, hasCover: r.book.hasCover });
      } catch {
        id = undefined; // 文件解析不了：退回待补文件
      }
    }
    if (!id) {
      id = legacyId(b.lower);
      const fmt = detectFormat(fileName)?.format ?? 'txt';
      const exists = await getBook(id);
      const rec: BookRecord = {
        ...(exists ?? { id, fileName, format: fmt, size: 0, addedAt: b.addedAt, hasCover: false, tags: [], authors: [], title: b.title, onShelf: true }),
        ...patch,
        id,
        fileName,
        format: exists?.format ?? fmt,
        source: { kind: 'local', url: b.path },
      } as BookRecord;
      await putBook(rec);
      rep.pending++;
      const cover = pickLegacyCover(data, fileName);
      if (cover) {
        try {
          const blob = new Blob([(await cover()) as unknown as BlobPart], { type: 'image/png' });
          await putCover(id, 'cover', blob);
          await putCover(id, 'thumb', await makeThumb(blob));
          await updateBook(id, { hasCover: true });
        } catch {
          /* 封面可有可无 */
        }
      }
    }
    ids.set(b.lower, id);
    rep.books++;
  }

  // 进度
  for (const [lower, id] of ids) {
    const pos = data.positions.get(lower);
    const m = pos ? parsePositionString(pos) : null;
    if (!m) continue;
    await savePosition({ bookId: id, locator: { section: m.chapter, offset: m.position }, progress: Math.min(1, Math.max(0, (m.percent ?? 0) / 100)), updatedAt: now, deviceId: 'moonreader-import' });
    rep.positions++;
  }
  // 标注
  for (const n of data.notes) {
    const id = ids.get(n.lowerFilename) ?? ids.get(n.path.toLowerCase());
    if (!id) continue;
    await putAnnotation(moonNoteToAnnotation(n, id, newId()));
    rep.annotations++;
  }
  // 统计
  const stats: ReadingStatRecord[] = [];
  for (const s of data.stats) {
    const id = ids.get(s.path.toLowerCase());
    if (!id || (s.usedMs <= 0 && s.words <= 0)) continue;
    stats.push({ bookId: id, usedMs: s.usedMs, words: s.words, days: s.days });
  }
  if (stats.length) await putManyRaw('stats', stats);
  rep.stats = stats.length;
  // 最近阅读：备份里最新在前；和本机已有历史合并（备份的排在已有的后面，不抢本机刚读的）
  const hist = data.history.map((p) => ids.get(p.toLowerCase())).filter((x): x is string => !!x);
  if (hist.length) {
    const cur = (await getKV<{ bookId: string; at: number }[]>('library.history')) ?? [];
    const have = new Set(cur.map((h) => h.bookId));
    const add = hist.filter((id, i) => !have.has(id) && hist.indexOf(id) === i).map((bookId, i) => ({ bookId, at: now - 1000 - i }));
    await setKV('library.history', [...cur, ...add]);
    rep.history = add.length;
  }
  opts.onProgress?.(data.books.length, data.books.length, '');
  return rep;
}
