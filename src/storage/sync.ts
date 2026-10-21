// 云同步（SYNC-001..007）：只说 WebDAV。进度 .po、标注 .an（zlib）、recent.list、书籍文件，格式与原版互通（spec 01 §4.4）。
// 冲突策略（SYNC-007 的改进）：位置只在「远端更新」时才提示；标注逐条按时间取新者，删除靠持久墓碑。
import type { AnnotationRecord, BookRecord, PositionRecord } from '@/core/library';
import { syncSettings } from '@/library/settings';
import { getAccountSecret } from './accounts';
import {
  deleteKV,
  deviceId,
  getBook,
  getBookFile,
  getHistory,
  getKV,
  getPosition,
  listAnnotations,
  newId,
  putAnnotation,
  savePosition,
  setKV,
} from './db';
import {
  annotationKey,
  annotationToMoonNote,
  compressAn,
  decodeAnText,
  decodePo,
  decodeRecent,
  decompressAn,
  differentNote,
  DELETED,
  encodeAnText,
  encodePo,
  encodeRecent,
  formatPositionString,
  moonNoteToAnnotation,
  noteKey,
  parsePositionString,
  type RecentItem,
} from './moon-formats';
import { createDavTransport, DavClient, davAvailable, normPath, type DavConfig } from './webdav';

export interface SyncConfig {
  dav: DavConfig;
  root: string;
  showMsg: boolean;
  manual: boolean;
  syncBooks: boolean;
  syncRecent: boolean;
}

/** 当前配置；未启用或服务端不可用返回 null */
export async function loadSyncConfig(): Promise<SyncConfig | null> {
  const s = syncSettings.get();
  if (!s.enabled) return null;
  const password = (await getAccountSecret('webdav')) ?? '';
  const dav: DavConfig = { mode: s.mode, url: s.url, user: s.user, password };
  if (!davAvailable(dav)) return null;
  return { dav, root: normPath(s.bookPath || '/'), showMsg: s.showSyncMsg, manual: s.syncManually, syncBooks: s.syncReadingBook, syncRecent: s.syncRecentList };
}

export function clientFor(cfg: SyncConfig): DavClient {
  return new DavClient(createDavTransport(cfg.dav));
}

// ───────────── 路径 ─────────────
export const cacheDir = (root: string) => `${root === '/' ? '' : root}/.Moon+/Cache`;
export const backupDir = (root: string) => `${root === '/' ? '' : root}/.Moon+/Backup`;
const poPath = (root: string, fileName: string) => `${cacheDir(root)}/${fileName}.po`;
const anPath = (root: string, fileName: string) => `${cacheDir(root)}/${fileName}.an`;
const recentPath = (root: string) => `${cacheDir(root)}/recent.list`;
const bookPath = (root: string, fileName: string) => `${root === '/' ? '' : root}/${fileName}`;

const FIXED = new Set(['pdf', 'cbz', 'cbr', 'cb7', 'djvu']);
export const isFixedFormat = (format: string) => FIXED.has(format.toLowerCase());

// ───────────── 同步元数据 ─────────────
export interface SyncState {
  lastKey?: string;
  lastUploadAt?: number;
  lastRemoteDevice?: string;
  lastSyncAt?: number;
}
const stateKey = (bookId: string) => `sync.state.${bookId}`;
export const getSyncState = async (bookId: string) => (await getKV<SyncState>(stateKey(bookId))) ?? {};
export const setSyncState = (bookId: string, patch: SyncState) => getSyncState(bookId).then((s) => setKV(stateKey(bookId), { ...s, ...patch }));
export const clearSyncState = (bookId: string) => deleteKV(stateKey(bookId));

// ───────────── 阅读进度 .po ─────────────
/** 和 .po 同目录的 .po.json：只有自家 Web 端读，用来拿到精确位置与更新时间 */
interface PoSidecar {
  deviceId: string;
  updatedAt: number;
  section: number;
  offset: number;
  progress: number;
  bookId: string;
}

export function positionToString(book: Pick<BookRecord, 'format'>, pos: PositionRecord): string {
  return formatPositionString({ chapter: pos.locator.section, position: pos.locator.offset, percent: pos.progress * 100 }, isFixedFormat(book.format));
}

export interface RemotePosition {
  deviceId: string;
  section: number;
  offset: number;
  /** 0..1 */
  progress: number;
  updatedAt: number;
  webY?: number;
  /** true = 精确位置（来自 Web 端旁路文件）；false = 由原版位置串粗略换算 */
  exact: boolean;
  raw: string;
}

export async function uploadPosition(dav: DavClient, cfg: SyncConfig, book: BookRecord, force = false): Promise<boolean> {
  const pos = await getPosition(book.id);
  if (!pos) return false;
  const posStr = positionToString(book, pos);
  const key = `${book.fileName}|${posStr}`;
  const st = await getSyncState(book.id);
  // 原 5 分钟去重：位置没变且 5 分钟内传过就不再传
  if (!force && st.lastKey === key && Date.now() - (st.lastUploadAt ?? 0) < 5 * 60_000) return false;
  const me = deviceId();
  const extra = pos.extra as { webY?: number } | undefined;
  await dav.put(poPath(cfg.root, book.fileName), encodePo({ deviceId: me, position: posStr, webY: typeof extra?.webY === 'number' ? Math.round(extra.webY) : undefined }), 'text/plain; charset=utf-8');
  const side: PoSidecar = { deviceId: me, updatedAt: pos.updatedAt, section: pos.locator.section, offset: pos.locator.offset, progress: pos.progress, bookId: book.id };
  try {
    await dav.put(poPath(cfg.root, book.fileName) + '.json', JSON.stringify(side), 'application/json');
  } catch {
    /* 旁路文件失败不影响与原版互通 */
  }
  await setSyncState(book.id, { lastKey: key, lastUploadAt: Date.now() });
  return true;
}

export async function downloadPosition(dav: DavClient, cfg: SyncConfig, book: BookRecord): Promise<RemotePosition | null> {
  const text = await dav.getText(poPath(cfg.root, book.fileName));
  if (!text) return null;
  const po = decodePo(text);
  if (!po) return null;
  const moon = parsePositionString(po.position);
  if (!moon) return null;
  let side: PoSidecar | undefined;
  try {
    const j = await dav.getText(poPath(cfg.root, book.fileName) + '.json');
    if (j) side = JSON.parse(j) as PoSidecar;
  } catch {
    side = undefined;
  }
  if (side && side.deviceId === po.deviceId) {
    return { deviceId: po.deviceId, section: side.section, offset: side.offset, progress: side.progress, updatedAt: side.updatedAt, webY: po.webY, exact: true, raw: text };
  }
  return {
    deviceId: po.deviceId,
    section: moon.chapter,
    offset: moon.position,
    progress: Math.min(1, Math.max(0, (moon.percent ?? 0) / 100)),
    updatedAt: 0,
    webY: po.webY,
    exact: false,
    raw: text,
  };
}

/** 远端位置与本地是否有实质差别（原 showHintForCloudPositionSync：章不同，或偏移差 >80） */
export function positionDiffers(local: PositionRecord | undefined, remote: RemotePosition): boolean {
  if (!local) return true;
  if (local.locator.section !== remote.section) return true;
  return Math.abs(local.locator.offset - remote.offset) > 80;
}

/** 远端位置是否可信地比本地新：自家 Web 端有时间戳比较；原版端没有时间戳，只要不是自己传的就视为更新（原 app 行为） */
export function remoteIsNewer(local: PositionRecord | undefined, remote: RemotePosition): boolean {
  if (remote.deviceId === deviceId()) return false;
  if (!local) return true;
  if (remote.exact) return remote.updatedAt > local.updatedAt;
  return true;
}

export async function applyRemotePosition(bookId: string, remote: RemotePosition): Promise<void> {
  const prev = await getPosition(bookId);
  await savePosition({
    bookId,
    locator: { section: remote.section, offset: remote.offset },
    progress: remote.progress,
    updatedAt: remote.exact && remote.updatedAt ? remote.updatedAt : Date.now(),
    deviceId: remote.deviceId,
    extra: { ...(prev?.extra ?? {}), ...(remote.webY !== undefined ? { webY: remote.webY } : {}) },
  });
  await setSyncState(bookId, { lastRemoteDevice: remote.deviceId, lastSyncAt: Date.now() });
}

// ───────────── 标注 .an ─────────────
export async function uploadAnnotations(dav: DavClient, cfg: SyncConfig, book: BookRecord): Promise<boolean> {
  const all = await listAnnotations(book.id, { includeDeleted: true });
  if (all.length === 0) return false;
  const text = encodeAnText({ fileSize: book.size, notes: all.map((a) => annotationToMoonNote(a, book)) });
  await dav.put(anPath(cfg.root, book.fileName), compressAn(text) as unknown as BodyInit, 'application/octet-stream');
  return true;
}

export interface AnnotationMergeResult {
  changed: boolean;
  added: number;
  updated: number;
  removed: number;
  /** 书文件大小相差过大（>100000 字节），认为不是同一版本 */
  rejected?: boolean;
}

/** 把远端标注合并进本地（也用于导入 .an/.mrexpt 文件）。逐条：新者胜，删除按墓碑 */
export async function mergeRemoteAnnotations(book: BookRecord, text: string, opts: { ignoreSize?: boolean } = {}): Promise<AnnotationMergeResult> {
  const remote = decodeAnText(text);
  const res: AnnotationMergeResult = { changed: false, added: 0, updated: 0, removed: 0 };
  if (!remote) return { ...res, rejected: true };
  if (!opts.ignoreSize && book.size && Math.abs(book.size - remote.fileSize) > 100000) return { ...res, rejected: true };
  const local = await listAnnotations(book.id, { includeDeleted: true });
  const map = new Map<string, AnnotationRecord>();
  for (const a of local) map.set(annotationKey(a), a);
  for (const rn of remote.notes) {
    const key = noteKey(rn);
    const l = map.get(key);
    const remoteDeleted = rn.bak === DELETED;
    if (l) {
      if (remoteDeleted) {
        if (!l.deletedAt && rn.time >= l.updatedAt) {
          await putAnnotation({ ...l, deletedAt: rn.time || Date.now(), updatedAt: rn.time || Date.now() });
          res.removed++;
        }
      } else if (l.deletedAt) {
        if (rn.time > l.deletedAt) {
          const { deletedAt: _d, ...rest } = moonNoteToAnnotation(rn, book.id, l.id);
          await putAnnotation(rest as AnnotationRecord);
          res.updated++;
        }
      } else if (differentNote(l, rn) && rn.time >= l.updatedAt) {
        await putAnnotation({ ...moonNoteToAnnotation(rn, book.id, l.id), prefix: l.prefix, suffix: l.suffix, chapterTitle: l.chapterTitle, progress: l.progress });
        res.updated++;
      }
    } else if (!remoteDeleted) {
      const a = moonNoteToAnnotation(rn, book.id, newId());
      await putAnnotation(a);
      map.set(key, a);
      res.added++;
    }
  }
  res.changed = res.added + res.updated + res.removed > 0;
  return res;
}

export async function downloadAnnotations(dav: DavClient, cfg: SyncConfig, book: BookRecord): Promise<AnnotationMergeResult | null> {
  const bytes = await dav.getBytes(anPath(cfg.root, book.fileName));
  if (!bytes) return null;
  return mergeRemoteAnnotations(book, decompressAn(bytes));
}

// ───────────── recent.list ─────────────
export async function uploadRecent(dav: DavClient, cfg: SyncConfig, book: BookRecord): Promise<boolean> {
  if (!cfg.syncBooks || !cfg.syncRecent) return false;
  const pos = await getPosition(book.id);
  const item: RecentItem = {
    cloudPath: bookPath(cfg.root, book.fileName),
    title: book.title,
    at: Date.now(),
    size: book.size,
    localPath: book.fileName,
    deviceId: deviceId(),
    position: pos ? positionToString(book, pos) : '0#0',
  };
  await dav.put(recentPath(cfg.root), encodeRecent(item), 'text/plain; charset=utf-8');
  return true;
}

export async function downloadRecent(dav: DavClient, cfg: SyncConfig): Promise<RecentItem | null> {
  const t = await dav.getText(recentPath(cfg.root));
  return t ? decodeRecent(t) : null;
}

// ───────────── 书籍文件 ─────────────
/** 云端已有同名同大小就跳过（原策略） */
export async function uploadBookFile(dav: DavClient, cfg: SyncConfig, book: BookRecord): Promise<boolean> {
  const path = bookPath(cfg.root, book.fileName);
  const st = await dav.stat(path);
  if (st && st.size === book.size) return false;
  const blob = await getBookFile(book.id);
  if (!blob) return false;
  await dav.put(path, blob);
  return true;
}

export async function downloadBookFile(dav: DavClient, cfg: SyncConfig, fileName: string): Promise<File | null> {
  const blob = await dav.get(bookPath(cfg.root, fileName));
  return blob ? new File([blob], fileName) : null;
}

/** 导入原版的 .po 文件内容（BAK：能导入 .po 进度） */
export async function importPoText(bookId: string, text: string): Promise<boolean> {
  const po = decodePo(text);
  const moon = po ? parsePositionString(po.position) : null;
  if (!po || !moon) return false;
  await applyRemotePosition(bookId, {
    deviceId: po.deviceId,
    section: moon.chapter,
    offset: moon.position,
    progress: Math.min(1, Math.max(0, (moon.percent ?? 0) / 100)),
    updatedAt: 0,
    webY: po.webY,
    exact: false,
    raw: text,
  });
  return true;
}

// ───────────── 编排（SYNC-006） ─────────────
export interface SyncUi {
  /** 询问用户（返回 true = 同意）；null = 不询问直接采用 */
  confirmPosition?: (info: { book: BookRecord; remote: RemotePosition }) => Promise<boolean>;
  notify?: (msg: string) => void;
}

export interface SyncStatus {
  ok: boolean;
  message?: string;
}

/** 打开书时：下载 .po（远端更新则按用户确认采用）、下载并合并 .an。返回是否改写了本地位置/标注 */
export async function syncOnOpen(bookId: string, ui: SyncUi = {}): Promise<{ position: boolean; annotations: boolean }> {
  const out = { position: false, annotations: false };
  const cfg = await loadSyncConfig();
  const book = await getBook(bookId);
  if (!cfg || !book || cfg.manual) return out;
  const dav = clientFor(cfg);
  const remote = await downloadPosition(dav, cfg, book);
  if (remote) {
    const local = await getPosition(bookId);
    if (remoteIsNewer(local, remote) && positionDiffers(local, remote)) {
      const yes = ui.confirmPosition ? await ui.confirmPosition({ book, remote }) : true;
      if (yes) {
        await applyRemotePosition(bookId, remote);
        out.position = true;
        if (cfg.showMsg) ui.notify?.('已从云端同步阅读进度');
      }
    }
  }
  const merged = await downloadAnnotations(dav, cfg, book);
  if (merged?.changed) out.annotations = true;
  if (cfg.syncBooks) await uploadBookFile(dav, cfg, book).catch(() => false);
  return out;
}

/** 暂停/退出阅读时：上传 .po → .an（有改动才传）→ recent.list */
export async function syncOnClose(bookId: string, ui: SyncUi = {}, opts: { annotations?: boolean } = {}): Promise<void> {
  const cfg = await loadSyncConfig();
  const book = await getBook(bookId);
  if (!cfg || !book || cfg.manual) return;
  await pushBook(bookId, ui, { force: false, annotations: opts.annotations ?? false });
}

/** 手动「同步到云端」（force 默认真：不做 5 分钟去重；annotations 默认真） */
export async function pushBook(bookId: string, ui: SyncUi = {}, opts: { force?: boolean; annotations?: boolean } = {}): Promise<void> {
  const cfg = await loadSyncConfig();
  const book = await getBook(bookId);
  if (!cfg || !book) throw new Error('云同步未启用');
  const dav = clientFor(cfg);
  const posUp = await uploadPosition(dav, cfg, book, opts.force ?? true);
  if (opts.annotations ?? true) await uploadAnnotations(dav, cfg, book);
  if (cfg.syncBooks) {
    await uploadBookFile(dav, cfg, book).catch(() => false);
    await uploadRecent(dav, cfg, book).catch(() => false);
  }
  if (cfg.showMsg && posUp) ui.notify?.('已同步到云端');
}

/** 手动「从云端同步」：不询问，直接采用远端位置 */
export async function pullBook(bookId: string, ui: SyncUi = {}): Promise<{ position: boolean; annotations: boolean }> {
  const cfg = await loadSyncConfig();
  const book = await getBook(bookId);
  if (!cfg || !book) throw new Error('云同步未启用');
  const dav = clientFor(cfg);
  const out = { position: false, annotations: false };
  const remote = await downloadPosition(dav, cfg, book);
  if (remote && remote.deviceId !== deviceId()) {
    await applyRemotePosition(bookId, remote);
    out.position = true;
  }
  const merged = await downloadAnnotations(dav, cfg, book);
  out.annotations = !!merged?.changed;
  if (cfg.showMsg) ui.notify?.('已从云端同步');
  return out;
}

/** 批量同步：把有进度的书的 .po/.an 全部推一遍（设置页「立即同步」） */
export async function pushAll(onProgress?: (done: number, total: number) => void): Promise<number> {
  const cfg = await loadSyncConfig();
  if (!cfg) throw new Error('云同步未启用');
  const dav = clientFor(cfg);
  const hist = await getHistory();
  let n = 0;
  for (const [i, h] of hist.entries()) {
    const book = await getBook(h.bookId);
    if (!book) continue;
    try {
      if (await uploadPosition(dav, cfg, book, true)) n++;
      await uploadAnnotations(dav, cfg, book);
    } catch {
      /* 单本失败继续下一本 */
    }
    onProgress?.(i + 1, hist.length);
  }
  return n;
}
