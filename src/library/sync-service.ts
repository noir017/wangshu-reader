// 同步的触发时机（SYNC-006）：打开书前预检、进入/离开阅读页、页面隐藏、回到书架时读 recent.list。
// 阅读页是别的模块写的，这里不依赖它的任何接口：监听 hash 路由与数据库事件即可。
import { confirmDialog, toast } from '@/ui';
import { deviceId, dbEvents, findBooksByFileName, getKV, setKV } from '@/storage/db';
import {
  clientFor,
  downloadRecent,
  loadSyncConfig,
  pullBook,
  pushBook,
  syncOnClose,
  syncOnOpen,
  type SyncUi,
} from '@/storage/sync';
import type { RecentItem } from '@/storage/moon-formats';
import { navigate } from '@/core/router';
import { formatPercent } from './format';
import { t } from './i18n';

const ui: SyncUi = {
  notify: (m) => toast(m),
  confirmPosition: async ({ remote }) => confirmDialog(t('syncCloudNew', { pct: formatPercent(remote.progress) }), { title: 'WebDAV' }),
};

const checkedAt = new Map<string, number>();
const dirtyNotes = new Set<string>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

function currentReadId(): string | undefined {
  const h = globalThis.location?.hash.replace(/^#\/?/, '') ?? '';
  const [name, id] = h.split('?')[0].split('/');
  return name === 'read' && id ? decodeURIComponent(id) : undefined;
}

/** 重新挂载阅读页，让它按新写入的位置重新打开（hash 先离开再回来） */
function reloadReader(bookId: string): void {
  navigate('');
  setTimeout(() => navigate('read', bookId), 30);
}

/** 从书架打开书之前：最多等 3 秒拿云端进度，有更新就询问（在阅读页加载前处理，省掉重载） */
export async function preOpenSync(bookId: string): Promise<void> {
  checkedAt.set(bookId, Date.now());
  try {
    if (!(await loadSyncConfig())) return;
  } catch {
    return;
  }
  await withTimeout(syncOnOpen(bookId, ui), 3000);
}

async function lateOpenSync(bookId: string): Promise<void> {
  // 直接用 URL 打开阅读页（没有经过书架）时，进度已被阅读页读走，同步到新进度后需要重载
  const r = await syncOnOpen(bookId, ui).catch(() => undefined);
  if (r?.position && currentReadId() === bookId) reloadReader(bookId);
}

async function closeSync(bookId: string): Promise<void> {
  const annotations = dirtyNotes.delete(bookId);
  try {
    await syncOnClose(bookId, ui, { annotations });
  } catch (e) {
    const cfg = await loadSyncConfig().catch(() => null);
    if (cfg?.showMsg) toast(t('syncFailed', { msg: (e as Error).message }));
  }
}

let started = false;
export function startSyncService(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  let current = currentReadId();
  const onRoute = () => {
    const id = currentReadId();
    if (id && id !== current) {
      current = id;
      const last = checkedAt.get(id) ?? 0;
      if (Date.now() - last > 15_000) void lateOpenSync(id);
    } else if (!id && current) {
      const prev = current;
      current = undefined;
      // 阅读页卸载时才会写最后一次进度，稍等一下再上传
      setTimeout(() => void closeSync(prev), 1500);
    }
  };
  window.addEventListener('hashchange', onRoute);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (current) void closeSync(current);
    } else if (!current) {
      void checkCloudRecent();
    }
  });
  dbEvents.on('change', (e) => {
    if (e.store === 'annotations' && e.bookId) dirtyNotes.add(e.bookId);
  });
  if (current) void lateOpenSync(current);
  setTimeout(() => void checkCloudRecent(), 3000);
}

// ───────────── 手动同步（阅读页底栏第 18/19 号按钮，或书籍信息里调用） ─────────────
export async function syncToCloud(bookId: string): Promise<void> {
  try {
    await pushBook(bookId, ui, { force: true, annotations: true });
    toast(t('syncToCloud'));
  } catch (e) {
    toast(t('syncFailed', { msg: (e as Error).message }));
  }
}

export async function syncFromCloud(bookId: string): Promise<void> {
  try {
    const r = await pullBook(bookId, ui);
    toast(t('syncFromCloud'));
    if ((r.position || r.annotations) && currentReadId() === bookId) reloadReader(bookId);
  } catch (e) {
    toast(t('syncFailed', { msg: (e as Error).message }));
  }
}

// ───────────── recent.list：云端最近读的书（SYNC-004） ─────────────
export const REMOTE_RECENT_KEY = 'sync.recent.remote';

export interface RemoteRecent extends RecentItem {
  seenAt: number;
}

export async function checkCloudRecent(): Promise<void> {
  try {
    const cfg = await loadSyncConfig();
    if (!cfg || !cfg.syncBooks || !cfg.syncRecent) return;
    const item = await downloadRecent(clientFor(cfg), cfg);
    if (!item || item.deviceId === deviceId()) return;
    const prev = await getKV<RemoteRecent>(REMOTE_RECENT_KEY);
    if (prev && prev.at === item.at && prev.deviceId === item.deviceId) return;
    await setKV(REMOTE_RECENT_KEY, { ...item, seenAt: Date.now() });
    toast(t('syncRecentCard', { title: item.title }), 4000);
  } catch {
    /* 离线或未配置：静默 */
  }
}

/** 本地是否已有这本书（按文件名 + 大小） */
export async function findLocalByRecent(item: RecentItem): Promise<string | undefined> {
  const hit = (await findBooksByFileName(item.localPath.replace(/^.*[\\/]/, ''))).find((b) => !item.size || b.size === item.size);
  return hit?.id;
}

