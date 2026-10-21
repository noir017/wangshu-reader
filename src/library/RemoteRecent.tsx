// 云端最近阅读建议卡片（SYNC-004）：另一台设备最近读的书（recent.list），点击打开或先从云端下载。
import { useEffect, useState } from 'react';
import { Cloud, X } from 'lucide-react';
import { toast } from '@/ui';
import { dbEvents, deleteKV, getKV } from '@/storage/db';
import { clientFor, downloadBookFile, loadSyncConfig } from '@/storage/sync';
import { importFile } from './import';
import { findLocalByRecent, REMOTE_RECENT_KEY, type RemoteRecent } from './sync-service';
import { openBook } from './open';
import { formatPercent } from './format';
import { parsePositionString } from '@/storage/moon-formats';
import { t } from './i18n';
import s from './library.module.css';

export function RemoteRecentCard() {
  const [item, setItem] = useState<RemoteRecent>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => void getKV<RemoteRecent>(REMOTE_RECENT_KEY).then((v) => live && setItem(v));
    load();
    const off = dbEvents.on('change', (e) => e.store === 'kv' && e.key === REMOTE_RECENT_KEY && load());
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!item) return null;
  const pct = parsePositionString(item.position)?.percent;
  const open = async () => {
    setBusy(true);
    try {
      let id = await findLocalByRecent(item);
      if (!id) {
        const cfg = await loadSyncConfig();
        if (!cfg) throw new Error('云同步未启用');
        const file = await downloadBookFile(clientFor(cfg), cfg, item.cloudPath.replace(/^.*\//, ''));
        if (!file) throw new Error('云端没有这本书的文件');
        id = (await importFile({ file }, { onShelf: false, source: { kind: 'url', url: item.cloudPath } })).book.id;
      }
      await deleteKV(REMOTE_RECENT_KEY);
      await openBook(id);
    } catch (e) {
      toast(t('syncFailed', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.card} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
      <Cloud size={22} color="var(--mr-accent)" />
      <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>《{item.title}》</div>
        <div className={s.dim} style={{ fontSize: 12 }}>
          {t('remoteRecent')} {pct !== undefined ? formatPercent(pct / 100) : ''}
        </div>
      </div>
      <button className={s.moreBtn} disabled={busy} onClick={() => void open()}>
        {t('openBook')}
      </button>
      <button className={s.moreBtn} aria-label={t('close')} onClick={() => void deleteKV(REMOTE_RECENT_KEY)}>
        <X size={16} />
      </button>
    </div>
  );
}
