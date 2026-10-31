// 导入相关的界面：导入对话框、扫描结果选择列表、进度框、新书列表（LIB-021/022/023）。
import { useMemo, useState, useSyncExternalStore } from 'react';
import { FileUp, FolderOpen } from 'lucide-react';
import { Button, Sheet, confirmDialog, openOverlay, toast } from '@/ui';
import type { BookRecord } from '@/core/library';
import { goRead } from './actions';
import { CheckBox, Field, FullDialog, ProgressLine, TextField } from './ui-kit';
import { itemsFromDrop, pickFiles } from './import-collect';
import { asTextItem, importFiles, markImported, passesScanFilter, extOf, type ImportItem, type ImportOptions, type ImportResult, type ScanEntry } from './import';
import { shelfSettings, DEFAULT_FAV } from './settings';
import { TYPE_GROUPS } from './shelf-model';
import { formatDate, formatSize } from './format';
import { present } from './dialogs';
import { supportedExtensions } from '@/formats';
import { t } from './i18n';
import s from './library.module.css';

// ───────────── 进度框 ─────────────
interface Prog {
  title: string;
  done: number;
  total: number;
  current: string;
  abort: AbortController;
}

function createProgressStore(init: Prog) {
  let state = init;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set: (p: Partial<Prog>) => {
      state = { ...state, ...p };
      subs.forEach((f) => f());
    },
    sub: (f: () => void) => {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

function ProgressDialog({ store }: { store: ReturnType<typeof createProgressStore> }) {
  const p = useSyncExternalStore(store.sub, store.get);
  return (
    <Sheet open position="center" title={p.title} onClose={() => p.abort.abort()} actions={<Button onClick={() => p.abort.abort()}>{t('cancel')}</Button>}>
      <div className={s.pad}>
        <div style={{ fontSize: 13, wordBreak: 'break-all', minHeight: 20 }}>{p.current}</div>
        <div style={{ height: 8 }} />
        <ProgressLine value={p.total ? p.done / p.total : 0} />
        <div className={s.dim} style={{ fontSize: 12, marginTop: 6 }}>
          {p.done}/{p.total}
        </div>
      </div>
    </Sheet>
  );
}

/** 通用的带进度、可取消的长任务（文件页下载等）。被取消返回 undefined */
export async function runWithProgress<T>(
  title: string,
  fn: (ctl: { signal: AbortSignal; update: (p: { done: number; total: number; current?: string }) => void }) => Promise<T>,
): Promise<T | undefined> {
  const abort = new AbortController();
  const store = createProgressStore({ title, done: 0, total: 0, current: '', abort });
  let close: () => void = () => undefined;
  const timer = setTimeout(() => {
    close = openOverlay(() => <ProgressDialog store={store} />);
  }, 250);
  try {
    return await fn({ signal: abort.signal, update: (p) => store.set({ done: p.done, total: p.total, ...(p.current !== undefined ? { current: p.current } : {}) }) });
  } catch (e) {
    if (abort.signal.aborted) return undefined;
    throw e;
  } finally {
    clearTimeout(timer);
    close();
  }
}

/** 导入并给出进度、取消、结果提示；有新书时弹新书列表（showNewBooks: false = 调用方随后直接打开书，不弹） */
export async function importWithUi(items: ImportItem[], opts: ImportOptions & { showNewBooks?: boolean } = {}): Promise<ImportResult> {
  if (!items.length) return { added: [], existing: [], failed: [] };
  void navigator.storage?.persist?.();
  const abort = new AbortController();
  const store = createProgressStore({ title: t('importing'), done: 0, total: items.length, current: '', abort });
  let close: () => void = () => undefined;
  // 少量文件很快就好，延迟 300ms 再弹进度框避免一闪而过
  const timer = setTimeout(() => {
    close = openOverlay(() => <ProgressDialog store={store} />);
  }, 300);
  let res: ImportResult;
  try {
    res = await importFiles(items, {
      ...opts,
      signal: abort.signal,
      onProgress: (p) => {
        store.set({ done: p.done, total: p.total, current: p.current });
        opts.onProgress?.(p);
      },
    });
  } finally {
    clearTimeout(timer);
    close();
  }
  summarize(res, abort.signal.aborted, opts.showNewBooks !== false);
  // 类型不受支持的文件：问一句是否以纯文本模式打开（LIB-035，原「该文件类型不受支持，是否以纯文本模式打开？」）
  const unsupported = items.filter((it) => res.failed.some((f) => f.unsupported && f.name === it.file.name));
  if (unsupported.length && !abort.signal.aborted && (await confirmDialog(t('importAsTextAsk', { n: unsupported.length }), { okText: t('importAsText') }))) {
    const again = await importFiles(unsupported.map(asTextItem), opts);
    const one = unsupported.length === 1 ? (again.added[0] ?? again.existing[0]) : undefined;
    summarize(again, false, !one); // 只有一本就直接打开它，不再弹「新导入的书」
    if (one) goRead(one.id);
    return { added: [...res.added, ...again.added], existing: [...res.existing, ...again.existing], failed: [...res.failed.filter((f) => !f.unsupported), ...again.failed] };
  }
  return res;
}

function summarize(res: ImportResult, aborted: boolean, showNewBooks = true): void {
  if (aborted) toast(t('importCancelled'));
  const parts: string[] = [];
  if (res.added.length) parts.push(t('importDone', { n: res.added.length }));
  else if (!res.failed.length && !res.existing.length) parts.push(t('importZero'));
  if (res.existing.length) parts.push(t('importExisting', { n: res.existing.length }));
  if (res.failed.length) parts.push(t('importFailedN', { n: res.failed.length }));
  if (parts.length) toast(parts.join('；'), 3500);
  if (showNewBooks && res.added.length > 0) openOverlay((close) => <NewBooksDialog books={res.added} onClose={close} />);
}

// ───────────── 新书列表 ─────────────
function NewBooksDialog(props: { books: BookRecord[]; onClose: () => void }) {
  return (
    <FullDialog title={t('newBooksTitle', { n: props.books.length })} onClose={props.onClose}>
      {props.books.map((b) => (
        <div
          key={b.id}
          className={s.groupRow}
          onClick={() => {
            props.onClose();
            goRead(b.id);
          }}
        >
          <div className={s.grow}>
            {b.title}
            {b.authors.length > 0 && <span className={s.dim}> — {b.authors.join(' & ')}</span>}
          </div>
          <span className={s.cnt}>{b.format.toUpperCase()}</span>
        </div>
      ))}
    </FullDialog>
  );
}

// ───────────── 导入前的选择列表（LIB-022） ─────────────
type SortMode = 'time' | 'path' | 'name';

function groupKey(e: ScanEntry, mode: SortMode): string {
  if (mode === 'path') return e.dir ?? '/';
  if (mode === 'name') {
    const c = e.file.name.trim()[0] ?? '#';
    return /[a-z]/i.test(c) ? c.toUpperCase() : /\d/.test(c) ? '#' : c;
  }
  const age = Date.now() - e.file.lastModified;
  const DAY = 86_400_000;
  return age < DAY ? t('today') : age < 7 * DAY ? t('thisWeek') : age < 31 * DAY ? t('thisMonth') : t('allTime');
}

function ImportSelect(props: { entries: ScanEntry[]; onDone: (picked: ScanEntry[] | null) => void }) {
  const [mode, setMode] = useState<SortMode>('time');
  const [picked, setPicked] = useState<Set<number>>(() => new Set(props.entries.map((e, i) => (e.imported || e.broken ? -1 : i)).filter((i) => i >= 0)));
  const sorted = useMemo(() => {
    const idx = props.entries.map((e, i) => ({ e, i }));
    idx.sort((a, b) =>
      mode === 'time' ? b.e.file.lastModified - a.e.file.lastModified : mode === 'path' ? (a.e.dir ?? '').localeCompare(b.e.dir ?? '') || a.e.file.name.localeCompare(b.e.file.name) : a.e.file.name.localeCompare(b.e.file.name, ['zh', 'en']),
    );
    const groups: { key: string; items: typeof idx }[] = [];
    for (const it of idx) {
      const k = groupKey(it.e, mode);
      const last = groups[groups.length - 1];
      if (last?.key === k) last.items.push(it);
      else groups.push({ key: k, items: [it] });
    }
    return groups;
  }, [props.entries, mode]);
  const selectable = props.entries.map((e, i) => (e.broken ? -1 : i)).filter((i) => i >= 0);
  const allOn = selectable.length > 0 && selectable.every((i) => picked.has(i));
  return (
    <FullDialog
      title={t('importSelectTitle')}
      onClose={() => props.onDone(null)}
      right={<Button onClick={() => setPicked(allOn ? new Set() : new Set(selectable))}>{allOn ? t('selectNone') : t('selectAll')}</Button>}
      actions={
        <>
          <Button onClick={() => props.onDone(null)}>{t('cancel')}</Button>
          <Button primary disabled={picked.size === 0} onClick={() => props.onDone([...picked].map((i) => props.entries[i]))}>
            {t('importN', { n: picked.size })}
          </Button>
        </>
      }
    >
      <div className={s.pad} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['time', 'path', 'name'] as const).map((m) => (
          <Button key={m} primary={mode === m} onClick={() => setMode(m)}>
            {m === 'time' ? t('byTime') : m === 'path' ? t('byPath') : t('byName')}
          </Button>
        ))}
      </div>
      {sorted.map((g) => (
        <div key={g.key}>
          <div className={s.groupTitleBar}>{g.key}</div>
          {g.items.map(({ e, i }) => (
            <label key={i} className={s.check} style={{ alignItems: 'flex-start', borderBottom: '1px solid var(--mr-border)' }}>
              <input
                type="checkbox"
                checked={picked.has(i)}
                disabled={e.broken}
                onChange={(ev) =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (ev.target.checked) n.add(i);
                    else n.delete(i);
                    return n;
                  })
                }
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ wordBreak: 'break-all' }}>{e.file.name}</span>
                {e.imported && <span className={s.dim}> ({t('imported')})</span>}
                {e.broken && <span className={s.dim}> ({t('unsupported')})</span>}
                <span className={s.dim} style={{ display: 'block', fontSize: 12 }}>
                  {formatDate(e.file.lastModified)} · {formatSize(e.file.size)}
                  {e.dir ? ` · ${e.dir}` : ''}
                </span>
              </span>
            </label>
          ))}
        </div>
      ))}
    </FullDialog>
  );
}

/** 过滤、标「已导入」、弹出选择列表，返回用户勾选的文件 */
export async function chooseFromScan(items: ImportItem[]): Promise<ImportItem[] | null> {
  const st = shelfSettings.get();
  const exts = new Set(supportedExtensions());
  const filtered: ScanEntry[] = items
    .filter((it) => passesScanFilter(it.file, { types: st.importTypes, minSizeKB: st.importFileSize }))
    .map((it) => ({ ...it, broken: exts.size > 0 && !exts.has(extOf(it.file.name)) }));
  if (!filtered.length) {
    toast(t('importZero'));
    return null;
  }
  await markImported(filtered);
  return present<ScanEntry[]>((done) => <ImportSelect entries={filtered} onDone={done} />);
}

/** 拖放进来的内容：含目录 → 先过滤再选择；纯文件 → 直接导入 */
export async function importDropped(dt: DataTransfer): Promise<void> {
  const items = await itemsFromDrop(dt);
  if (!items.length) return;
  const hasDir = items.some((i) => i.dir);
  const st = shelfSettings.get();
  if (hasDir) {
    const picked = await chooseFromScan(items);
    if (picked?.length) await importWithUi(picked, { favorite: st.scanFav || undefined });
  } else {
    await importWithUi(items, { favorite: st.scanFav || undefined });
  }
}

// ───────────── 导入对话框（LIB-021） ─────────────
export function openImportDialog(): void {
  openOverlay((close) => <ImportDialog onClose={close} />);
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const st = shelfSettings.use((x) => x);
  const [more, setMore] = useState(false);
  const exts = supportedExtensions();
  const favOn = st.scanFav !== '';
  const fav = st.scanFav || undefined;
  const toggle = (key: string, on: boolean) => {
    const n = new Set(st.importTypes);
    if (on) n.add(key);
    else n.delete(key);
    shelfSettings.set({ importTypes: [...n] });
  };
  return (
    <FullDialog title={t('importTitle')} onClose={onClose} width={560}>
      <div className={s.empty} style={{ paddingBottom: 8 }}>
        <FileUp size={40} />
        <div>{t('emptyShelfHint')}</div>
      </div>
      <div className={s.btnRow} style={{ justifyContent: 'center' }}>
        <Button
          primary
          onClick={async () => {
            const items = await pickFiles({ accept: exts });
            onClose();
            if (items.length) await importWithUi(items, { favorite: fav });
          }}
        >
          <FileUp size={16} style={{ verticalAlign: -3 }} /> {t('importFiles')}
        </Button>
        <Button
          onClick={async () => {
            const items = await pickFiles({ directory: true });
            onClose();
            if (!items.length) return;
            const picked = await chooseFromScan(items);
            if (picked?.length) await importWithUi(picked, { favorite: fav });
          }}
        >
          <FolderOpen size={16} style={{ verticalAlign: -3 }} /> {t('importFolder')}
        </Button>
      </div>
      <div className={s.sep} />
      <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('importTypes')}</div>
      {Object.entries(TYPE_GROUPS).map(([key, g]) => (
        <CheckBox key={key} checked={st.importTypes.includes(key)} onChange={(x) => toggle(key, x)} label={g.label} />
      ))}
      <Field label={`${t('importMinSize')} (KB)`}>
        <TextField value={String(st.importFileSize)} onChange={(v) => shelfSettings.set({ importFileSize: Math.max(0, parseInt(v, 10) || 0) })} inputMode="numeric" />
      </Field>
      <div className={s.btnRow}>
        <Button onClick={() => setMore(!more)}>{t('importMore')}</Button>
      </div>
      {more && (
        <>
          <CheckBox checked={favOn} onChange={(on) => shelfSettings.set({ scanFav: on ? DEFAULT_FAV : '' })} label={t('favorite')} />
          {favOn && (
            <Field label={t('favoriteHint')}>
              <TextField value={st.scanFav === DEFAULT_FAV ? '' : st.scanFav} onChange={(v) => shelfSettings.set({ scanFav: v.trim() || DEFAULT_FAV })} />
            </Field>
          )}
        </>
      )}
    </FullDialog>
  );
}
