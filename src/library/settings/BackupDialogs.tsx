// 备份 / 恢复 / 导入原版数据的界面（BAK-001/002/003）。逻辑在 storage/backup.ts、storage/legacy.ts。
import { useEffect, useState } from 'react';
import { Cloud, FileDown, HardDrive } from 'lucide-react';
import { Button, Segmented, chooseDialog, confirmDialog, openOverlay, toast } from '@/ui';
import { listBooks } from '@/storage/db';
import {
  backupFileName,
  createBackup,
  downloadCloudBackup,
  listCloudBackups,
  parseBackup,
  restoreBackup,
  uploadCloudBackup,
  type CloudBackup,
  type ParsedBackup,
} from '@/storage/backup';
import { applyLegacyFile, findLegacyBook, readLegacyFile } from '@/storage/legacy';
import { importMrpro } from '../mrpro-import';
import { loadSyncConfig } from '@/storage/sync';
import { pickFiles } from '../import-collect';
import { formatDate, formatDateTime, formatSize, safeFileName, triggerDownload } from '../format';
import { CheckBox, Field, FullDialog, ProgressLine, Spinner, TextField } from '../ui-kit';
import { t } from '../i18n';
import s from '../library.module.css';

const CLOUD_WARN_BYTES = 50 * 1024 * 1024;
const todayStem = () => backupFileName('zip').replace(/\.[^.]+$/, '');
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ───────────── 备份 ─────────────
export function openBackupDialog(): void {
  openOverlay((close) => <BackupDialog onClose={close} />);
}

function BackupDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(todayStem());
  const [target, setTarget] = useState<'local' | 'cloud'>('local');
  const [covers, setCovers] = useState(true);
  const [books, setBooks] = useState(false);
  const [json, setJson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cloudOn, setCloudOn] = useState(false);
  const [bookBytes, setBookBytes] = useState(0);

  useEffect(() => {
    void loadSyncConfig().then((c) => setCloudOn(!!c), () => setCloudOn(false));
    void listBooks().then((all) => setBookBytes(all.reduce((a, b) => a + (b.size || 0), 0)));
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      const format = json ? 'json' : 'zip';
      const blob = await createBackup({ covers: covers && !json, books: books && !json, format });
      const fname = `${safeFileName(name) || todayStem()}.${format === 'zip' ? 'mrweb' : 'json'}`;
      if (target === 'local') {
        triggerDownload(blob, fname);
        toast(t('backupDownloaded', { name: fname }));
      } else {
        if (blob.size > CLOUD_WARN_BYTES && !(await confirmDialog(t('backupLargeCloud', { size: formatSize(blob.size) })))) return;
        await uploadCloudBackup(blob, fname);
        toast(t('backupUploaded', { name: fname }));
      }
      onClose();
    } catch (e) {
      toast(`${t('backupFailed')}: ${errMsg(e)}`, 4000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FullDialog
      title={t('backup')}
      onClose={onClose}
      width={520}
      actions={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button primary disabled={busy || (target === 'cloud' && !cloudOn)} onClick={() => void run()}>
            {busy ? t('backupWorking') : t('ok')}
          </Button>
        </>
      }
    >
      <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('backupTo')}</div>
      <div className={s.pad}>
        <Segmented
          value={target}
          onChange={setTarget}
          options={[
            { value: 'local', label: <><HardDrive size={14} style={{ verticalAlign: -2 }} /> {t('backupLocal')}</> },
            { value: 'cloud', label: <><Cloud size={14} style={{ verticalAlign: -2 }} /> {t('backupCloud')}</> },
          ]}
        />
        {target === 'cloud' && !cloudOn && <div className={s.dim} style={{ fontSize: 12.5, marginTop: 6 }}>{t('backupNeedCloud')}</div>}
      </div>
      <Field label={t('backupFileName')} hint={json ? '.json' : '.mrweb'}>
        <TextField value={name} onChange={setName} />
      </Field>
      <CheckBox checked={json} onChange={setJson} label={t('backupJson')} />
      <CheckBox checked={covers && !json} disabled={json} onChange={setCovers} label={t('backupCovers')} />
      <CheckBox checked={books && !json} disabled={json} onChange={setBooks} label={t('backupBooks')} />
      {books && !json && <div className={`${s.pad} ${s.dim}`} style={{ paddingTop: 0, fontSize: 12.5 }}>{t('backupEstimate', { size: formatSize(bookBytes) })}</div>}
      <div className={`${s.pad} ${s.dim}`} style={{ fontSize: 12.5 }}>
        <div>{t('backupScope')}</div>
        <div>{t('backupSecrets')}</div>
      </div>
    </FullDialog>
  );
}

// ───────────── 恢复 ─────────────
export function openRestoreDialog(): void {
  openOverlay((close) => <RestoreDialog onClose={close} />);
}

function RestoreDialog({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<'local' | 'cloud'>('local');
  const [cloudList, setCloudList] = useState<CloudBackup[] | null>(null);
  const [cloudErr, setCloudErr] = useState('');
  const [picked, setPicked] = useState<{ name: string; parsed: ParsedBackup } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (source !== 'cloud' || cloudList) return;
    listCloudBackups().then(setCloudList, (e) => {
      setCloudErr(errMsg(e));
      setCloudList([]);
    });
  }, [source, cloudList]);

  const load = async (name: string, get: () => Promise<Blob>) => {
    setBusy(t('restoreReading'));
    try {
      setPicked({ name, parsed: await parseBackup(await get()) });
    } catch (e) {
      toast(t('restoreFailed', { msg: errMsg(e) }), 4000);
    } finally {
      setBusy('');
    }
  };

  const chooseLocal = async () => {
    const [it] = await pickFiles({ accept: ['mrweb', 'json', 'zip'], multiple: false });
    if (it) await load(it.file.name, async () => it.file);
  };

  const run = async () => {
    if (!picked) return;
    if (!(await confirmDialog(t('restoreConfirm', { name: picked.name })))) return;
    setBusy(t('restoreWorking'));
    try {
      if (mode === 'replace') {
        // 覆盖前先把当前数据存一份（BAK-002 的 Web 建议）
        const safety = await createBackup({ covers: true, books: false, format: 'zip' });
        triggerDownload(safety, `before-restore-${backupFileName('zip')}`);
        toast(t('safetyBackup'));
      }
      const rep = await restoreBackup(picked.parsed, mode);
      toast(`${t('restoreSucceeded')}（${t('restoreReport', { books: rep.books, positions: rep.positions, annotations: rep.annotations })}）`, 4500);
      onClose();
    } catch (e) {
      toast(t('restoreFailed', { msg: errMsg(e) }), 4500);
    } finally {
      setBusy('');
    }
  };

  const m = picked?.parsed.data.manifest;
  const d = picked?.parsed.data;
  return (
    <FullDialog
      title={t('restore')}
      onClose={onClose}
      width={520}
      actions={
        picked ? (
          <>
            <Button onClick={() => setPicked(null)}>{t('back')}</Button>
            <Button primary disabled={!!busy} onClick={() => void run()}>
              {busy || t('ok')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('cancel')}</Button>
        )
      }
    >
      {!picked ? (
        <>
          <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('restoreFrom')}</div>
          <div className={s.pad}>
            <Segmented
              value={source}
              onChange={setSource}
              options={[
                { value: 'local', label: t('restoreLocal') },
                { value: 'cloud', label: t('restoreCloud') },
              ]}
            />
          </div>
          {source === 'local' ? (
            <div className={s.btnRow}>
              <Button primary disabled={!!busy} onClick={() => void chooseLocal()}>
                <FileDown size={16} style={{ verticalAlign: -3 }} /> {t('restoreChooseLocal')}
              </Button>
            </div>
          ) : cloudList === null ? (
            <div className={s.pad}><Spinner /></div>
          ) : cloudList.length === 0 ? (
            <div className={`${s.pad} ${s.dim}`}>{cloudErr ? t('restoreFailed', { msg: cloudErr }) : t('noBackups')}</div>
          ) : (
            <>
              <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('restoreCloudList')}</div>
              {cloudList.map((b) => (
                <div key={b.name} className={s.groupRow} onClick={() => !busy && void load(b.name, () => downloadCloudBackup(b.name))}>
                  <div className={s.grow}>
                    <div style={{ wordBreak: 'break-all' }}>{b.name}</div>
                    <div className={s.dim} style={{ fontSize: 12 }}>{formatDate(b.mtime)} · {formatSize(b.size)}</div>
                  </div>
                </div>
              ))}
            </>
          )}
          {busy && <div className={s.pad}><Spinner size={16} /> {busy}</div>}
        </>
      ) : (
        <>
          <div className={s.pad}>
            <b style={{ wordBreak: 'break-all' }}>{picked.name}</b>
            {m && d && (
              <div className={s.dim} style={{ fontSize: 13, marginTop: 4 }}>
                {t('restoreInfo', { time: formatDateTime(m.createdAt), books: d.books.length, annotations: d.annotations.length, positions: d.positions.length })}
              </div>
            )}
            {m && !m.includes.books && <div style={{ fontSize: 13, marginTop: 6, color: '#e08a00' }}>{t('restoreNoFiles')}</div>}
          </div>
          <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('restoreMode')}</div>
          <div className={s.pad}>
            <Segmented value={mode} onChange={setMode} options={[{ value: 'merge', label: t('restoreMerge') }, { value: 'replace', label: t('restoreReplace') }]} />
            {mode === 'replace' && <div style={{ fontSize: 12.5, marginTop: 8, color: '#e53935' }}>{t('restoreReplaceWarn')}</div>}
          </div>
          {busy && <ProgressLine value={0.5} />}
        </>
      )}
    </FullDialog>
  );
}

// ───────────── 导入原版 Moon+ 的 .po / .an / .mrexpt ─────────────
/** 原版整库备份（.mrpro / .mrstd）：确认后导入书架、进度、标注、统计（BAK-002 的原版互通部分） */
async function importMoonBackup(file: File): Promise<void> {
  if (!(await confirmDialog(t('mrproConfirm', { name: file.name })))) return;
  const close = openOverlay(() => (
    <FullDialog title={t('mrproReading')} onClose={() => undefined}>
      <div className={s.pad}><Spinner size={18} /> {file.name}</div>
    </FullDialog>
  ));
  try {
    const r = await importMrpro(file);
    toast(t('mrproDone', { name: file.name, books: r.books, positions: r.positions, annotations: r.annotations, stats: r.stats, pending: r.pending ? t('mrproPending', { n: r.pending }) : '' }), 7000);
  } catch (e) {
    toast(t('mrproFailed', { msg: errMsg(e) }), 5000);
  } finally {
    close();
  }
}

export async function runLegacyImport(): Promise<void> {
  const items = await pickFiles({ accept: ['mrpro', 'mrstd', 'an', 'mrexpt', 'po', 'txt'] });
  if (!items.length) return;
  let done = 0;
  let skipped = 0;
  const lines: string[] = [];
  for (const it of items) {
    if (/\.(mrpro|mrstd)$/i.test(it.file.name)) {
      await importMoonBackup(it.file);
      done++;
      continue;
    }
    const lf = readLegacyFile(it.file.name, new Uint8Array(await it.file.arrayBuffer()));
    if (!lf) {
      skipped++;
      continue;
    }
    let book = await findLegacyBook(lf.hints, lf.kind === 'an' ? lf.fileSize : undefined);
    if (!book) {
      const all = (await listBooks()).filter((b) => b.onShelf !== false);
      const id = await chooseDialog<string>(
        `${t('pickBookForNotes')} (${it.file.name})`,
        all.map((b) => ({ value: b.id, label: b.title, subtitle: b.authors.join(' & ') })),
      );
      book = all.find((b) => b.id === id);
    }
    if (!book) {
      skipped++;
      continue;
    }
    const r = await applyLegacyFile(lf, book);
    if (r.kind === 'po') {
      if (!r.ok) {
        skipped++;
        continue;
      }
      lines.push(t('legacyProgressOk', { name: book.title }));
    } else if (r.rejected) {
      lines.push(`${book.title}: ${t('importNotesNotSame')}`);
      skipped++;
      continue;
    } else lines.push(t('legacyNotesOk', { name: book.title, a: r.added, u: r.updated, d: r.removed }));
    done++;
  }
  if (items.every((it) => /\.(mrpro|mrstd)$/i.test(it.file.name))) return; // 整库备份已各自给过汇总
  const skip = skipped ? t('legacySkip', { n: skipped }) : '';
  toast([t('legacyDone', { n: done, skip }), ...lines.slice(0, 3)].join('\n'), 4500);
}
