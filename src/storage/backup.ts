// 备份与恢复（BAK-001/002）。Web 版是逻辑导出，不照搬原版「整个数据目录打 zip」：
//   ZIP（.mrweb）：manifest.json + 各 store 的 JSON，可选 covers/、files/、fonts/ 二进制；
//   JSON：只有数据（不含封面/书籍文件）。账号口令默认剔除。
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { exportAllSettings, importAllSettings } from '@/core/settings';
import type { AnnotationRecord, BookRecord, CoverKind, FontRecord, PositionRecord } from '@/core/library';
import {
  clearStore,
  dbEvents,
  deviceId,
  getAllRaw,
  getDb,
  putManyRaw,
  resetDeviceId,
  type StatRecord,
} from './db';
import { SECRET_PREFIX } from './accounts';
import { backupDir, clientFor, loadSyncConfig } from './sync';

export const BACKUP_VERSION = 1;
export const BACKUP_EXT = 'mrweb';

export interface BackupOptions {
  covers: boolean;
  /** 书籍文件与字体 */
  books: boolean;
  /** 连同服务端令牌、Readwise 令牌、书库口令一起导出（默认不带） */
  secrets?: boolean;
  format: 'zip' | 'json';
}

export interface BackupManifest {
  app: 'moonreader-web';
  version: number;
  createdAt: number;
  deviceId: string;
  userAgent: string;
  counts: Record<string, number>;
  includes: { covers: boolean; books: boolean };
}

export interface BackupData {
  manifest: BackupManifest;
  settings: Record<string, Record<string, unknown>>;
  books: BookRecord[];
  positions: PositionRecord[];
  annotations: AnnotationRecord[];
  stats: StatRecord[];
  kv: { key: string; value: unknown }[];
  fonts: Omit<FontRecord, 'blob'>[];
  covers: { bookId: string; kind: CoverKind; type: string }[];
}

// 设备相关设置：既不导出也不恢复（换设备后服务端地址不一样）
const DEVICE_KEYS: Record<string, string[]> = { app: ['serverUrl', 'serverToken'] };
const SECRET_SETTINGS: Record<string, string[]> = { 'library.readwise': ['token'], 'library.shelf': ['lockSalt', 'lockHash'] };
// 设备相关 kv：同步状态、下载队列等
const SKIP_KV = (key: string) => key.startsWith(SECRET_PREFIX) || key.startsWith('sync.state.') || key.startsWith('library.downloads');

function scrubSettings(all: Record<string, Record<string, unknown>>, secrets: boolean): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [ns, vals] of Object.entries(all)) {
    const v = { ...vals };
    for (const k of DEVICE_KEYS[ns] ?? []) delete v[k];
    if (!secrets) for (const k of SECRET_SETTINGS[ns] ?? []) delete v[k];
    out[ns] = v;
  }
  return out;
}

function scrubKv(key: string, value: unknown, secrets: boolean): unknown {
  if (secrets) return value;
  // 书库账号口令
  if (key === 'library.catalogs' && Array.isArray(value)) return value.map((c) => (c && typeof c === 'object' ? { ...c, password: '' } : c));
  return value;
}

export async function collectBackupData(opts: Pick<BackupOptions, 'secrets'> = {}): Promise<Omit<BackupData, 'covers' | 'fonts'> & { fonts: FontRecord[]; coverRows: { bookId: string; kind: CoverKind; blob: Blob }[] }> {
  const [books, positions, annotations, stats, kvRows, fonts, coverRows] = await Promise.all([
    getAllRaw('books'),
    getAllRaw('positions'),
    getAllRaw('annotations'),
    getAllRaw('stats'),
    getAllRaw('kv'),
    getAllRaw('fonts'),
    getAllRaw('covers'),
  ]);
  const kv = kvRows.filter((r) => !SKIP_KV(r.key)).map((r) => ({ key: r.key, value: scrubKv(r.key, r.value, !!opts.secrets) }));
  const cleanBooks = books.map((b) => {
    const { lowerFileName: _l, ...rest } = b as BookRecord & { lowerFileName?: string };
    return rest as BookRecord;
  });
  return {
    manifest: undefined as unknown as BackupManifest,
    settings: scrubSettings(exportAllSettings() as Record<string, Record<string, unknown>>, !!opts.secrets),
    books: cleanBooks,
    positions,
    annotations,
    stats,
    kv,
    fonts,
    coverRows,
  };
}

export function backupFileName(format: 'zip' | 'json', date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const d = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  return format === 'zip' ? `${d}.${BACKUP_EXT}` : `${d}.json`;
}

export async function createBackup(opts: BackupOptions): Promise<Blob> {
  const d = await collectBackupData(opts);
  const manifest: BackupManifest = {
    app: 'moonreader-web',
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    deviceId: deviceId(),
    userAgent: globalThis.navigator?.userAgent ?? '',
    counts: { books: d.books.length, positions: d.positions.length, annotations: d.annotations.length, stats: d.stats.length, kv: d.kv.length },
    includes: { covers: opts.covers, books: opts.books },
  };
  const coverMeta = opts.covers ? d.coverRows.map((c) => ({ bookId: c.bookId, kind: c.kind, type: c.blob.type })) : [];
  const fontMeta = opts.books ? d.fonts.map(({ blob: _b, ...m }) => m) : [];
  const core = { settings: d.settings, books: d.books, positions: d.positions, annotations: d.annotations, stats: d.stats, kv: d.kv, fonts: fontMeta, covers: coverMeta };
  if (opts.format === 'json') {
    return new Blob([JSON.stringify({ manifest, ...core })], { type: 'application/json' });
  }
  const files: Zippable = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 1)) };
  for (const [k, v] of Object.entries(core)) files[`${k}.json`] = strToU8(JSON.stringify(v));
  if (opts.covers) {
    for (const [i, c] of d.coverRows.entries()) files[`covers/${i}`] = [new Uint8Array(await c.blob.arrayBuffer()), { level: 0 }];
    // covers.json 里的顺序与 covers/<i> 对应
  }
  if (opts.books) {
    const db = await getDb();
    for (const b of d.books) {
      const f = await db.get('files', b.id);
      if (f) files[`files/${b.id}`] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
    }
    for (const f of d.fonts) files[`fonts/${f.id}`] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  }
  const zipped = zipSync(files);
  return new Blob([zipped as unknown as BlobPart], { type: 'application/zip' });
}

// ───────────── 恢复 ─────────────
export interface ParsedBackup {
  data: BackupData;
  coverBlobs: Map<number, Blob>;
  fileBlobs: Map<string, Blob>;
  fontBlobs: Map<string, Blob>;
}

export class BackupFormatError extends Error {}

export async function parseBackup(file: Blob): Promise<ParsedBackup> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const empty = { coverBlobs: new Map<number, Blob>(), fileBlobs: new Map<string, Blob>(), fontBlobs: new Map<string, Blob>() };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      throw new BackupFormatError('不是有效的备份文件');
    }
    const json = <T>(name: string, dflt: T): T => (entries[name] ? (JSON.parse(strFromU8(entries[name])) as T) : dflt);
    const manifest = json<BackupManifest | undefined>('manifest.json', undefined);
    if (!manifest || manifest.app !== 'moonreader-web') throw new BackupFormatError('不是静读天下 Web 版的备份文件');
    if (manifest.version > BACKUP_VERSION) throw new BackupFormatError('备份来自更新的版本，请先升级应用');
    const data: BackupData = {
      manifest,
      settings: json('settings.json', {}),
      books: json('books.json', []),
      positions: json('positions.json', []),
      annotations: json('annotations.json', []),
      stats: json('stats.json', []),
      kv: json('kv.json', []),
      fonts: json('fonts.json', []),
      covers: json('covers.json', []),
    };
    const out: ParsedBackup = { data, ...empty };
    data.covers.forEach((c, i) => {
      const e = entries[`covers/${i}`];
      if (e) out.coverBlobs.set(i, new Blob([e as unknown as BlobPart], { type: c.type }));
    });
    for (const b of data.books) {
      const e = entries[`files/${b.id}`];
      if (e) out.fileBlobs.set(b.id, new Blob([e as unknown as BlobPart]));
    }
    for (const f of data.fonts) {
      const e = entries[`fonts/${f.id}`];
      if (e) out.fontBlobs.set(f.id, new Blob([e as unknown as BlobPart]));
    }
    return out;
  }
  try {
    const j = JSON.parse(strFromU8(bytes)) as Partial<BackupData>;
    if (!j.manifest || j.manifest.app !== 'moonreader-web') throw new BackupFormatError('不是静读天下 Web 版的备份文件');
    return {
      data: {
        manifest: j.manifest,
        settings: j.settings ?? {},
        books: j.books ?? [],
        positions: j.positions ?? [],
        annotations: j.annotations ?? [],
        stats: j.stats ?? [],
        kv: j.kv ?? [],
        fonts: [],
        covers: [],
      },
      ...empty,
    };
  } catch (e) {
    if (e instanceof BackupFormatError) throw e;
    throw new BackupFormatError('不是有效的备份文件');
  }
}

export interface RestoreReport {
  books: number;
  positions: number;
  annotations: number;
  stats: number;
  kv: number;
  covers: number;
  files: number;
}

/**
 * 恢复。replace：清空对应 store 后写入；merge：按记录取新者（书和封面/文件已有则保留本机，进度与标注取 updatedAt 较新的，统计逐日取较大值）。
 * 恢复后重置设备 id（避免与云同步冲突，BAK-002）。
 */
export async function restoreBackup(p: ParsedBackup, mode: 'merge' | 'replace'): Promise<RestoreReport> {
  const d = p.data;
  const rep: RestoreReport = { books: 0, positions: 0, annotations: 0, stats: 0, kv: 0, covers: 0, files: 0 };
  const db = await getDb();

  if (mode === 'replace') {
    for (const s of ['books', 'files', 'covers', 'positions', 'annotations', 'stats', 'fonts'] as const) await clearStore(s);
    const kvRows = await getAllRaw('kv');
    for (const r of kvRows) if (!SKIP_KV(r.key) || r.key.startsWith('library.downloads')) await db.delete('kv', r.key);
    await putManyRaw('books', d.books);
    await putManyRaw('positions', d.positions);
    await putManyRaw('annotations', d.annotations);
    await putManyRaw('stats', d.stats);
    await putManyRaw('kv', d.kv.filter((r) => !SKIP_KV(r.key)));
    rep.books = d.books.length;
    rep.positions = d.positions.length;
    rep.annotations = d.annotations.length;
    rep.stats = d.stats.length;
    rep.kv = d.kv.length;
  } else {
    const have = new Set((await getAllRaw('books')).map((b) => b.id));
    const newBooks = d.books.filter((b) => !have.has(b.id));
    await putManyRaw('books', newBooks);
    rep.books = newBooks.length;
    const curPos = new Map((await getAllRaw('positions')).map((x) => [x.bookId, x]));
    const pos = d.positions.filter((x) => (curPos.get(x.bookId)?.updatedAt ?? -1) < x.updatedAt);
    await putManyRaw('positions', pos);
    rep.positions = pos.length;
    const curAnn = new Map((await getAllRaw('annotations')).map((x) => [x.id, x]));
    const ann = d.annotations.filter((x) => (curAnn.get(x.id)?.updatedAt ?? -1) < x.updatedAt);
    await putManyRaw('annotations', ann);
    rep.annotations = ann.length;
    const curStats = new Map((await getAllRaw('stats')).map((x) => [x.bookId, x]));
    const stats = d.stats.map((s) => mergeStat(curStats.get(s.bookId), s));
    await putManyRaw('stats', stats);
    rep.stats = stats.length;
    const curKv = new Set((await getAllRaw('kv')).map((r) => r.key));
    const kv = d.kv.filter((r) => !SKIP_KV(r.key) && !curKv.has(r.key));
    await putManyRaw('kv', kv);
    rep.kv = kv.length;
    // 最近阅读历史合并（按时间倒序去重）
    const histKey = 'library.history';
    const dh = d.kv.find((r) => r.key === histKey)?.value as { bookId: string; at: number }[] | undefined;
    if (dh?.length) {
      const cur = ((await db.get('kv', histKey))?.value as { bookId: string; at: number }[] | undefined) ?? [];
      const seen = new Map<string, { bookId: string; at: number }>();
      for (const h of [...cur, ...dh]) if ((seen.get(h.bookId)?.at ?? -1) < h.at) seen.set(h.bookId, h);
      await db.put('kv', { key: histKey, value: [...seen.values()].sort((a, b) => b.at - a.at).slice(0, 1000) });
    }
  }

  // 二进制：封面（已有则保留本机）、书籍文件、字体
  const newBookIds = new Set(d.books.map((b) => b.id));
  for (const [i, blob] of p.coverBlobs) {
    const c = d.covers[i];
    if (!c || !newBookIds.has(c.bookId)) continue;
    if (mode === 'merge' && (await db.get('covers', [c.bookId, c.kind]))) continue;
    await db.put('covers', { bookId: c.bookId, kind: c.kind, blob });
    rep.covers++;
  }
  for (const [id, blob] of p.fileBlobs) {
    if (mode === 'merge' && (await db.get('files', id))) continue;
    await db.put('files', { bookId: id, blob });
    rep.files++;
  }
  for (const f of d.fonts) {
    const blob = p.fontBlobs.get(f.id);
    if (!blob) continue;
    if (mode === 'merge' && (await db.get('fonts', f.id))) continue;
    await db.put('fonts', { ...f, blob });
  }

  // 设置：只在「覆盖」时采用备份里的；设备相关项（服务端地址/令牌）始终保持本机值
  if (mode === 'replace') {
    const cur = exportAllSettings() as Record<string, Record<string, unknown>>;
    const incoming = scrubSettings(d.settings, false);
    const next: Record<string, Record<string, unknown>> = {};
    for (const [ns, vals] of Object.entries(incoming)) next[ns] = { ...cur[ns], ...vals };
    importAllSettings(next, 'merge');
  }
  resetDeviceId();
  for (const store of ['books', 'positions', 'annotations', 'stats', 'kv', 'covers', 'files'] as const) dbEvents.emit('change', { store });
  return rep;
}

function mergeStat(a: StatRecord | undefined, b: StatRecord): StatRecord {
  if (!a) return b;
  const days: StatRecord['days'] = { ...a.days };
  const dayPages: Record<number, number> = { ...(a.dayPages ?? {}) };
  for (const [k, v] of Object.entries(b.days)) {
    const cur = days[Number(k)];
    if (!cur || cur.ms < v.ms) days[Number(k)] = v;
  }
  for (const [k, v] of Object.entries(b.dayPages ?? {})) dayPages[Number(k)] = Math.max(dayPages[Number(k)] ?? 0, v);
  const usedMs = Object.values(days).reduce((s, x) => s + x.ms, 0);
  const words = Object.values(days).reduce((s, x) => s + x.words, 0);
  const pages = Object.values(dayPages).reduce((s, x) => s + x, 0) || Math.max(a.pages ?? 0, b.pages ?? 0);
  return { bookId: a.bookId, usedMs, words, days, ...(pages ? { pages, dayPages } : {}) };
}

// ───────────── 云端（WebDAV） ─────────────
export interface CloudBackup {
  name: string;
  size: number;
  mtime: number;
}

export async function uploadCloudBackup(blob: Blob, name: string): Promise<void> {
  const cfg = await loadSyncConfig();
  if (!cfg) throw new Error('云同步未启用');
  await clientFor(cfg).put(`${backupDir(cfg.root)}/${name}`, blob);
}

export async function listCloudBackups(): Promise<CloudBackup[]> {
  const cfg = await loadSyncConfig();
  if (!cfg) throw new Error('云同步未启用');
  const list = await clientFor(cfg).list(backupDir(cfg.root));
  return list
    .filter((e) => !e.dir && /\.(mrweb|json)$/i.test(e.name))
    .map((e) => ({ name: e.name, size: e.size, mtime: e.mtime }))
    .sort((a, b) => b.mtime - a.mtime);
}

export async function downloadCloudBackup(name: string): Promise<Blob> {
  const cfg = await loadSyncConfig();
  if (!cfg) throw new Error('云同步未启用');
  const blob = await clientFor(cfg).get(`${backupDir(cfg.root)}/${name}`);
  if (!blob) throw new Error('云端找不到该备份');
  return blob;
}
