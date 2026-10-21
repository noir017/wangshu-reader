// 网络书库的对话框：增加新书库（含 Calibre IP）、编辑书库、登录（NET-005）
import { useState } from 'react';
import { Button, Sheet, openOverlay, toast } from '@/ui';
import { CheckBox, Field, TextField } from '../ui-kit';
import { AuthRequiredError, NotOpdsError, discoverSearch, fetchFeed } from '../opds-client';
import { calibreUrl, hostOf, saveCatalog, type Catalog } from '../catalogs';
import { netSettings } from '../settings';
import { present } from '../dialogs';
import { t } from '../i18n';
import s from '../library.module.css';

// ───────────── 登录 ─────────────
function LoginBody(props: { initialUser?: string; onDone: (v: { user: string; password: string; remember: boolean } | null) => void }) {
  const [user, setUser] = useState(props.initialUser ?? '');
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(true);
  return (
    <Sheet
      open
      position="center"
      title={t('netLogin')}
      onClose={() => props.onDone(null)}
      actions={
        <>
          <Button onClick={() => props.onDone(null)}>{t('cancel')}</Button>
          <Button primary onClick={() => props.onDone({ user, password: pw, remember })}>
            {t('ok')}
          </Button>
        </>
      }
    >
      <Field label={t('netUser')}>
        <TextField value={user} onChange={setUser} autoFocus />
      </Field>
      <Field label={t('syncPass')}>
        <TextField value={pw} onChange={setPw} type="password" onEnter={() => props.onDone({ user, password: pw, remember })} />
      </Field>
      <CheckBox checked={remember} onChange={setRemember} label={t('netRemember')} />
    </Sheet>
  );
}

export function askLogin(initialUser?: string) {
  return present<{ user: string; password: string; remember: boolean }>((done) => <LoginBody initialUser={initialUser} onDone={done} />);
}

// ───────────── 增加新书库 ─────────────
function CalibreBody(props: { onDone: (url: string | null) => void }) {
  const [ip, setIp] = useState('192.168.1.');
  const [port, setPort] = useState('8080');
  return (
    <Sheet
      open
      position="center"
      title={t('netCalibreIp')}
      onClose={() => props.onDone(null)}
      actions={
        <>
          <Button onClick={() => props.onDone(null)}>{t('cancel')}</Button>
          <Button primary disabled={!ip.trim()} onClick={() => props.onDone(calibreUrl(ip, port))}>
            {t('ok')}
          </Button>
        </>
      }
    >
      <Field label="IP">
        <TextField value={ip} onChange={setIp} inputMode="url" autoFocus />
      </Field>
      <Field label={t('netCalibrePort')}>
        <TextField value={port} onChange={setPort} inputMode="numeric" />
      </Field>
      <div className={`${s.pad} ${s.dim}`} style={{ fontSize: 12 }}>
        → {calibreUrl(ip || 'a.b.c.d', port)}
      </div>
    </Sheet>
  );
}

function AddBody(props: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState(netSettings.get().lastCatalogUrl);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const u = url.trim();
    if (u.length < 10 || !/^https?:\/\//i.test(u)) {
      toast(t('netAddFailed'));
      return;
    }
    netSettings.set({ lastCatalogUrl: u });
    setBusy(true);
    try {
      let auth: { username?: string; password?: string } = {};
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const feed = await fetchFeed(u, auth);
          const search = await discoverSearch(feed, auth).catch(() => undefined);
          await saveCatalog({ title: name.trim() || feed.title || hostOf(u), summary: feed.subtitle, main: u, search, ...auth });
          props.onClose();
          return;
        } catch (e) {
          if (e instanceof AuthRequiredError) {
            const c = await askLogin(auth.username);
            if (!c) return;
            auth = { username: c.user, password: c.password };
            continue;
          }
          if (e instanceof NotOpdsError) {
            // 不是 OPDS：当作网页书库（原行为：html=true，名=输入或 <title>）
            await saveCatalog({ title: name.trim() || e.pageTitle || hostOf(u), main: u, html: true });
            toast(t('netAddedWeb'));
            props.onClose();
            return;
          }
          throw e;
        }
      }
    } catch (e) {
      toast(`${t('netAddFailed')} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      position="center"
      title={t('netAdd')}
      onClose={props.onClose}
      actions={
        <>
          <Button
            onClick={async () => {
              const u = await present<string>((done) => <CalibreBody onDone={done} />);
              if (u) setUrl(u);
            }}
          >
            {t('netCalibre')}
          </Button>
          <Button onClick={props.onClose}>{t('cancel')}</Button>
          <Button primary disabled={busy} onClick={() => void submit()}>
            {busy ? '…' : t('ok')}
          </Button>
        </>
      }
    >
      <Field label={t('netAddName')}>
        <TextField value={name} onChange={setName} />
      </Field>
      <Field label={t('netAddUrl')} hint={`${t('netAddExample')} https://www.gutenberg.org/ebooks.opds/ · http://192.168.1.5:8080/opds`}>
        <TextField value={url} onChange={setUrl} inputMode="url" onEnter={() => void submit()} />
      </Field>
    </Sheet>
  );
}

export function openAddCatalog(): void {
  openOverlay((close) => <AddBody onClose={close} />);
}

// ───────────── 编辑 ─────────────
function EditBody(props: { catalog: Catalog; onClose: () => void }) {
  const c = props.catalog;
  const [title, setTitle] = useState(c.title);
  const [url, setUrl] = useState(c.main);
  const [user, setUser] = useState(c.username ?? '');
  const [pw, setPw] = useState(c.password ?? '');
  const [search, setSearch] = useState(c.search ?? '');
  return (
    <Sheet
      open
      position="center"
      title={t('netEdit')}
      onClose={props.onClose}
      actions={
        <>
          <Button onClick={props.onClose}>{t('cancel')}</Button>
          <Button
            primary
            onClick={async () => {
              await saveCatalog({ ...c, title: title.trim() || c.title, main: url.trim() || c.main, username: user.trim() || undefined, password: user.trim() ? pw : undefined, search: search.trim() || undefined });
              props.onClose();
            }}
          >
            {t('ok')}
          </Button>
        </>
      }
    >
      <Field label={t('netAddName')}>
        <TextField value={title} onChange={setTitle} />
      </Field>
      <Field label={t('netAddUrl')}>
        <TextField value={url} onChange={setUrl} inputMode="url" />
      </Field>
      {!c.html && (
        <Field label="Search" hint="{searchTerms}">
          <TextField value={search} onChange={setSearch} inputMode="url" />
        </Field>
      )}
      <Field label={t('netUser')}>
        <TextField value={user} onChange={setUser} />
      </Field>
      {user.trim() && (
        <Field label={t('syncPass')}>
          <TextField value={pw} onChange={setPw} type="password" />
        </Field>
      )}
    </Sheet>
  );
}

export function openEditCatalog(c: Catalog): void {
  openOverlay((close) => <EditBody catalog={c} onClose={close} />);
}
