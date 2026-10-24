// 设置页里的「云同步（WebDAV）」与「Readwise」分区（SYNC-001/012）。
import { useEffect, useState } from 'react';
import { Cloud } from 'lucide-react';
import { Button, GroupTitle, PrefSwitch, Row, Segmented, Switch, toast } from '@/ui';
import { hasServer } from '@/core/server';
import { getAccountSecret, setAccountSecret } from '@/storage/accounts';
import { getHistory } from '@/storage/db';
import { sendTestHighlight } from '@/storage/readwise';
import { pushAll } from '@/storage/sync';
import { createDavTransport, DavClient, davAvailable, normPath, type DavConfig } from '@/storage/webdav';
import { preOpenSync } from '../sync-service';
import { Field, TextField } from '../ui-kit';
import { readwiseSettings, syncSettings, type SyncMode } from '../settings';
import { t } from '../i18n';
import s from '../library.module.css';

async function verifyDav(cfg: DavConfig): Promise<void> {
  if (!davAvailable(cfg)) throw new Error(t('syncNeedServer'));
  await new DavClient(createDavTransport(cfg)).verify();
}

/** 登录/改路径后立即对最近读的书下载一次云端进度（原 app：勾选同步成功后立即下载进度） */
async function pullLatest(): Promise<void> {
  const last = (await getHistory())[0]?.bookId;
  if (last) await preOpenSync(last);
}

export function SyncSection() {
  const st = syncSettings.use((x) => x);
  const serverOk = hasServer();
  const [mode, setMode] = useState<SyncMode>(st.mode);
  const [url, setUrl] = useState(st.url);
  const [user, setUser] = useState(st.user);
  const [pass, setPass] = useState('');
  const [path, setPath] = useState(st.bookPath);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    void getAccountSecret('webdav').then((v) => setPass(v ?? ''));
  }, []);

  const draft = (): DavConfig => ({ mode, url: url.trim(), user: user.trim(), password: pass });

  const login = async () => {
    setBusy(t('syncVerifying'));
    try {
      const cfg = draft();
      await verifyDav(cfg);
      await setAccountSecret('webdav', cfg.password);
      syncSettings.set({ enabled: true, mode: cfg.mode, url: cfg.url, user: cfg.user, bookPath: normPath(path || '/Apps/Books') });
      toast(t('syncLoginOk'));
      void pullLatest();
    } catch (e) {
      toast(`${t('syncLoginFail')}: ${(e as Error).message}`, 4000);
      syncSettings.set({ enabled: false });
    } finally {
      setBusy('');
    }
  };

  const logout = async () => {
    syncSettings.set({ enabled: false, user: '' });
    await setAccountSecret('webdav', '');
    setUser('');
    setPass('');
    toast(t('syncLoggedOut'));
  };

  const commitPath = () => {
    const next = normPath(path || '/Apps/Books');
    setPath(next);
    if (next !== st.bookPath) {
      syncSettings.set({ bookPath: next });
      if (st.enabled) void pullLatest();
    }
  };

  const pushEverything = async () => {
    try {
      setBusy(t('working'));
      const n = await pushAll((done, total) => setBusy(t('syncPushing', { done, total })));
      toast(t('syncDone', { n }));
    } catch (e) {
      toast(t('syncFailed', { msg: (e as Error).message }), 4000);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <GroupTitle>{t('secSync')}</GroupTitle>
      {!serverOk && <div className={`${s.pad} ${s.dim}`} style={{ fontSize: 13 }}>{t('syncNeedServer')}</div>}
      <Row
        icon={<Cloud size={18} />}
        title={t('syncEnable')}
        subtitle={st.enabled ? `${st.mode === 'builtin' ? t('syncModeBuiltin') : st.url} · ${st.bookPath}` : undefined}
        disabled={!serverOk || !!busy}
        onClick={() => (st.enabled ? syncSettings.set({ enabled: false }) : void login())}
        right={<Switch checked={st.enabled} disabled={!serverOk || !!busy} onChange={(v) => (v ? void login() : syncSettings.set({ enabled: false }))} />}
      />
      <div className={s.pad}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'builtin', label: t('syncModeBuiltin') },
            { value: 'custom', label: t('syncModeCustom') },
          ]}
        />
        {mode === 'builtin' && <div className={s.dim} style={{ fontSize: 12.5, marginTop: 6 }}>{t('syncBuiltinHint')}</div>}
      </div>
      {mode === 'custom' && (
        <>
          <Field label={t('syncUrl')} hint={t('syncExamples')}>
            <TextField value={url} onChange={setUrl} inputMode="url" placeholder="https://" />
          </Field>
          <Field label={t('syncUser')}>
            <TextField value={user} onChange={setUser} />
          </Field>
          <Field label={t('syncPass')} hint={t('syncPassSaved')}>
            <TextField value={pass} onChange={setPass} type="password" />
          </Field>
        </>
      )}
      <Field label={t('syncPath')} hint={t('syncPathHint')}>
        <TextField value={path} onChange={setPath} />
      </Field>
      <div className={s.btnRow}>
        <Button primary disabled={!serverOk || !!busy} onClick={() => { commitPath(); void login(); }}>
          {t('syncVerify')}
        </Button>
        {st.enabled && <Button disabled={!!busy} onClick={() => void pushEverything()}>{t('syncNow')}</Button>}
        {st.enabled && <Button disabled={!!busy} onClick={() => void logout()}>{t('syncLogout')}</Button>}
      </div>
      {busy && <div className={`${s.pad} ${s.dim}`} style={{ fontSize: 13 }}>{busy}</div>}
      <PrefSwitch slice={syncSettings} k="showSyncMsg" title={t('syncShowMsg')} />
      <PrefSwitch slice={syncSettings} k="syncManually" title={t('syncManually')} />
      <PrefSwitch slice={syncSettings} k="syncReadingBook" title={t('syncBooks')} />
      {st.syncReadingBook && <PrefSwitch slice={syncSettings} k="syncRecentList" title={t('syncRecent')} />}
    </>
  );
}

export function ReadwiseSection() {
  const st = readwiseSettings.use((x) => x);
  const [token, setToken] = useState(st.token);
  const [url, setUrl] = useState(st.url);

  const test = async (next = { token, url }) => {
    try {
      await sendTestHighlight(next);
      toast(t('readwiseOk'));
    } catch (e) {
      toast(t('readwiseErr', { msg: (e as Error).message }), 4000);
    }
  };
  /** token 改变时发测试高亮，成功才保存并允许自动分享（原 app 行为） */
  const commitToken = async () => {
    const next = { token: token.trim(), url: url.trim() };
    if (next.token === st.token && next.url === st.url) return;
    readwiseSettings.set({ ...next, ...(next.token ? {} : { auto: false }) });
    if (next.token) await test(next);
  };

  return (
    <>
      <GroupTitle>{t('secReadwise')}</GroupTitle>
      <Field label={t('readwiseToken')}>
        <input
          className={s.textField}
          type="password"
          value={token}
          autoComplete="off"
          onChange={(e) => setToken(e.target.value)}
          onBlur={() => void commitToken()}
        />
      </Field>
      <Field label={t('readwiseUrl')}>
        <input className={s.textField} value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => void commitToken()} inputMode="url" />
      </Field>
      <PrefSwitch slice={readwiseSettings} k="auto" title={t('readwiseAuto')} disabled={!st.token} />
      <PrefSwitch slice={readwiseSettings} k="withChapter" title={t('readwiseChapter')} />
      <div className={s.btnRow}>
        <Button disabled={!st.token} onClick={() => void test(st)}>{t('readwiseTest')}</Button>
      </div>
    </>
  );
}
