// 书架上的小对话框：移除确认、加入珍藏、标签、重命名收藏夹、阅读状态。
import { useState } from 'react';
import { Check } from 'lucide-react';
import type { BookRecord } from '@/core/library';
import { Button, Row, Sheet, openOverlay } from '@/ui';
import { CheckBox, Field, TextField } from './ui-kit';
import { useLibraryStore } from './data';
import { DEFAULT_FAV } from './settings';
import { isRealTag } from './shelf-model';
import { t } from './i18n';
import s from './library.module.css';

function present<T>(render: (done: (v: T | null) => void) => React.ReactNode): Promise<T | null> {
  return new Promise((resolve) => {
    openOverlay((close) => {
      const done = (v: T | null) => {
        close();
        resolve(v);
      };
      return render(done);
    });
  });
}

// ───────────── 移除 / 删除 ─────────────
export interface RemoveChoice {
  deleteFile: boolean;
  alsoProgress: boolean;
}

function RemoveBody(props: { message: string; allowDelete: boolean; onDone: (v: RemoveChoice | null) => void; title: string }) {
  const [del, setDel] = useState(false);
  const [prog, setProg] = useState(true);
  return (
    <Sheet
      open
      position="center"
      title={props.title}
      onClose={() => props.onDone(null)}
      actions={
        <>
          <Button onClick={() => props.onDone(null)}>{t('no')}</Button>
          <Button primary onClick={() => props.onDone({ deleteFile: del, alsoProgress: prog })}>
            {t('yes')}
          </Button>
        </>
      }
    >
      <div className={s.pad}>{props.message}</div>
      {props.allowDelete && <CheckBox checked={del} onChange={setDel} label={t('deleteFile')} />}
      {props.allowDelete && del && <CheckBox checked={prog} onChange={setProg} label={t('deleteAlsoProgress')} />}
    </Sheet>
  );
}

/** 「从我的书架里移除」确认，带「删除文件」复选（LIB-026） */
export function askRemoveBooks(books: BookRecord[], opts: { fromFavorite?: boolean } = {}): Promise<RemoveChoice | null> {
  const message = books.length === 1 ? t('removeBookConfirm', { name: books[0].title }) : t('removeConfirm', { n: books.length });
  return present((done) => <RemoveBody title={opts.fromFavorite ? t('removeFavorite') : t('removeTitle')} message={message} allowDelete={!opts.fromFavorite} onDone={done} />);
}

// ───────────── 加入珍藏 ─────────────
function FavBody(props: { initial: string; title: string; onDone: (v: string | null) => void; renameMode?: boolean }) {
  const books = useLibraryStore((st) => st.books);
  const existing = [...new Set(books.map((b) => b.favorite ?? '').filter((f) => f && f !== DEFAULT_FAV))].sort();
  const [on, setOn] = useState(props.renameMode ? true : true);
  const [name, setName] = useState(props.initial === DEFAULT_FAV ? '' : props.initial);
  const pick = async () => {
    const v = await present<string>((done) => (
      <Sheet open position="center" title={t('favorite')} onClose={() => done(null)}>
        {existing.length === 0 && <div className={s.pad + ' ' + s.dim}>{t('noFavNames')}</div>}
        {existing.map((f) => (
          <Row key={f} title={f} onClick={() => done(f)} />
        ))}
      </Sheet>
    ));
    if (v) setName(v);
  };
  return (
    <Sheet
      open
      position="center"
      title={props.title}
      onClose={() => props.onDone(null)}
      actions={
        <>
          <Button onClick={() => props.onDone(null)}>{t('cancel')}</Button>
          <Button primary onClick={() => props.onDone(on ? name.trim() || DEFAULT_FAV : '')}>
            {t('ok')}
          </Button>
        </>
      }
    >
      {!props.renameMode && <CheckBox checked={on} onChange={setOn} label={t('favorite')} />}
      <Field label={t('favoriteHint')}>
        <div className={s.formRow}>
          <TextField value={name} onChange={setName} placeholder={t('favoriteHint')} disabled={!on} />
          <Button onClick={() => void pick()}>{t('pickExisting')}</Button>
        </div>
      </Field>
      {existing.length === 0 && <div className={s.pad + ' ' + s.dim}>{t('noFavNames')}</div>}
    </Sheet>
  );
}

/** 返回收藏夹名（''=移出收藏夹，'default_fav'=默认分类）；取消返回 null */
export function askFavorite(initial = ''): Promise<string | null> {
  return present((done) => <FavBody title={t('infoFavTitle')} initial={initial} onDone={done} />);
}

export function askRenameFavorite(oldName: string): Promise<string | null> {
  return present((done) => <FavBody title={t('renameFavTitle')} initial={oldName} renameMode onDone={done} />);
}

// ───────────── 标签 ─────────────
function TagsBody(props: { onDone: (v: string[] | null) => void }) {
  const books = useLibraryStore((st) => st.books);
  const existing = [...new Set(books.flatMap((b) => b.tags.filter(isRealTag)))].sort();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const result = () => [...new Set([...text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean), ...picked])];
  return (
    <Sheet
      open
      position="center"
      title={t('tags')}
      onClose={() => props.onDone(null)}
      actions={
        <>
          <Button onClick={() => props.onDone(null)}>{t('cancel')}</Button>
          <Button primary onClick={() => props.onDone(result())}>
            {t('ok')}
          </Button>
        </>
      }
    >
      <Field label={t('tags')} hint={existing.length ? undefined : t('noTagNames')}>
        <TextField value={text} onChange={setText} rows={3} placeholder={t('tagsHint')} />
      </Field>
      {existing.length > 0 && (
        <div className={s.btnRow}>
          {existing.map((tag) => (
            <button
              key={tag}
              className={s.tag}
              style={{ cursor: 'pointer', border: 'none', outline: picked.has(tag) ? '2px solid var(--mr-accent)' : 'none' }}
              onClick={() =>
                setPicked((p) => {
                  const n = new Set(p);
                  if (n.has(tag)) n.delete(tag);
                  else n.add(tag);
                  return n;
                })
              }
            >
              {picked.has(tag) && <Check size={12} />}
              {tag}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function askTags(): Promise<string[] | null> {
  return present((done) => <TagsBody onDone={done} />);
}

// ───────────── 阅读状态（批量） ─────────────
export function askReadState(): Promise<{ state: 1 | 2 | 3 | undefined } | null> {
  return present((done) => (
    <Sheet open position="center" title={t('readFilter')} onClose={() => done(null)}>
      <Row title={t('readAuto')} onClick={() => done({ state: undefined })} />
      <Row title={t('readUnread')} onClick={() => done({ state: 1 })} />
      <Row title={t('readReading')} onClick={() => done({ state: 2 })} />
      <Row title={t('readFinished')} onClick={() => done({ state: 3 })} />
    </Sheet>
  ));
}

// ───────────── 重新创建封面：输入大小 ─────────────
function NumberBody(props: { title: string; label: string; initial: number; min: number; max: number; onDone: (v: number | null) => void }) {
  const [v, setV] = useState(String(props.initial));
  const n = Math.max(props.min, Math.min(props.max, parseInt(v, 10) || props.initial));
  return (
    <Sheet
      open
      position="center"
      title={props.title}
      onClose={() => props.onDone(null)}
      actions={
        <>
          <Button onClick={() => props.onDone(null)}>{t('cancel')}</Button>
          <Button primary onClick={() => props.onDone(n)}>
            {t('ok')}
          </Button>
        </>
      }
    >
      <Field label={`${props.label} (${props.min}-${props.max})`}>
        <TextField value={v} onChange={setV} inputMode="numeric" autoFocus onEnter={() => props.onDone(n)} />
      </Field>
    </Sheet>
  );
}

export function askNumber(title: string, label: string, initial: number, min: number, max: number): Promise<number | null> {
  return present((done) => <NumberBody title={title} label={label} initial={initial} min={min} max={max} onDone={done} />);
}

export { present };
