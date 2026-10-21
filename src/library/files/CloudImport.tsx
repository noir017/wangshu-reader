// 云端导入（SYNC-011 的 Web 做法）：浏览 WebDAV 目录，勾选书籍下载进书库；单选可直接阅读。
// 其余云盘文件管理（移动/复制/删除/搜索）不做，只读浏览。
import { useEffect, useState } from 'react';
import { ArrowLeft, Cloud, Folder, Library } from 'lucide-react';
import { Button, openOverlay, toast } from '@/ui';
import { navigate } from '@/core/router';
import { detectFormat } from '@/formats';
import { clientFor, loadSyncConfig, type SyncConfig } from '@/storage/sync';
import { normPath, parentOf, type DavEntry } from '@/storage/webdav';
import { runWithProgress } from '../ImportDialogs';
import { importFile } from '../import';
import { openBook } from '../open';
import { formatDate, formatSize } from '../format';
import { useSelection } from '../interactions';
import { Empty, FullDialog, Spinner } from '../ui-kit';
import { t } from '../i18n';
import s from '../library.module.css';
import f from './files.module.css';

export function openCloudImport(): void {
  openOverlay((close) => <CloudImportDialog onClose={close} />);
}

const isBook = (e: DavEntry) => !e.dir && !!detectFormat(e.name);
const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;

function CloudImportDialog({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<SyncConfig | null | undefined>(undefined);
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<DavEntry[] | null>(null);
  const [err, setErr] = useState('');
  const sel = useSelection();

  useEffect(() => {
    void loadSyncConfig().then(
      (c) => {
        setCfg(c);
        if (c) setPath(c.root);
      },
      () => setCfg(null),
    );
  }, []);

  useEffect(() => {
    if (!cfg) return;
    let live = true;
    setEntries(null);
    setErr('');
    sel.clear();
    clientFor(cfg)
      .list(path)
      .then(
        (list) => live && setEntries(list.filter((e) => !e.name.startsWith('.') && (e.dir || isBook(e))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))),
        (e: Error) => {
          if (!live) return;
          setErr(e.message);
          setEntries([]);
        },
      );
    return () => {
      live = false;
    };
  }, [cfg, path]); // eslint-disable-line react-hooks/exhaustive-deps

  const picked = (entries ?? []).filter((e) => sel.ids.has(e.name));

  const fetchInto = async (list: DavEntry[], opts: { onShelf: boolean }) => {
    if (!cfg) return [];
    const dav = clientFor(cfg);
    const out: string[] = [];
    await runWithProgress(t('cloudDownloading'), async (ctl) => {
      for (const [i, e] of list.entries()) {
        if (ctl.signal.aborted) break;
        ctl.update({ done: i, total: list.length, current: e.name });
        try {
          const blob = await dav.get(join(path, e.name), { signal: ctl.signal });
          if (!blob) throw new Error('404');
          const { book } = await importFile({ file: new File([blob], e.name) }, { onShelf: opts.onShelf, source: { kind: 'url', url: join(path, e.name) } });
          out.push(book.id);
        } catch (ex) {
          if (ctl.signal.aborted) break;
          toast(`${e.name}: ${(ex as Error).message}`);
        }
      }
    });
    return out;
  };

  const crumbs = normPath(path).split('/').filter(Boolean);
  return (
    <FullDialog
      title={t('cloudImport')}
      onClose={onClose}
      width={640}
      actions={
        cfg && picked.length > 0 ? (
          <>
            {picked.length === 1 && (
              <Button
                onClick={async () => {
                  const [id] = await fetchInto(picked, { onShelf: false });
                  if (id) {
                    onClose();
                    await openBook(id);
                  }
                }}
              >
                {t('cloudReadOne')}
              </Button>
            )}
            <Button
              primary
              onClick={async () => {
                const ids = await fetchInto(picked, { onShelf: true });
                sel.clear();
                if (ids.length) toast(t('importDone', { n: ids.length }));
              }}
            >
              {t('cloudImportN', { n: picked.length })}
            </Button>
          </>
        ) : undefined
      }
    >
      {cfg === undefined ? (
        <Empty icon={<Spinner size={28} />} text={t('loading')} />
      ) : cfg === null ? (
        <Empty icon={<Cloud size={44} />} text={t('cloudNeedSync')}>
          <Button
            primary
            onClick={() => {
              onClose();
              navigate('settings', 'sync');
            }}
          >
            {t('cloudGoSettings')}
          </Button>
        </Empty>
      ) : (
        <>
          <div className={f.crumbs}>
            <button className={f.crumb} data-last={crumbs.length === 0 ? 'true' : undefined} onClick={() => setPath('/')}>
              {t('cloudRoot')}
            </button>
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span className={s.dim}>›</span>
                <button className={f.crumb} data-last={i === crumbs.length - 1 ? 'true' : undefined} onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>
                  {c}
                </button>
              </span>
            ))}
          </div>
          {path !== '/' && (
            <div className={s.groupRow} onClick={() => setPath(parentOf(path))}>
              <ArrowLeft size={18} className={s.dim} />
              <span className={s.grow}>..</span>
            </div>
          )}
          {entries === null ? (
            <Empty icon={<Spinner size={28} />} text={t('loading')} />
          ) : err ? (
            <Empty text={err} />
          ) : entries.length === 0 ? (
            <Empty icon={<Library size={44} />} text={t('cloudEmpty')} />
          ) : (
            entries.map((e) => (
              <div key={e.name} className={s.groupRow} data-selected={sel.ids.has(e.name) ? 'true' : undefined} style={sel.ids.has(e.name) ? { background: 'color-mix(in srgb, var(--mr-accent) 16%, var(--mr-surface))' } : undefined} onClick={() => (e.dir ? setPath(join(path, e.name)) : sel.toggle(e.name))}>
                {e.dir ? <Folder size={22} color="#e0a100" /> : <input type="checkbox" readOnly checked={sel.ids.has(e.name)} style={{ width: 18, height: 18, accentColor: 'var(--mr-accent)' }} />}
                <div className={s.grow}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                  {!e.dir && (
                    <div className={s.dim} style={{ fontSize: 12 }}>
                      {formatSize(e.size)} {e.mtime ? `· ${formatDate(e.mtime)}` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </FullDialog>
  );
}
