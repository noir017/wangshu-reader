// 封面选择器（MISC-005 / LIB-019）：上传图片、内置配色、文字封面、在线搜图。
import { useEffect, useState } from 'react';
import { ImagePlus, Palette, Search, Type } from 'lucide-react';
import { Button, Segmented, toast, openOverlay } from '@/ui';
import { getBook } from '@/storage/db';
import type { BookRecord } from '@/core/library';
import { FullDialog, TextField, Spinner, Empty } from './ui-kit';
import { PALETTES, coverSvg, fetchImageBlob, searchCovers, setCustomCover, svgCoverBlob, type CoverCandidate } from './covers';
import { pickFiles } from './import-collect';
import { shelfSettings } from './settings';
import { hasServer } from '@/core/server';
import { t } from './i18n';
import s from './library.module.css';

type Tab = 'search' | 'upload' | 'preset' | 'text';

export function openCoverPicker(bookId: string, opts: { search?: boolean } = {}): void {
  openOverlay((close) => <CoverPicker bookId={bookId} initialTab={opts.search ? 'search' : 'upload'} onClose={close} />);
}

function CoverPicker(props: { bookId: string; initialTab: Tab; onClose: () => void }) {
  const [book, setBook] = useState<BookRecord>();
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getBook(props.bookId).then(setBook);
  }, [props.bookId]);

  const apply = async (make: () => Promise<Blob>) => {
    setBusy(true);
    try {
      await setCustomCover(props.bookId, await make());
      toast(t('coverSet'));
      props.onClose();
    } catch (e) {
      toast(`${t('coverFailed')}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!book) return null;
  return (
    <FullDialog title={t('coverPicker')} onClose={props.onClose}>
      <div className={s.pad}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'search', label: t('coverOnline') },
            { value: 'upload', label: t('coverUpload') },
            { value: 'preset', label: t('coverBuiltin') },
            { value: 'text', label: t('coverText2') },
          ]}
        />
      </div>
      {tab === 'upload' && (
        <div className={s.empty}>
          <ImagePlus size={40} />
          <Button
            primary
            disabled={busy}
            onClick={async () => {
              const [it] = await pickFiles({ accept: ['jpg', 'jpeg', 'png', 'webp', 'gif'], multiple: false });
              if (it) await apply(async () => it.file);
            }}
          >
            {t('coverUpload')}
          </Button>
        </div>
      )}
      {tab === 'preset' && (
        <div className={s.grid} style={{ ['--cols' as string]: 3, ['--cover-w' as string]: '100px', padding: 12 }}>
          {PALETTES.map((_, i) => (
            <div key={i} className={s.cell} style={{ paddingBottom: 12 }} onClick={() => void apply(async () => svgCoverBlob(book.title, book.authors.join(' & '), i))}>
              <span className={s.cover}>
                <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverSvg(book.title, book.authors.join(' & '), i))}`} alt="" />
              </span>
            </div>
          ))}
        </div>
      )}
      {tab === 'text' && <TextCover book={book} busy={busy} onApply={(text, idx) => void apply(async () => svgCoverBlob(text, '', idx))} />}
      {tab === 'search' && <OnlineSearch book={book} busy={busy} onPick={(c) => void apply(() => fetchImageBlob(c.full))} />}
    </FullDialog>
  );
}

function TextCover(props: { book: BookRecord; busy: boolean; onApply: (text: string, palette: number) => void }) {
  const [text, setText] = useState(props.book.title);
  const [idx, setIdx] = useState(1);
  return (
    <div className={s.pad} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TextField value={text} onChange={setText} placeholder={t('coverText')} />
      <div className={s.btnRow} style={{ padding: 0 }}>
        {PALETTES.map((p, i) => (
          <button key={i} onClick={() => setIdx(i)} aria-label={`palette ${i}`} style={{ width: 34, height: 34, borderRadius: '50%', border: idx === i ? '3px solid var(--mr-accent)' : '2px solid var(--mr-border)', background: `linear-gradient(135deg, ${p.from}, ${p.to})`, cursor: 'pointer' }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span className={s.cover} style={{ width: 120 }}>
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverSvg(text || ' ', '', idx))}`} alt="" />
        </span>
      </div>
      <Button primary disabled={props.busy || !text.trim()} onClick={() => props.onApply(text.trim(), idx)}>
        <Type size={14} style={{ verticalAlign: -2 }} /> {t('save')}
      </Button>
    </div>
  );
}

function OnlineSearch(props: { book: BookRecord; busy: boolean; onPick: (c: CoverCandidate) => void }) {
  const [q, setQ] = useState(`${props.book.title} ${props.book.authors[0] ?? ''}`.trim());
  const [items, setItems] = useState<CoverCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const engine = shelfSettings.use((st) => st.coverSearchEngine);
  const run = async () => {
    setLoading(true);
    setErr('');
    try {
      setItems(await searchCovers(q, '', engine));
    } catch (e) {
      setErr((e as Error).message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void run();
    // 只在打开时自动搜一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <div className={s.pad} style={{ display: 'flex', gap: 8 }}>
        <TextField value={q} onChange={setQ} onEnter={() => void run()} placeholder={t('search')} />
        <Button primary onClick={() => void run()} disabled={loading}>
          <Search size={16} />
        </Button>
      </div>
      {!hasServer() && <div className={`${s.pad} ${s.dim}`}>{t('noServer')}: Open Library / Google Books</div>}
      {loading && (
        <Empty icon={<Spinner size={28} />} text={t('coverSearching')} />
      )}
      {!loading && items && items.length === 0 && <Empty icon={<Palette size={36} />} text={err || t('coverNoResult')} />}
      {!loading && items && items.length > 0 && (
        <>
          <div className={`${s.pad} ${s.dim}`} style={{ fontSize: 12.5 }}>{t('coverTip')}</div>
          <div className={s.grid} style={{ ['--cols' as string]: 3, ['--cover-w' as string]: '110px', padding: '0 8px 16px' }}>
            {items.map((c) => (
              <div key={c.id} className={s.cell} style={{ paddingBottom: 10 }} onClick={() => !props.busy && props.onPick(c)}>
                <span className={s.cover}>
                  <img src={c.thumb} alt="" referrerPolicy="no-referrer" loading="lazy" />
                </span>
                <div className={s.cellTitle} style={{ fontSize: 11, color: 'var(--mr-muted)' }}>{c.source}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
