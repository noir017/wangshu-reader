// PDF 密码（PDF-001）：密码对话框带「保存密码」复选；保存的密码存在 kv，下次打开自动带上，错了就清掉。
// 原 app 用 A.getEncryptText 轻度混淆后存 prefs；这里同样只做 base64 混淆（防肩窥，不是加密），不上传、不进备份之外的地方。
import { useState } from 'react';
import { Button, Sheet, TextInput, openOverlay } from '@/ui';
import { deleteKV, getKV, setKV } from '@/storage/db';
import { t } from '../messages';

const key = (bookId: string) => `reader.pdfpw.${bookId}`;
const enc = (s: string) => btoa(unescape(encodeURIComponent(s)));
const dec = (s: string) => {
  try {
    return decodeURIComponent(escape(atob(s)));
  } catch {
    return undefined;
  }
};

export async function getSavedPassword(bookId: string): Promise<string | undefined> {
  const v = await getKV<string>(key(bookId));
  return v ? dec(v) : undefined;
}

export async function savePassword(bookId: string, password: string): Promise<void> {
  await setKV(key(bookId), enc(password));
}

export function clearSavedPassword(bookId: string): Promise<void> {
  return deleteKV(key(bookId));
}

export interface PasswordAnswer {
  password: string;
  save: boolean;
}

/** 弹出密码框；取消返回 null */
export function askPassword(opts: { wrong: boolean }): Promise<PasswordAnswer | null> {
  return new Promise((resolve) => {
    openOverlay((close) => (
      <PasswordBody
        wrong={opts.wrong}
        onDone={(v) => {
          close();
          resolve(v);
        }}
      />
    ));
  });
}

function PasswordBody({ wrong, onDone }: { wrong: boolean; onDone: (v: PasswordAnswer | null) => void }) {
  const [pw, setPw] = useState('');
  const [save, setSave] = useState(false);
  const submit = () => pw && onDone({ password: pw, save });
  return (
    <Sheet
      open
      position="center"
      title={t('password_title')}
      onClose={() => onDone(null)}
      actions={
        <>
          <Button onClick={() => onDone(null)}>{t('cancel')}</Button>
          <Button primary onClick={submit}>
            {t('ok')}
          </Button>
        </>
      }
    >
      <div style={{ padding: '12px 16px', display: 'grid', gap: 12 }}>
        {wrong && <div style={{ color: 'var(--mr-danger, #d33)', fontSize: 13 }}>{t('password_wrong')}</div>}
        <TextInput value={pw} onChange={setPw} placeholder={t('password_hint')} type="password" autoFocus onEnter={submit} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          {t('password_save')}
        </label>
      </div>
    </Sheet>
  );
}
