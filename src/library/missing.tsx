// 失效书籍（文件已不在浏览器存储里，例如从不带书籍文件的备份恢复后）的处理（LIB-025）
import { useState } from 'react';
import { Button, Sheet } from '@/ui';
import type { BookRecord } from '@/core/library';
import { navigate } from '@/core/router';
import { fileFingerprint } from '@/storage/fingerprint';
import { toast } from '@/ui';
import { findBooksMissingFile, relinkBookFile, removeFromShelf } from './actions';
import { CheckBox } from './ui-kit';
import { pickFiles } from './import-collect';
import { present } from './dialogs';
import { deleteBook, removeManyFromHistory, touchHistory } from '@/storage/db';
import { t } from './i18n';
import s from './library.module.css';

type Choice = { kind: 'remove'; all: boolean } | { kind: 'relink' };

function MissingBody(props: { book: BookRecord; onDone: (c: Choice | null) => void }) {
  const [all, setAll] = useState(false);
  return (
    <Sheet
      open
      position="center"
      title={t('missingTitle')}
      onClose={() => props.onDone(null)}
      actions={
        <>
          <Button onClick={() => props.onDone(null)}>{t('no')}</Button>
          <Button onClick={() => props.onDone({ kind: 'relink' })}>{t('relink')}</Button>
          <Button primary onClick={() => props.onDone({ kind: 'remove', all })}>
            {t('yes')}
          </Button>
        </>
      }
    >
      <div className={s.pad}>
        <div>{t('missingBody', { name: props.book.title })}</div>
        <div className={s.dim} style={{ fontSize: 12.5, marginTop: 4, wordBreak: 'break-all' }}>{props.book.fileName}</div>
      </div>
      <CheckBox checked={all} onChange={setAll} label={t('missingAll')} />
    </Sheet>
  );
}

export async function askMissingBook(book: BookRecord): Promise<void> {
  const c = await present<Choice>((done) => <MissingBody book={book} onDone={done} />);
  if (!c) return;
  if (c.kind === 'relink') {
    const [it] = await pickFiles({ multiple: false });
    if (!it) return;
    if ((await fileFingerprint(it.file)) !== book.id) {
      toast(t('importNotesNotSame'));
      return;
    }
    await relinkBookFile(book.id, it.file);
    await touchHistory(book.id);
    navigate('read', book.id);
    return;
  }
  const targets = c.all ? await findBooksMissingFile() : [book];
  const ids = targets.map((b) => b.id);
  await removeFromShelf(ids);
  // 文件都没了，书记录本身也没有保留价值；标注、进度原样留着（原 app 同样不动 notes）
  for (const id of ids) await deleteBook(id, { keepAnnotations: true, keepProgress: true });
  await removeManyFromHistory(ids);
  toast(t('removed'));
}
