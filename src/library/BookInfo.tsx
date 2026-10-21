// 书籍信息 / 编辑对话框（LIB-013/032，MISC-006）
import { useEffect, useState } from 'react';
import { BookOpen, Star } from 'lucide-react';
import type { BookRecord } from '@/core/library';
import { Button, Select, openOverlay, toast } from '@/ui';
import { dbEvents, getBook, getStats, listBooks, updateBook, type StatRecord } from '@/storage/db';
import { CheckBox, Field, FullDialog, TextField } from './ui-kit';
import { BookCover } from './BookCover';
import { openCoverPicker } from './CoverPicker';
import { restoreCover, setCustomCover, svgCoverBlob } from './covers';
import { DEFAULT_FAV } from './settings';
import { formatDate, formatSize } from './format';
import { readStateOf } from './shelf-model';
import { dayToDate } from './stats';
import { isRealTag } from './shelf-model';
import { present } from './dialogs';
import { Row, Sheet } from '@/ui';
import { goRead } from './actions';
import { t } from './i18n';
import s from './library.module.css';

/** 打开书籍信息对话框（阅读页「显示书籍信息」也调它） */
export function openBookInfo(bookId: string): void {
  openOverlay((close) => <BookInfoDialog bookId={bookId} onClose={close} />);
}

const splitAuthors = (v: string) =>
  v
    .split(/\s*(?:&|\n|;|；)\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

function BookInfoDialog(props: { bookId: string; onClose: () => void }) {
  const [book, setBook] = useState<BookRecord>();
  const [stat, setStat] = useState<StatRecord>();
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [coverText, setCoverText] = useState('');
  const [desc, setDesc] = useState('');
  const [favOn, setFavOn] = useState(false);
  const [favName, setFavName] = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [seriesIdx, setSeriesIdx] = useState('');
  const [tags, setTags] = useState('');
  const [readState, setReadState] = useState<'auto' | '1' | '2' | '3'>('auto');
  const [onShelf, setOnShelf] = useState(true);

  useEffect(() => {
    void (async () => {
      const b = await getBook(props.bookId);
      if (!b) return;
      setBook(b);
      setTitle(b.title);
      setAuthors(b.authors.join(' & '));
      setDesc(b.description ?? '');
      setFavOn(!!b.favorite);
      setFavName(b.favorite && b.favorite !== DEFAULT_FAV ? b.favorite : '');
      setSeriesName(b.series?.name ?? '');
      setSeriesIdx(b.series?.index !== undefined ? String(b.series.index) : '');
      setTags(b.tags.filter(isRealTag).join('\n'));
      setReadState(b.readState ? (String(b.readState) as '1' | '2' | '3') : 'auto');
      setOnShelf(b.onShelf !== false);
      setStat(await getStats(b.id));
    })();
  }, [props.bookId]);

  // 封面被改后刷新
  useEffect(
    () =>
      dbEvents.on('change', (e) => {
        if (e.bookId === props.bookId && (e.store === 'books' || e.store === 'covers')) void getBook(props.bookId).then((b) => b && setBook((cur) => (cur ? { ...cur, hasCover: b.hasCover } : b)));
      }),
    [props.bookId],
  );

  if (!book) return null;

  const pickFav = async () => {
    const all = await listBooks();
    const names = [...new Set(all.map((b) => b.favorite ?? '').filter((f) => f && f !== DEFAULT_FAV))].sort();
    const v = await present<string>((done) => (
      <Sheet open position="center" title={t('favorite')} onClose={() => done(null)}>
        {names.length === 0 && <div className={`${s.pad} ${s.dim}`}>{t('noFavNames')}</div>}
        {names.map((n) => (
          <Row key={n} title={n} onClick={() => done(n)} />
        ))}
      </Sheet>
    ));
    if (v) {
      setFavName(v);
      setFavOn(true);
    }
  };

  const save = async () => {
    const idx = parseFloat(seriesIdx);
    const patch: Partial<BookRecord> = {
      title: title.trim() || book.title,
      authors: splitAuthors(authors),
      description: desc.trim() || undefined,
      favorite: favOn ? favName.trim() || DEFAULT_FAV : '',
      tags: [...new Set([...tags.split(/\r?\n/).map((x) => x.trim()).filter(isRealTag), ...book.tags.filter((x) => !isRealTag(x))])],
      series: seriesName.trim() ? { name: seriesName.trim(), ...(Number.isFinite(idx) ? { index: Math.max(0, idx) } : { index: 0 }) } : undefined,
      readState: readState === 'auto' ? undefined : (Number(readState) as 1 | 2 | 3),
      onShelf,
    };
    await updateBook(book.id, patch);
    if (coverText.trim()) await setCustomCover(book.id, svgCoverBlob(coverText.trim(), '', 4));
    props.onClose();
  };

  const speed = stat && stat.usedMs > 0 && stat.words > 0 ? Math.round(stat.words / (stat.usedMs / 60000)) : 0;
  const days = stat ? Object.keys(stat.days).map(Number).sort((a, b) => b - a) : [];
  return (
    <FullDialog
      title={t('infoTitle')}
      onClose={props.onClose}
      right={
        <Button
          primary
          onClick={() => {
            props.onClose();
            goRead(book.id);
          }}
        >
          <BookOpen size={16} style={{ verticalAlign: -3 }} /> {t('openBook')}
        </Button>
      }
      actions={
        <>
          <Button onClick={props.onClose}>{t('cancel')}</Button>
          <Button primary onClick={() => void save()}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 14, padding: '14px 16px 6px', alignItems: 'flex-start' }}>
        <div style={{ width: 96, flex: 'none' }}>
          <BookCover book={book} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <Button onClick={() => openCoverPicker(book.id)}>{t('changeCover')}</Button>
          <Button onClick={() => openCoverPicker(book.id, { search: true })}>{t('downloadCover')}</Button>
          {book.hasCover && <Button onClick={() => void restoreCover(book.id).then(() => toast(t('coverSet')))}>{t('restoreCover')}</Button>}
        </div>
      </div>
      {!book.onShelf && <CheckBox checked={onShelf} onChange={setOnShelf} label={t('tabShelf')} />}
      <Field label={t('bookTitle')}>
        <TextField value={title} onChange={setTitle} />
      </Field>
      <Field label={t('bookAuthor')}>
        <TextField value={authors} onChange={setAuthors} />
      </Field>
      <Field label={t('coverText')}>
        <TextField value={coverText} onChange={setCoverText} />
      </Field>
      <Field label={t('description')}>
        <TextField value={desc} onChange={setDesc} rows={4} />
      </Field>
      <div className={s.sep} />
      <CheckBox checked={favOn} onChange={setFavOn} label={<><Star size={14} style={{ verticalAlign: -2 }} /> {t('favorite')}</>} />
      <Field label={t('favoriteHint')}>
        <div className={s.formRow}>
          <TextField value={favName} onChange={setFavName} placeholder={t('favoriteHint')} disabled={!favOn} />
          <Button onClick={() => void pickFav()}>{t('pickExisting')}</Button>
        </div>
      </Field>
      <Field label={t('series')}>
        <div className={s.formRow}>
          <TextField value={seriesName} onChange={setSeriesName} placeholder={t('seriesName')} />
          <div className={s.fixed} style={{ width: 90 }}>
            <TextField value={seriesIdx} onChange={setSeriesIdx} placeholder={t('seriesIndex')} inputMode="numeric" />
          </div>
        </div>
      </Field>
      <Field label={t('tags')}>
        <TextField value={tags} onChange={setTags} rows={3} placeholder={t('tagsHint')} />
      </Field>
      <Field label={t('readFilter')}>
        <Select
          value={readState}
          onChange={setReadState}
          options={[
            { value: 'auto', label: `${t('readAuto')} (${[t('readUnread'), t('readReading'), t('readFinished')][readStateOf({ progress: book.progress }) - 1]})` },
            { value: '1', label: t('readUnread') },
            { value: '2', label: t('readReading') },
            { value: '3', label: t('readFinished') },
          ]}
        />
      </Field>
      <div className={s.sep} />
      <div className={s.pad} style={{ fontSize: 13, color: 'var(--mr-muted)', lineHeight: 1.7, wordBreak: 'break-all' }}>
        <div>
          {t('fileInfo')}: {book.fileName}
        </div>
        <div>
          {book.format.toUpperCase()} · {formatSize(book.size)} · {formatDate(book.addedAt)}
          {book.source?.kind && book.source.kind !== 'local' ? ` · ${t('source')}: ${book.source.catalog ?? book.source.kind}` : ''}
        </div>
        {speed > 0 && (
          <>
            <div>
              {t('readSpeed')}: {speed}
            </div>
            <div>
              {t('readHours')}: {(stat!.usedMs / 3_600_000).toFixed(2)}
            </div>
          </>
        )}
        {days.length > 0 && (
          <>
            <div>{t('readDates')}:</div>
            {days.slice(0, 40).map((d) => {
              const v = stat!.days[d];
              const min = v.ms / 60000;
              return (
                <div key={d} style={{ paddingLeft: 8 }}>
                  {dayToDate(d)} &nbsp; {min < 60 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`} {min > 0 && v.words > 0 ? ` ${Math.round(v.words / min)} w/m` : ''}
                </div>
              );
            })}
          </>
        )}
      </div>
      <div style={{ height: 12 }} />
    </FullDialog>
  );
}

