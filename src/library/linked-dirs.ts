// 已链接目录与自动导入新书（LIB-024，仅 Chromium 的 File System Access）。
// 目录句柄存 kv（IndexedDB 能结构化克隆句柄）；权限只在用户手势里能重新申请，所以后台扫描只处理「已授权」的目录。
import { getKV, newId, setKV } from '@/storage/db';
import { importWithUi } from './ImportDialogs';
import { passesScanFilter, type ImportItem, type ScanFilter } from './import';
import { shelfSettings } from './settings';

/** File System Access 里本模块用到的最小子集（lib.dom 没有 values()/queryPermission） */
export interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirHandle | FileEntry>;
  queryPermission?(d: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' }): Promise<PermissionState>;
}
export interface FileEntry {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

export interface LinkedDir {
  id: string;
  name: string;
  handle: DirHandle;
}

const KEY = 'library.linkedDirs';
const MIN_INTERVAL = 60_000;

export const supportsLinkedDirs = (): boolean => typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

export async function listLinkedDirs(): Promise<LinkedDir[]> {
  return (await getKV<LinkedDir[]>(KEY)) ?? [];
}

/** 弹出系统目录选择器并保存（选择本身就授予读权限） */
export async function addLinkedDir(): Promise<LinkedDir | null> {
  const pick = (globalThis as unknown as { showDirectoryPicker(o: { mode: 'read' }): Promise<DirHandle> }).showDirectoryPicker;
  try {
    const handle = await pick.call(globalThis, { mode: 'read' });
    const dirs = await listLinkedDirs();
    const dir: LinkedDir = { id: newId().slice(0, 8), name: handle.name, handle };
    await setKV(KEY, [...dirs, dir]);
    return dir;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

export async function removeLinkedDir(id: string): Promise<void> {
  await setKV(KEY, (await listLinkedDirs()).filter((d) => d.id !== id));
}

export async function dirPermission(d: LinkedDir, request = false): Promise<PermissionState> {
  try {
    const cur = (await d.handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (cur === 'granted' || !request) return cur;
    return (await d.handle.requestPermission?.({ mode: 'read' })) ?? cur;
  } catch {
    return 'denied';
  }
}

export interface FoundFile {
  file: File;
  /** 相对链接目录的子目录 */
  dir: string;
}

/** 递归列出目录里的文件；最多深入 8 层，跳过隐藏目录 */
export async function* walkDir(handle: DirHandle, prefix = '', depth = 0): AsyncGenerator<FoundFile> {
  if (depth > 8) return;
  for await (const e of handle.values()) {
    if (e.kind === 'directory') {
      if (e.name.startsWith('.')) continue;
      yield* walkDir(e, prefix ? `${prefix}/${e.name}` : e.name, depth + 1);
    } else {
      yield { file: await e.getFile(), dir: prefix };
    }
  }
}

/** 自动导入的候选：修改时间晚于上次扫描、类型与大小合格；原 app 还跳过 err*.txt（崩溃日志） */
export function isAutoImportCandidate(file: { name: string; size: number; lastModified: number }, since: number, f: ScanFilter): boolean {
  if (file.lastModified <= since) return false;
  if (/^err.*\.txt$/i.test(file.name)) return false;
  return passesScanFilter(file, f);
}

export async function scanNewFiles(dirs: LinkedDir[], since: number, f: ScanFilter): Promise<ImportItem[]> {
  const out: ImportItem[] = [];
  for (const d of dirs) {
    if ((await dirPermission(d)) !== 'granted') continue;
    try {
      for await (const found of walkDir(d.handle)) {
        if (isAutoImportCandidate(found.file, since, f)) out.push({ file: found.file, dir: [d.name, found.dir].filter(Boolean).join('/') });
      }
    } catch {
      /* 目录被删或权限中途丢失：跳过这一个 */
    }
  }
  return out;
}

let running = false;

/** 书架页获得焦点时调用：距上次 ≥1 分钟才扫描；扫描时间只在成功扫完后更新 */
export async function autoImportNow(force = false): Promise<number> {
  const st = shelfSettings.get();
  if (!st.autoImport || running || !supportsLinkedDirs()) return 0;
  if (!force && Date.now() - st.autoImportTime < MIN_INTERVAL) return 0;
  running = true;
  try {
    const dirs = await listLinkedDirs();
    if (!dirs.length) return 0;
    const started = Date.now();
    const items = await scanNewFiles(dirs, st.autoImportTime, { types: st.importTypes, minSizeKB: st.importFileSize });
    shelfSettings.set({ autoImportTime: started });
    if (!items.length) return 0;
    const res = await importWithUi(items, { favorite: st.scanFav || undefined });
    return res.added.length;
  } finally {
    running = false;
  }
}
