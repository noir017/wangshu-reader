// 下载队列面板（NET-007）与「从链接下载」（NET-008）
import { Check, RotateCcw, X } from 'lucide-react';
import { Button, Sheet, openOverlay, promptDialog } from '@/ui';
import { enqueueDownload, cancelDownload, clearFinishedDownloads, retryDownload, useDownloads } from '../downloads';
import { ProgressLine } from '../ui-kit';
import { formatSize } from '../format';
import { goRead } from '../actions';
import { t } from '../i18n';
import s from '../library.module.css';

export function openDownloadQueue(): void {
  openOverlay((close) => <Queue onClose={close} />);
}

export async function downloadFromLink(): Promise<void> {
  const url = (await promptDialog(t('netFromLink'), 'https://', { placeholder: t('netLinkPrompt') }))?.trim();
  if (url && /^https?:\/\//i.test(url)) {
    enqueueDownload({ title: '', url });
    openDownloadQueue();
  }
}

function Queue({ onClose }: { onClose: () => void }) {
  const items = useDownloads((st) => st.items);
  return (
    <Sheet
      open
      position="center"
      title={t('netQueue')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={() => void downloadFromLink()}>{t('netFromLink')}</Button>
          <Button onClick={clearFinishedDownloads}>{t('clear')}</Button>
          <Button primary onClick={onClose}>
            {t('close')}
          </Button>
        </>
      }
    >
      {items.length === 0 && <div className={`${s.pad} ${s.dim}`}>—</div>}
      {items.map((it) => (
        <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--mr-border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14.5 }}>{it.title || it.url}</div>
            <div className={s.dim} style={{ fontSize: 12, marginTop: 2 }}>
              {it.status === 'running' && `${formatSize(it.loaded)}${it.total ? ` / ${formatSize(it.total)}` : ''}`}
              {it.status === 'queued' && '…'}
              {it.status === 'done' && <><Check size={12} style={{ verticalAlign: -2 }} /> {t('netDownloaded')}</>}
              {it.status === 'error' && <span style={{ color: '#e53935' }}>{it.error}</span>}
              {it.status === 'cancelled' && t('importCancelled')}
            </div>
            {it.status === 'running' && <div style={{ marginTop: 4 }}><ProgressLine value={it.total ? it.loaded / it.total : 0} /></div>}
          </div>
          {it.status === 'done' && it.bookId && (
            <button className={s.moreBtn} onClick={() => { onClose(); goRead(it.bookId!); }}>
              {t('netRead')}
            </button>
          )}
          {(it.status === 'error' || it.status === 'cancelled') && (
            <button className={s.moreBtn} aria-label={t('netRetry')} onClick={() => retryDownload(it.id)}>
              <RotateCcw size={16} />
            </button>
          )}
          {(it.status === 'running' || it.status === 'queued') && (
            <button className={s.moreBtn} aria-label={t('netCancelDl')} onClick={() => cancelDownload(it.id)}>
              <X size={16} />
            </button>
          )}
        </div>
      ))}
    </Sheet>
  );
}
