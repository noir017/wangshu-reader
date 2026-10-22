// 设置选项（LIB-031/033/034）：我的书架 / 我的文件 / 应用 / 服务端 / 云同步 / Readwise / 备份恢复 / 存储。
// 原 app 是一个全屏对话框，Web 版做成一页（路由 #/settings[/分区]），分区之间用标题隔开。
import { useEffect, useRef, useState } from 'react';
import { Archive, Download, Folder, FolderPlus, ImagePlus, KeyRound, Library, Trash2, Upload, X } from 'lucide-react';
import { Button, GroupTitle, PrefSelect, PrefSlider, PrefSwitch, Row, Segmented, Select, Sheet, Switch, confirmDialog, openOverlay, toast } from '@/ui';
import { appSettings, type Lang } from '@/core/app-settings';
import { nativeHost, setServerMode, type ServerMode } from '@/core/host';
import { checkServer, hasServer } from '@/core/server';
import { screenSettings } from '@/reader/settings';
import { setKV } from '@/storage/db';
import { serverFetch } from '@/storage/http';
import { emptyShelf } from '../actions';
import { formatSize } from '../format';
import { openImportDialog } from '../ImportDialogs';
import { clearLockPassword, setLockPassword } from '../lock';
import { addLinkedDir, autoImportNow, dirPermission, listLinkedDirs, removeLinkedDir, supportsLinkedDirs, type LinkedDir } from '../linked-dirs';
import { filesSettings, shelfSettings } from '../settings';
import { TopBar } from '../TopBar';
import { Field, TextField } from '../ui-kit';
import { t } from '../i18n';
import { openBackupDialog, openRestoreDialog, runLegacyImport } from './BackupDialogs';
import { ReadwiseSection, SyncSection } from './SyncSection';
import s from '../library.module.css';

export function SettingsPage({ section }: { section?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!section) return;
    rootRef.current?.querySelector(`[data-section="${section}"]`)?.scrollIntoView({ block: 'start' });
  }, [section]);
  return (
    <>
      <TopBar title={t('optionsTitle')} />
      <div className={s.content} ref={rootRef}>
       <div className={s.settingsBody}>
        <div data-section="shelf"><ShelfSection /></div>
        <div data-section="files"><FilesSection /></div>
        <div data-section="app"><AppSection /></div>
        <div data-section="server"><ServerSection /></div>
        <div data-section="sync"><SyncSection /></div>
        <div data-section="readwise"><ReadwiseSection /></div>
        <div data-section="backup"><BackupSection /></div>
        <div data-section="storage"><StorageSection /></div>
        <div style={{ height: 80 }} />
       </div>
      </div>
    </>
  );
}

// ───────────── 我的书架 ─────────────
const WOOD_OPTIONS = () => [0, 1, 2, 3, 4].map((i) => ({ value: i, label: t('woodyStyle', { n: i + 1 }) })).concat([{ value: 5, label: t('woodyCustom') }]);

async function chooseWoodImage(night: boolean): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void setKV(`library.wood.${night ? 'night' : 'day'}`, f).then(() => toast(t('toastDone')));
  };
  input.click();
}

function ShelfSection() {
  const woody = shelfSettings.use((x) => x.woody);
  const dayRes = shelfSettings.use((x) => x.woodyResDay);
  const nightRes = shelfSettings.use((x) => x.woodyResNight);
  return (
    <>
      <GroupTitle>{t('secShelf')}</GroupTitle>
      <PrefSwitch slice={shelfSettings} k="woody" icon={<Library size={18} />} title={t('woody')} />
      {woody && (
        <>
          <PrefSelect slice={shelfSettings} k="woodyResDay" title={t('woodyDay')} options={WOOD_OPTIONS()} />
          {dayRes === 5 && <Row title={t('woodyCustom')} icon={<ImagePlus size={18} />} onClick={() => void chooseWoodImage(false)} />}
          <PrefSelect slice={shelfSettings} k="woodyResNight" title={t('woodyNight')} options={WOOD_OPTIONS()} />
          {nightRes === 5 && <Row title={t('woodyCustom')} icon={<ImagePlus size={18} />} onClick={() => void chooseWoodImage(true)} />}
        </>
      )}
      <PrefSwitch slice={shelfSettings} k="coverWithProgress" title={t('coverProgress')} />
      <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('coverSizes')}</div>
      <PrefSlider slice={shelfSettings} k="shelfCoverSize" title={t('shelfCoverSize')} min={30} max={300} />
      <PrefSlider slice={shelfSettings} k="recentCoverSize" title={t('recentCoverSize')} min={30} max={300} />
      <PrefSlider slice={shelfSettings} k="fileCoverSize" title={t('fileCoverSize')} min={30} max={300} />
      <PrefSlider slice={shelfSettings} k="netCoverSize" title={t('netCoverSize')} min={30} max={300} />
      <PrefSlider slice={shelfSettings} k="shelfFontSize" title={t('fontSize')} min={10} max={30} />
      <PrefSwitch slice={shelfSettings} k="shelfBoldFont" title={t('boldFont')} />
      <Row title={t('importBooks')} icon={<Upload size={18} />} onClick={openImportDialog} />
      {supportsLinkedDirs() && <LinkedDirsRows />}
      <Row
        title={t('emptyShelfBtn')}
        icon={<Trash2 size={18} />}
        onClick={async () => {
          if (!(await confirmDialog(t('emptyShelfConfirm')))) return;
          await emptyShelf();
          toast(t('toastDone'));
        }}
      />
    </>
  );
}

/** 自动导入（LIB-024）：已链接目录列表 + 开关。目录权限只能在点击里重新申请 */
function LinkedDirsRows() {
  const [dirs, setDirs] = useState<(LinkedDir & { perm: PermissionState })[]>([]);
  const refresh = async () => setDirs(await Promise.all((await listLinkedDirs()).map(async (d) => Object.assign(d, { perm: await dirPermission(d) }))));
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <>
      <PrefSwitch slice={shelfSettings} k="autoImport" title={t('autoImport')} subtitle={t('autoImportNote')} />
      <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('linkedDirs')}</div>
      {dirs.map((d) => (
        <Row
          key={d.id}
          icon={<Folder size={18} />}
          title={d.name}
          subtitle={d.perm === 'granted' ? t('linkedDirOk') : t('linkedDirNeedAuth')}
          right={
            <span style={{ display: 'flex', gap: 4 }}>
              {d.perm !== 'granted' && (
                <Button onClick={async () => { await dirPermission(d, true); await refresh(); }}>{t('linkedDirAuth')}</Button>
              )}
              <button className={s.moreBtn} aria-label={t('delete')} onClick={async () => { await removeLinkedDir(d.id); await refresh(); }}>
                <X size={16} />
              </button>
            </span>
          }
        />
      ))}
      <Row title={t('linkedDirAdd')} icon={<FolderPlus size={18} />} onClick={async () => { await addLinkedDir(); await refresh(); }} />
      {dirs.length > 0 && (
        <Row
          title={t('autoImportNow')}
          onClick={async () => {
            const n = await autoImportNow(true);
            if (!n) toast(t('autoImportNone'));
          }}
        />
      )}
    </>
  );
}

// ───────────── 我的文件 ─────────────
function FilesSection() {
  return (
    <>
      <GroupTitle>{t('secFiles')}</GroupTitle>
      <PrefSwitch slice={filesSettings} k="showHidden" icon={<Folder size={18} />} title={t('showHidden')} />
      <PrefSwitch slice={filesSettings} k="showDavInFavorites" title={t('showDav')} />
    </>
  );
}

// ───────────── 应用 ─────────────
function AppSection() {
  const hideFab = shelfSettings.use((x) => x.hideFab);
  const openLast = screenSettings.use((x) => x.openLastFile);
  const lockOn = shelfSettings.use((x) => x.lockEnabled);
  const lang = appSettings.use((x) => x.language);
  return (
    <>
      <GroupTitle>{t('secApp')}</GroupTitle>
      <PrefSwitch slice={shelfSettings} k="simpleRecentList" title={t('simpleRecent')} />
      <PrefSwitch slice={shelfSettings} k="sysDarkModeFollow" title={t('followSysDark')} />
      <Row title={t('showFab')} onClick={() => shelfSettings.set({ hideFab: !hideFab })} right={<Switch checked={!hideFab} onChange={(v) => shelfSettings.set({ hideFab: !v })} />} />
      <Row title={t('openLastFile')} onClick={() => screenSettings.set({ openLastFile: !openLast })} right={<Switch checked={openLast} onChange={(v) => screenSettings.set({ openLastFile: v })} />} />
      <Row
        icon={<KeyRound size={18} />}
        title={t('password')}
        subtitle={lockOn ? t('passwordState') : t('passwordHint')}
        onClick={() => openOverlay((close) => <LockDialog enabled={lockOn} onClose={close} />)}
      />
      <Row
        title={t('language')}
        right={
          <Select<Lang>
            value={lang}
            onChange={(v) => appSettings.set({ language: v })}
            options={[
              { value: 'zh', label: t('langZh') },
              { value: 'en', label: t('langEn') },
            ]}
          />
        }
      />
    </>
  );
}

function LockDialog({ enabled, onClose }: { enabled: boolean; onClose: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const submit = () => {
    if (!a) return;
    if (a !== b) {
      toast(t('passwordNotPair'));
      setB('');
      return;
    }
    setLockPassword(a);
    toast(t('passwordOk'));
    onClose();
  };
  return (
    <Sheet
      open
      position="center"
      title={enabled ? t('passwordChange') : t('password')}
      onClose={onClose}
      actions={
        <>
          {enabled && (
            <Button
              onClick={() => {
                clearLockPassword();
                onClose();
              }}
            >
              {t('passwordOff')}
            </Button>
          )}
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button primary onClick={submit}>{t('ok')}</Button>
        </>
      }
    >
      <Field label={t('password1')}>
        <TextField value={a} onChange={setA} type="password" autoFocus />
      </Field>
      <Field label={t('password2')} hint={t('passwordHint')}>
        <TextField value={b} onChange={setB} type="password" onEnter={submit} />
      </Field>
    </Sheet>
  );
}

// ───────────── 服务端 ─────────────
function ServerSection() {
  const [url, setUrl] = useState(() => appSettings.get().serverUrl);
  const [token, setToken] = useState(() => appSettings.get().serverToken);
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'fail' | 'auth'>('idle');
  const local = nativeHost?.mode === 'local';
  const check = async () => {
    if (!local) appSettings.set({ serverUrl: url.trim().replace(/\/+$/, ''), serverToken: token.trim() });
    if (!hasServer()) {
      setState('fail');
      return;
    }
    setState('checking');
    if (!(await checkServer(true))) return setState('fail');
    // /api/health 不要求令牌，连得上不代表令牌对：再请求一个需要鉴权的接口
    const probe = await serverFetch('/api/translate/providers').catch(() => undefined);
    setState(probe?.status === 401 ? 'auth' : 'ok');
  };
  return (
    <>
      <GroupTitle>{t('secServer')}</GroupTitle>
      {nativeHost && (
        <Field label={t('serverMode')}>
          <Segmented<ServerMode>
            value={nativeHost.mode}
            onChange={(m) => m !== nativeHost?.mode && setServerMode(m)}
            options={[
              { value: 'local', label: t('serverModeLocal') },
              { value: 'remote', label: t('serverModeRemote') },
            ]}
          />
        </Field>
      )}
      {local ? (
        <div className={`${s.pad} ${s.dim}`} style={{ fontSize: 13 }}>
          {nativeHost?.local?.ok ? t('serverLocalOk') : t('serverLocalFail', { why: nativeHost?.local?.error ?? '' })}
        </div>
      ) : (
        <>
          {!hasServer() && <div className={`${s.pad} ${s.dim}`} style={{ fontSize: 13 }}>{t('serverNone')}</div>}
          <Field label={t('serverUrl')}>
            <TextField value={url} onChange={setUrl} inputMode="url" placeholder="http://192.168.1.2:8787" />
          </Field>
          <Field label={t('serverToken')}>
            <TextField value={token} onChange={setToken} type="password" />
          </Field>
        </>
      )}
      <div className={s.btnRow} style={{ alignItems: 'center' }}>
        <Button primary onClick={() => void check()}>{t('serverCheck')}</Button>
        {state === 'ok' && <span style={{ color: '#2e7d32' }}>{t('serverOk')}</span>}
        {state === 'fail' && <span style={{ color: '#e53935' }}>{t('serverFail')}</span>}
        {state === 'auth' && <span style={{ color: '#e53935' }}>{t('serverBadToken')}</span>}
      </div>
    </>
  );
}

// ───────────── 备份 / 恢复 ─────────────
function BackupSection() {
  return (
    <>
      <GroupTitle>{t('secBackup')}</GroupTitle>
      <Row title={t('backup')} subtitle={t('backupScope')} icon={<Download size={18} />} onClick={openBackupDialog} />
      <Row title={t('restore')} icon={<Archive size={18} />} onClick={openRestoreDialog} />
      <Row title={t('importLegacy')} subtitle={t('importLegacyHint')} icon={<Upload size={18} />} onClick={() => void runLegacyImport()} />
    </>
  );
}

// ───────────── 存储 ─────────────
function StorageSection() {
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }));
    void navigator.storage?.persisted?.().then(setPersisted);
  }, []);
  return (
    <>
      <GroupTitle>{t('secStorage')}</GroupTitle>
      <Row
        title={t('storageUsage')}
        subtitle={usage ? `${formatSize(usage.used)} · ${t('storageQuota', { quota: formatSize(usage.quota) })}` : '…'}
      />
      <Row
        title={persisted ? t('persisted') : t('persist')}
        disabled={persisted === true || !navigator.storage?.persist}
        onClick={async () => {
          const ok = (await navigator.storage?.persist?.()) ?? false;
          setPersisted(ok);
          if (!ok) toast(t('persistDenied'), 4000);
        }}
        right={<Switch checked={!!persisted} onChange={() => undefined} disabled />}
      />
    </>
  );
}
