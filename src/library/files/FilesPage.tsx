// 我的文件（LIB-028/029）：浏览服务端书库目录。服务端未配置书库目录时整页置灰提示。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, BookOpen, ClipboardPaste, Copy, Download, File as FileIcon, FileText, Folder, FolderPlus, Grid3x3, Heart, Image as ImageIcon, List, MoreVertical, Move, Pencil, Star, Trash2, Upload } from 'lucide-react';
import type { LibraryEntry } from '@shared/api';
import { IconButton, Button, confirmDialog, popupMenu, promptDialog, toast, chooseDialog, openOverlay } from '@/ui';
import { navigate, type Route } from '@/core/router';
import { detectFormat } from '@/formats';
import { getKV, hasBookFile, setKV } from '@/storage/db';
import { TopBar } from '../TopBar';
import { Empty, FullDialog, Spinner } from '../ui-kit';
import { useSelection, useLongPress } from '../interactions';
import { filesSettings } from '../settings';
import { askFavorite } from '../dialogs';
import { importFile } from '../import';
import { runWithProgress } from '../ImportDialogs';
import { openBook } from '../open';
import { openBookInfo } from '../BookInfo';
import { formatDate, formatSize, triggerDownload } from '../format';
import { addFavFolder, openFavFolders, removeFavFolder } from './FavFolders';
import { breadcrumbs, fileExt, isBrowsableArchive, isImageName, joinPath, sortEntries, splitPath, upFrom, type FileSort } from './files-model';
import { checkLibrary, copyEntries, deleteEntries, downloadServerFile, fileUrl, listDir, mkdir, moveEntries, renameEntry, searchFiles, thumbUrl, uploadFiles, type LibraryAvailability } from './files-client';
import { t } from '../i18n';
import s from '../library.module.css';
import f from './files.module.css';

const isBookName = (n: string) => !!detectFormat(n);
const SERVER_MAP = 'library.serverMap';

interface Clip {
  op: 'copy' | 'move';
  paths: string[];
}
let clipboard: Clip | undefined;

export function FilesPage({ route }: { route: Route }) {
  const st = filesSettings.use((x) => x);
  const path = route.query.get('path') ?? st.lastPath;
  const [avail, setAvail] = useState<LibraryAvailability>();
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ q: string; list: LibraryEntry[] } | null>(null);
  const [clip, setClip] = useState<Clip | undefined>(clipboard);
  const sel = useSelection();

  useEffect(() => {
    let live = true;
    void checkLibrary().then((a) => live && setAvail(a));
    return () => {
      live = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await listDir(path, st.showHidden);
      setEntries(r.entries);
    } catch (e) {
      setErr((e as Error).message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [path, st.showHidden]);

  useEffect(() => {
    if (avail?.ok) void reload();
  }, [avail, reload]);
  useEffect(() => {
    sel.clear();
    setResults(null);
    setQ('');
    if (path !== st.lastPath) filesSettings.set({ lastPath: path });
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (p: string) => navigate('files', p ? { path: p } : {});
  const shown = useMemo(() => (results ? results.list : sortEntries(entries ?? [], st.sortBy as FileSort, isBookName)), [entries, results, st.sortBy]);
  const picked = shown.filter((e) => sel.ids.has(e.path));
  const inArchive = splitPath(path).inner !== undefined;
  const crumbs = breadcrumbs(path, t('filesRoot'));
  const isFav = st.favFolders.includes(path);

  if (!avail) {
    return (
      <>
        <TopBar title={t('filesTitle')} />
        <div className={s.content}>
          <Empty icon={<Spinner size={28} />} text={t('loading')} />
        </div>
      </>
    );
  }
  if (!avail.ok) {
    return (
      <>
        <TopBar title={t('filesTitle')} />
        <div className={s.content} style={{ opacity: 0.6, filter: 'grayscale(1)' }}>
          <Empty icon={<Folder size={48} />} text={avail.reason === 'no-library' ? t('filesNoServerFeature') + '\n' + t('filesNeedServer') : t('filesNeedServer')} />
        </div>
      </>
    );
  }

  // ───── 点击条目 ─────
  const openEntry = async (e: LibraryEntry) => {
    if (e.dir || isBrowsableArchive(e)) {
      if (results) {
        setResults(null);
        setQ('');
      }
      return go(e.path);
    }
    if (isImageName(e.name)) return openImageViewer(shown.filter((x) => !x.dir && isImageName(x.name)), e);
    if (isBookName(e.name)) return openServerBook(e);
    const c = await chooseDialog<'text' | 'download'>(t('filesTitle'), [
      { value: 'text', label: t('filesOpenText'), subtitle: t('filesUnknownType') },
      { value: 'download', label: t('filesDownloadOrig') },
    ]);
    if (c === 'text') return openServerBook(e, true);
    if (c === 'download') return downloadToLocal([e]);
  };

  // ───── 批量操作 ─────
  const run = async (what: () => Promise<unknown>) => {
    try {
      await what();
      await reload();
    } catch (e) {
      toast(t('errorX', { msg: (e as Error).message }));
    }
  };
  const doCopyMove = (op: 'copy' | 'move') => {
    clipboard = { op, paths: picked.map((e) => e.path) };
    setClip(clipboard);
    sel.clear();
  };
  const doPaste = () =>
    clip &&
    void run(async () => {
      await (clip.op === 'copy' ? copyEntries(clip.paths, path) : moveEntries(clip.paths, path));
      clipboard = undefined;
      setClip(undefined);
    });
  const doRename = async () => {
    const e = picked[0];
    const name = await promptDialog(t('filesRenameTo'), e.name);
    if (name?.trim() && name !== e.name) {
      sel.clear();
      await run(() => renameEntry(e.path, name.trim()));
    }
  };
  const doDelete = async () => {
    const names = picked.map((e) => e.name);
    const ok = await confirmDialog(
      <div>
        <div>{t('filesDeleteConfirm')}</div>
        <div style={{ marginTop: 6, fontSize: 13, wordBreak: 'break-all', maxHeight: 160, overflow: 'auto' }}>{names.join('\n').split('\n').map((n, i) => <div key={i}>{n}</div>)}</div>
      </div>,
      { title: t('filesDelete') },
    );
    if (!ok) return;
    const paths = picked.map((e) => e.path);
    sel.clear();
    await run(() => deleteEntries(paths));
  };
  const doMkdir = async () => {
    const name = await promptDialog(t('filesNewFolder'), '', { placeholder: t('filesFolderName') });
    if (name?.trim()) await run(() => mkdir(joinPath(path, name.trim())));
  };
  const doUpload = async () => {
    const files = await new Promise<File[]>((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = true;
      inp.onchange = () => resolve([...(inp.files ?? [])]);
      inp.oncancel = () => resolve([]);
      inp.click();
    });
    if (files.length) await run(() => uploadFiles(path, files));
  };
  const doSearch = async (k: string) => {
    if (!k.trim()) return;
    setLoading(true);
    try {
      const r = await searchFiles(path, k.trim());
      setResults({ q: k.trim(), list: r.entries });
    } catch (e) {
      toast(t('errorX', { msg: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  };
  const importPicked = async (withFav: boolean) => {
    const books = picked.filter((e) => !e.dir && isBookName(e.name));
    if (!books.length) return;
    let fav: string | undefined;
    if (withFav) {
      const name = await askFavorite('');
      if (name === null) return;
      fav = name || undefined;
    }
    sel.clear();
    let n = 0;
    await runWithProgress(t('importing'), async (ctl) => {
      for (const [i, e] of books.entries()) {
        if (ctl.signal.aborted) break;
        ctl.update({ done: i, total: books.length, current: e.name });
        try {
          const file = await downloadServerFile(e.path, e.name, { signal: ctl.signal });
          await importFile({ file }, { onShelf: true, favorite: fav, source: { kind: 'server-library', url: e.path } });
          n++;
        } catch (err) {
          if (ctl.signal.aborted) break;
          toast(`${e.name}: ${(err as Error).message}`);
        }
      }
    });
    toast(t('importDone', { n }));
  };

  const selectActions = (
    <>
      <IconButton label={t('filesCopy')} onClick={() => doCopyMove('copy')}>
        <Copy size={20} />
      </IconButton>
      <IconButton label={t('filesMove')} onClick={() => doCopyMove('move')}>
        <Move size={20} />
      </IconButton>
      {picked.length === 1 && (
        <IconButton label={t('filesRename')} onClick={() => void doRename()}>
          <Pencil size={20} />
        </IconButton>
      )}
      <IconButton label={t('filesDelete')} onClick={() => void doDelete()}>
        <Trash2 size={20} />
      </IconButton>
      <IconButton
        label={t('more')}
        onClick={(ev) =>
          popupMenu(ev.clientX - 180, ev.clientY, [
            { label: t('filesDownload'), icon: <Download size={16} />, onSelect: () => void downloadToLocal(picked.filter((e) => !e.dir)).then(sel.clear) },
            { label: t('filesImportFav'), icon: <Heart size={16} />, onSelect: () => void importPicked(true) },
            { label: t('filesImport'), onSelect: () => void importPicked(false) },
            ...(picked.length === 1 && !picked[0].dir && isBookName(picked[0].name) ? [{ label: t('bookInfo'), onSelect: () => void bookInfoOf(picked[0]) }] : []),
            ...(picked.length === 1 && picked[0].archive ? [{ label: t('filesArchive'), onSelect: () => go(picked[0].path) }] : []),
            { label: t('selectAll'), onSelect: () => sel.setAll(shown.map((e) => e.path)) },
          ])
        }
      >
        <MoreVertical size={20} />
      </IconButton>
    </>
  );

  const sortLabels = [t('filesSortNameAsc'), t('filesSortNameDesc'), t('filesSortSizeAsc'), t('filesSortSizeDesc'), t('filesSortTimeAsc'), t('filesSortTimeDesc')];
  const overflow = (ev: React.MouseEvent) =>
    popupMenu(ev.clientX - 200, ev.clientY, [
      { label: t('filesNewFolder'), icon: <FolderPlus size={16} />, onSelect: () => void doMkdir(), disabled: inArchive },
      { label: t('filesUpload'), icon: <Upload size={16} />, onSelect: () => void doUpload(), disabled: inArchive },
      { label: t('filesGrid'), icon: st.useGrid ? <List size={16} /> : <Grid3x3 size={16} />, onSelect: () => filesSettings.set({ useGrid: !st.useGrid }) },
      {
        label: `${t('filesSortBy')}…`,
        onSelect: () =>
          void chooseDialog<number>(
            t('filesSortBy'),
            sortLabels.map((l, i) => ({ value: i, label: `${st.sortBy === i ? '✓ ' : ''}${l}` })),
          ).then((v) => v !== null && filesSettings.set({ sortBy: v })),
      },
      { label: t('showHidden'), onSelect: () => filesSettings.set({ showHidden: !st.showHidden }) },
      { label: isFav ? t('filesRemoveFav') : t('filesAddFav'), icon: <Star size={16} />, onSelect: () => (isFav ? removeFavFolder(path) : addFavFolder(path)) },
      { label: t('filesFavorites'), onSelect: openFavFolders },
      { label: t('selectAll'), onSelect: () => sel.setAll(shown.map((e) => e.path)) },
    ]);

  return (
    <>
      <TopBar
        title={results ? t('filesSearchResult', { n: results.list.length }) : crumbs[crumbs.length - 1].name}
        subtitle={results ? results.q : path ? crumbs.slice(0, -1).map((c) => c.name).join(' / ') : undefined}
        nav={path || results ? 'back' : 'menu'}
        onNav={path || results ? () => (results ? (setResults(null), setQ('')) : go(upFrom(path))) : undefined}
        search={{ scope: 'files', value: q, onChange: setQ, onSubmit: (k) => void doSearch(k), placeholder: t('filesSearch') }}
        selecting={sel.active ? { count: sel.ids.size, onCancel: sel.clear, actions: selectActions } : undefined}
        actions={
          <IconButton label={t('more')} onClick={overflow}>
            <MoreVertical size={21} />
          </IconButton>
        }
      />
      {!results && (
        <div className={f.crumbs}>
          {crumbs.map((c, i) => (
            <span key={c.path + i} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {i > 0 && <span className={s.dim}>›</span>}
              <button className={f.crumb} data-last={i === crumbs.length - 1 ? 'true' : undefined} onClick={() => go(c.path)}>
                {c.name}
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={s.content} style={{ paddingBottom: clip ? 64 : 0 }}>
        {loading && !entries ? (
          <Empty icon={<Spinner size={28} />} text={t('loading')} />
        ) : err ? (
          <Empty text={err} />
        ) : shown.length === 0 ? (
          <Empty icon={<Folder size={44} />} text={t('filesEmpty')} />
        ) : st.useGrid ? (
          <div className={f.grid}>
            {shown.map((e) => (
              <Item key={e.path} e={e} grid selected={sel.ids.has(e.path)} selecting={sel.active} onOpen={() => void openEntry(e)} onToggle={() => sel.toggle(e.path)} onLong={() => sel.add(e.path)} showPath={!!results} />
            ))}
          </div>
        ) : (
          shown.map((e) => <Item key={e.path} e={e} selected={sel.ids.has(e.path)} selecting={sel.active} onOpen={() => void openEntry(e)} onToggle={() => sel.toggle(e.path)} onLong={() => sel.add(e.path)} showPath={!!results} />)
        )}
      </div>
      {clip && (
        <div className={f.pasteBar}>
          <span style={{ flex: 1, fontSize: 13 }}>
            {clip.op === 'copy' ? t('filesCopy') : t('filesMove')} · {clip.paths.length}
          </span>
          <Button primary disabled={inArchive} onClick={doPaste}>
            <ClipboardPaste size={14} style={{ verticalAlign: -2 }} /> {t('filesPasteHere')}
          </Button>
          <Button onClick={() => void doMkdir()}>{t('filesNewFolder')}</Button>
          <Button
            onClick={() => {
              clipboard = undefined;
              setClip(undefined);
            }}
          >
            {t('cancel')}
          </Button>
        </div>
      )}
    </>
  );
}

function EntryIcon({ e, size = 32 }: { e: LibraryEntry; size?: number }) {
  const [broken, setBroken] = useState(false);
  const book = !e.dir && isBookName(e.name);
  const showThumb = book && !broken && ['epub', 'cbz', 'fb2', 'mobi', 'azw3', 'pdf'].includes(fileExt(e.name));
  if (showThumb) {
    return <img className={f.thumb} src={thumbUrl(e.path, 120)} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  const Icon = e.dir ? Folder : e.archive ? Archive : book ? BookOpen : isImageName(e.name) ? ImageIcon : fileExt(e.name) === 'txt' ? FileText : FileIcon;
  return <Icon size={size} color={e.dir ? '#e0a100' : 'var(--mr-muted)'} />;
}

function Item(props: { e: LibraryEntry; grid?: boolean; selected: boolean; selecting: boolean; onOpen: () => void; onToggle: () => void; onLong: () => void; showPath: boolean }) {
  const { e } = props;
  const lp = useLongPress({ onClick: (ev) => (props.selecting || ev.ctrlKey || ev.metaKey || ev.shiftKey ? props.onToggle() : props.onOpen()), onLong: props.onLong });
  if (props.grid) {
    return (
      <div className={f.gridItem} data-selected={props.selected ? 'true' : undefined} {...lp}>
        <div className={f.gridIcon}>
          <EntryIcon e={e} size={44} />
        </div>
        <div className={f.gridName}>{e.name}</div>
      </div>
    );
  }
  const parent = props.showPath ? e.path.split('?')[0].split('/').slice(0, -1).join('/') : '';
  return (
    <div className={s.item} data-selected={props.selected ? 'true' : undefined} style={{ alignItems: 'center', padding: '8px 14px' }} {...lp}>
      <div className={f.icon}>
        <EntryIcon e={e} />
      </div>
      <div className={s.itemBody} style={{ gap: 1 }}>
        <div className={s.itemTitle} style={{ WebkitLineClamp: 1, fontSize: 15 }}>
          {e.name}
        </div>
        <div className={s.itemMeta}>
          {parent && <span>{parent}</span>}
          {!e.dir && <span>{formatSize(e.size)}</span>}
          {e.mtime > 0 && <span>{formatDate(e.mtime)}</span>}
        </div>
      </div>
    </div>
  );
}

// ───────────── 打开 / 下载 ─────────────
async function openServerBook(e: LibraryEntry, asText = false): Promise<void> {
  const key = `${e.path}|${e.size}|${e.mtime}${asText ? '|txt' : ''}`;
  const map = (await getKV<Record<string, string>>(SERVER_MAP)) ?? {};
  const cached = map[key];
  if (cached && (await hasBookFile(cached))) return openBook(cached);
  try {
    const id = await runWithProgress(t('filesOpening'), async (ctl) => {
      const name = asText && fileExt(e.name) !== 'txt' ? `${e.name}.txt` : e.name;
      const file = await downloadServerFile(e.path, name, { signal: ctl.signal, onProgress: (done, total) => ctl.update({ done, total: total || e.size, current: e.name }) });
      // 未入库的书按 tmpbooks 语义记录（onShelf=false），最近阅读里仍然能看到
      const { book } = await importFile({ file }, { onShelf: false, source: { kind: 'server-library', url: e.path } });
      return book.id;
    });
    if (!id) return;
    await setKV(SERVER_MAP, { ...map, [key]: id });
    await openBook(id);
  } catch (err) {
    toast(t('errorX', { msg: (err as Error).message }));
  }
}

async function bookInfoOf(e: LibraryEntry): Promise<void> {
  try {
    const book = await runWithProgress(t('filesOpening'), async (ctl) => {
      const file = await downloadServerFile(e.path, e.name, { signal: ctl.signal, onProgress: (d, tt) => ctl.update({ done: d, total: tt || e.size, current: e.name }) });
      return (await importFile({ file }, { onShelf: false, source: { kind: 'server-library', url: e.path } })).book;
    });
    if (book) openBookInfo(book.id);
  } catch (err) {
    toast(t('errorX', { msg: (err as Error).message }));
  }
}

async function downloadToLocal(list: LibraryEntry[]): Promise<void> {
  for (const e of list) {
    try {
      const file = await runWithProgress(t('filesDownload'), (ctl) => downloadServerFile(e.path, e.name, { signal: ctl.signal, onProgress: (d, tt) => ctl.update({ done: d, total: tt || e.size, current: e.name }) }));
      if (file) triggerDownload(file, e.name);
    } catch (err) {
      toast(t('errorX', { msg: (err as Error).message }));
    }
  }
}

// ───────────── 看图器 ─────────────
function openImageViewer(images: LibraryEntry[], start: LibraryEntry): void {
  openOverlay((close) => <ImageViewer images={images} index={Math.max(0, images.findIndex((i) => i.path === start.path))} onClose={close} />);
}

function ImageViewer(props: { images: LibraryEntry[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(props.index);
  const cur = props.images[i];
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowRight') setI((x) => Math.min(props.images.length - 1, x + 1));
      if (ev.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.images.length]);
  return (
    <FullDialog title={`${cur.name}  (${i + 1}/${props.images.length})`} onClose={props.onClose} width={900}>
      <div className={f.viewer} onClick={(ev) => {
        const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        setI((x) => (ev.clientX - r.left < r.width / 2 ? Math.max(0, x - 1) : Math.min(props.images.length - 1, x + 1)));
      }}>
        <img src={fileUrl(cur.path)} alt={cur.name} />
      </div>
    </FullDialog>
  );
}

