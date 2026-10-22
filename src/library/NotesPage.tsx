// 书签/标注汇总（LIB-030）：总表（徽章过滤、颜色过滤、搜索）→ 单书标注列表（多选删除、分享/导出/导入）
import { useEffect, useMemo, useState } from 'react';
import { Bookmark, ChevronRight, Download, MoreVertical, Share2, StickyNote, Highlighter, Trash2, Send } from 'lucide-react';
import { IconButton, Button, popupMenu, toast, chooseDialog, confirmDialog } from '@/ui';
import type { AnnotationRecord, BookRecord } from '@/core/library';
import { dbEvents, deleteAnnotation, getBook, listAllAnnotations, listBooks, savePosition } from '@/storage/db';
import { mergeRemoteAnnotations } from '@/storage/sync';
import { decodeAnText, decompressAn } from '@/storage/moon-formats';
import { shareAnnotation } from '@/storage/readwise';
import { navigate } from '@/core/router';
import { BookCover } from './BookCover';
import { TopBar } from './TopBar';
import { Empty } from './ui-kit';
import { useLibrary } from './data';
import { openBook } from './open';
import { pickFiles } from './import-collect';
import { toJson, toMarkdown, toMrexpt, toShareText } from './notes-export';
import { triggerDownload, formatDate, safeFileName } from './format';
import { useSelection, useLongPress } from './interactions';
import { readwiseSettings } from './settings';
import { t } from './i18n';
import s from './library.module.css';

type Kind = 'bookmark' | 'note' | 'highlight';
const kindOf = (a: AnnotationRecord): Kind => (a.kind === 'bookmark' ? 'bookmark' : a.note ? 'note' : 'highlight');

function useAnnotations(): AnnotationRecord[] {
  const [list, setList] = useState<AnnotationRecord[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void listAllAnnotations().then((l) => live && setList(l));
    load();
    const off = dbEvents.on('change', (e) => e.store === 'annotations' && load());
    return () => {
      live = false;
      off();
    };
  }, []);
  return list;
}

export function NotesPage({ bookId }: { bookId?: string }) {
  return bookId ? <OneBook bookId={bookId} /> : <Overview />;
}

// ───────────── 总表 ─────────────
function Overview() {
  const lib = useLibrary();
  const all = useAnnotations();
  const [filter, setFilter] = useState<Kind | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const counts = { bookmark: 0, note: 0, highlight: 0 };
  for (const a of all) counts[kindOf(a)]++;
  const inScope = all.filter((a) => (!filter || kindOf(a) === filter) && (!color || a.color.toLowerCase() === color) && matches(a, q));
  const colors = [...new Set(all.filter((a) => a.kind === 'highlight').map((a) => a.color.toLowerCase()))];

  const byBook = new Map<string, { count: number; latest: number }>();
  for (const a of inScope) {
    const cur = byBook.get(a.bookId) ?? { count: 0, latest: 0 };
    cur.count++;
    cur.latest = Math.max(cur.latest, a.updatedAt);
    byBook.set(a.bookId, cur);
  }
  const rows = [...byBook.entries()].sort((a, b) => b[1].latest - a[1].latest);

  return (
    <>
      <TopBar
        title={t('notesTitle')}
        search={{
          scope: 'notes',
          value: q,
          onChange: setQ,
          suggest: (k) =>
            all
              .filter((a) => matches(a, k))
              .slice(0, 8)
              .map((a) => ({ key: a.id, label: lib.byId.get(a.bookId)?.title ?? '', sub: (a.note || a.text || a.title || '').slice(0, 60), onPick: () => navigate('notes', a.bookId) })),
        }}
      />
      <div className={s.content}>
        <div className={s.btnRow} style={{ padding: '10px 12px', alignItems: 'center' }}>
          {(
            [
              ['bookmark', t('bookmarks'), <Bookmark key="b" size={14} />],
              ['note', t('notes'), <StickyNote key="n" size={14} />],
              ['highlight', t('highlights'), <Highlighter key="h" size={14} />],
            ] as const
          ).map(([k, label, icon]) => (
            <button
              key={k}
              className={s.tag}
              style={{ border: 'none', cursor: 'pointer', fontSize: 13, padding: '6px 12px', outline: filter === k ? '2px solid var(--mr-accent)' : 'none' }}
              onClick={() => setFilter(filter === k ? null : k)}
            >
              {icon} {label} ({counts[k]})
            </button>
          ))}
          {colors.length > 0 && (
            <Button
              onClick={async () => {
                const v = await chooseDialog<string>(t('color'), [
                  { value: '', label: t('fileTypeAll') },
                  ...colors.map((c) => ({ value: c, label: <span style={{ display: 'inline-block', width: 60, height: 18, borderRadius: 4, background: c, verticalAlign: -3 }} /> })),
                ]);
                if (v !== null) setColor(v || null);
              }}
            >
              {t('color')}
              {color && <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: color, marginLeft: 6, verticalAlign: -1 }} />}
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <Empty icon={<Bookmark size={44} />} text={<span style={{ whiteSpace: 'pre-line' }}>{t('noBookmarks')}</span>} />
        ) : (
          rows.map(([id, v]) => {
            const b = lib.byId.get(id);
            return (
              <div key={id} className={s.groupRow} style={{ minHeight: 72 }} onClick={() => navigate('notes', id)}>
                <div style={{ width: 40, flex: 'none' }}>{b && <BookCover book={b} />}</div>
                <div className={s.grow}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b?.title ?? '(已删除的书)'}</div>
                  <div className={s.dim} style={{ fontSize: 12 }}>{b?.authors.join(' & ')}</div>
                </div>
                <span className={s.cnt}>({v.count})</span>
                <ChevronRight size={16} style={{ opacity: 0.5 }} />
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function matches(a: AnnotationRecord, q: string): boolean {
  const k = q.trim().toLowerCase();
  if (!k) return true;
  return [a.title, a.note, a.text].some((x) => x?.toLowerCase().includes(k));
}

// ───────────── 单书 ─────────────
function OneBook({ bookId }: { bookId: string }) {
  const all = useAnnotations();
  const [book, setBook] = useState<BookRecord>();
  const sel = useSelection();
  const [q, setQ] = useState('');
  useEffect(() => {
    void getBook(bookId).then(setBook);
  }, [bookId]);
  const list = useMemo(() => all.filter((a) => a.bookId === bookId && matches(a, q)).sort((a, b) => a.range.section - b.range.section || a.range.start - b.range.start), [all, bookId, q]);

  const jump = async (a: AnnotationRecord) => {
    // 阅读页没有「跳到某处」的接口：把进度写到这条标注的位置，再打开书
    await savePosition({ bookId, locator: { section: a.range.section, offset: a.range.start }, progress: a.progress ?? book?.progress ?? 0 });
    await openBook(bookId);
  };

  const removeSelected = async () => {
    if (!(await confirmDialog(`${t('delete')} ${sel.ids.size}?`))) return;
    for (const id of sel.ids) await deleteAnnotation(id);
    sel.clear();
  };

  const shareSelected = async () => {
    if (!book) return;
    const picked = list.filter((a) => sel.ids.has(a.id));
    const text = toShareText(book, picked.length ? picked : list);
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) await nav.share({ text, title: book.title });
      else {
        await navigator.clipboard.writeText(text);
        toast(t('copied'));
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        triggerDownload(new Blob([text], { type: 'text/plain' }), `${safeFileName(book.title)}.txt`);
      }
    }
  };

  const exportMenu = (e: React.MouseEvent) => {
    if (!book) return;
    const live = all.filter((a) => a.bookId === bookId);
    const base = safeFileName(book.title);
    popupMenu(e.clientX - 200, e.clientY, [
      { label: t('shareText'), onSelect: () => void shareSelected() },
      { label: t('exportMd'), onSelect: () => triggerDownload(new Blob([toMarkdown(book, live)], { type: 'text/markdown' }), `${base}.md`) },
      { label: t('exportJson'), onSelect: () => triggerDownload(new Blob([toJson(book, live)], { type: 'application/json' }), `${base}.json`) },
      { label: t('exportMrexpt'), onSelect: () => triggerDownload(new Blob([toMrexpt(book, live)], { type: 'text/plain' }), `${base}.mrexpt`) },
      { label: t('importNotes'), onSelect: () => void importFile() },
    ]);
  };

  const importFile = async () => {
    if (!book) return;
    const [it] = await pickFiles({ accept: ['mrexpt', 'an', 'txt'], multiple: false });
    if (!it) return;
    try {
      const text = decompressAn(new Uint8Array(await it.file.arrayBuffer()));
      const parsed = decodeAnText(text);
      if (!parsed) {
        toast(t('importNotesFailed'));
        return;
      }
      const r = await mergeRemoteAnnotations(book, text);
      if (r.rejected) toast(t('importNotesNotSame'));
      else toast(t('importNotesOk', { a: r.added, u: r.updated, d: r.removed }));
    } catch {
      toast(t('importNotesFailed'));
    }
  };

  const readwiseOn = readwiseSettings.use((x) => !!x.token);
  const rowMenu = (a: AnnotationRecord, x: number, y: number) =>
    popupMenu(x, y, [
      { label: t('openBook'), onSelect: () => void jump(a) },
      ...(readwiseOn && a.kind === 'highlight' && a.text
        ? [
            {
              label: t('readwise'),
              icon: <Send size={15} />,
              onSelect: () =>
                void shareAnnotation(a).then(
                  () => toast(t('readwiseOk')),
                  (e: Error) => toast(t('readwiseErr', { msg: e.message })),
                ),
            },
          ]
        : []),
      { label: t('delete'), onSelect: () => void deleteAnnotation(a.id) },
    ]);

  return (
    <>
      <TopBar
        title={book?.title ?? ''}
        subtitle={book?.authors.join(' & ')}
        nav="back"
        onNav={() => navigate('notes')}
        search={{ scope: 'notes', value: q, onChange: setQ }}
        selecting={
          sel.active
            ? {
                count: sel.ids.size,
                onCancel: sel.clear,
                actions: (
                  <>
                    <IconButton label={t('shareText')} onClick={() => void shareSelected()}>
                      <Share2 size={21} />
                    </IconButton>
                    <IconButton label={t('delete')} onClick={() => void removeSelected()}>
                      <Trash2 size={21} />
                    </IconButton>
                    <IconButton label={t('selectAll')} onClick={() => sel.setAll(list.map((a) => a.id))}>
                      <Download size={21} style={{ transform: 'rotate(180deg)' }} />
                    </IconButton>
                  </>
                ),
              }
            : undefined
        }
        actions={
          <IconButton label={t('exportNotes')} onClick={exportMenu}>
            <MoreVertical size={21} />
          </IconButton>
        }
      />
      <div className={s.content}>
        {list.length === 0 ? (
          <Empty icon={<Bookmark size={44} />} text={<span style={{ whiteSpace: 'pre-line' }}>{t('noBookmarks')}</span>} />
        ) : (
          list.map((a) => <AnnotationRow key={a.id} a={a} selected={sel.ids.has(a.id)} selecting={sel.active} onToggle={() => sel.toggle(a.id)} onLong={() => sel.add(a.id)} onOpen={() => void jump(a)} onMenu={rowMenu} />)
        )}
      </div>
    </>
  );
}

function AnnotationRow(props: { a: AnnotationRecord; selected: boolean; selecting: boolean; onToggle: () => void; onLong: () => void; onOpen: () => void; onMenu: (a: AnnotationRecord, x: number, y: number) => void }) {
  const { a } = props;
  const lp = useLongPress({ onClick: () => (props.selecting ? props.onToggle() : props.onOpen()), onLong: props.onLong });
  const k = kindOf(a);
  return (
    <div className={s.item} data-selected={props.selected ? 'true' : undefined} {...lp}>
      <div style={{ width: 6, borderRadius: 3, background: a.kind === 'bookmark' ? 'var(--mr-accent)' : a.color, flex: 'none', alignSelf: 'stretch' }} />
      <div className={s.itemBody}>
        <div className={s.itemMeta}>
          {k === 'bookmark' ? <Bookmark size={12} /> : k === 'note' ? <StickyNote size={12} /> : <Highlighter size={12} />}
          <span>{a.chapterTitle ?? `#${a.range.section + 1}`}</span>
          {a.progress !== undefined && <span>{(a.progress * 100).toFixed(1)}%</span>}
          <span>{formatDate(a.updatedAt)}</span>
        </div>
        {a.kind === 'bookmark' ? <div className={s.itemTitle}>{a.title || a.text}</div> : <div className={s.itemTitle} style={{ WebkitLineClamp: 4 }}>{a.text}</div>}
        {a.note && <div className={s.itemDesc} style={{ color: 'var(--mr-fg)' }}>✎ {a.note}</div>}
      </div>
      <div className={s.itemRight}>
        <button
          className={s.cellMore}
          style={{ opacity: 1, background: 'transparent', color: 'var(--mr-muted)' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            props.onMenu(a, e.clientX, e.clientY);
          }}
          aria-label={t('itemActions')}
        >
          <MoreVertical size={18} />
        </button>
      </div>
    </div>
  );
}

void listBooks;
