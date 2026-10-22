// 书签/标注/高亮列表（ANNO-008，TOC-001 第二标签）：筛选、颜色筛选、关键字搜索、按位置/时间排序、多选删除、导出。
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bookmark, Download, Ellipsis, Highlighter, PenLine, Search, Settings2 } from 'lucide-react';
import type { AnnotationRecord } from '@/core/library';
import type { ReaderSession } from '@/core/reader-session';
import { Button, confirmDialog, GroupTitle, IconButton, popupMenu, Row, Sheet, Switch, toast } from '@/ui';
import { shareText } from '../common/clipboard';
import { formatDateTime, percentStr } from '../common/format';
import { useLongPress } from '../common/hooks';
import { tc } from '../common/messages';
import { goToAnnotation, removeAnnotation, removeAnnotations } from '../annotations/actions';
import { pushLinkBackHere } from '../common/linkback';
import { editBookmark, toggleBookmark } from '../annotations/BookmarkFlow';
import { removeHlAllByText } from '../annotations/highlight-all';
import { matchFilter, matchKeyword, sortAnnotations, usedColors, type AnnotFilter } from '../annotations/model';
import { openEditNote } from '../annotations/NoteEditor';
import { annoSettings } from '../annotations/settings';
import { useAnnotations } from '../annotations/store';
import { StyleSample } from '../annotations/StyleSample';
import { openExportMenu } from '../export/ExportMenu';
import { buildShareText } from '../export/text-export';
import { appSettings } from '@/core/app-settings';
import feat from '../common/features.module.css';
import css from './toc.module.css';
import { tt } from './messages';
import { tocSettings } from './settings';

/** 关键字命中处加粗（ANNO-008 搜索高亮） */
export function markKeyword(text: string, kw: string): ReactNode {
  if (!kw) return text;
  const lower = text.toLowerCase();
  const k = kw.toLowerCase();
  const out: ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(k); i !== -1; i = lower.indexOf(k, at)) {
    if (i > at) out.push(text.slice(at, i));
    out.push(
      <mark key={i} className={css.mark2}>
        {text.slice(i, i + k.length)}
      </mark>,
    );
    at = i + k.length;
  }
  out.push(text.slice(at));
  return out.map((n, i) => <Fragment key={i}>{n}</Fragment>);
}

function OptionsDialog({ close }: { close: () => void }) {
  const s = annoSettings.use((x) => x);
  return (
    <Sheet open position="center" title={tt('optionsTitle')} onClose={close} actions={<Button primary onClick={close}>{tc('ok')}</Button>}>
      <GroupTitle>{tt('bookmarks')}</GroupTitle>
      <Row title={tt('bookmarkManually')} onClick={() => annoSettings.set({ bookmarkManually: !s.bookmarkManually })} right={<Switch checked={s.bookmarkManually} onChange={(v) => annoSettings.set({ bookmarkManually: v })} />} />
      <Row title={tt('byTime')} onClick={() => annoSettings.set({ bookmarkSortByDate: !s.bookmarkSortByDate })} right={<Switch checked={s.bookmarkSortByDate} onChange={(v) => annoSettings.set({ bookmarkSortByDate: v })} />} />
      <Row title={tt('shareWithChapter')} onClick={() => annoSettings.set({ shareWithChapter: !s.shareWithChapter })} right={<Switch checked={s.shareWithChapter} onChange={(v) => annoSettings.set({ shareWithChapter: v })} />} />
      <Row title={tt('corner')} onClick={() => annoSettings.set({ bookmarkCorner: !s.bookmarkCorner })} right={<Switch checked={s.bookmarkCorner} onChange={(v) => annoSettings.set({ bookmarkCorner: v })} />} />
    </Sheet>
  );
}

function ItemRow(p: {
  a: AnnotationRecord;
  n: number;
  kw: string;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onLong: () => void;
  onMenu: (el: HTMLElement) => void;
}) {
  const { a } = p;
  const lp = useLongPress(p.onLong);
  const bm = a.kind === 'bookmark';
  const icon = bm ? <Bookmark size={19} fill={a.color || 'none'} color={a.color || 'currentColor'} /> : a.note ? <PenLine size={19} /> : <Highlighter size={19} color={a.color || 'currentColor'} />;
  const oneLine = a.text.replace(/\s+/g, ' ').trim();
  return (
    <div
      className={css.item}
      data-testid="annot-item"
      data-kind={a.kind}
      data-selected={p.selected ? 'true' : undefined}
      {...lp.bind}
      onClick={() => {
        if (lp.consumed()) return;
        if (p.selecting) p.onToggle();
        else p.onOpen();
      }}
    >
      {p.selecting && <input type="checkbox" className={css.check} checked={p.selected} readOnly />}
      <span className={css.itemIcon}>{icon}</span>
      <div className={css.itemMain}>
        <div className={css.itemText}>
          {bm ? (
            markKeyword(a.title || a.text, p.kw)
          ) : (
            <>
              {p.n}. <StyleSample style={a.style} color={a.color}>{markKeyword(oneLine, p.kw)}</StyleSample>
            </>
          )}
        </div>
        {a.note && <div className={css.itemNote}>{markKeyword(a.note, p.kw)}</div>}
        <div className={css.itemMeta}>
          <span className={css.grow}>{[a.chapterTitle, percentStr(a.progress)].filter(Boolean).join(' · ')}</span>
          <span>{formatDateTime(a.createdAt)}</span>
        </div>
      </div>
      {!p.selecting && (
        <IconButton
          label={tc('more')}
          onClick={(e) => {
            e.stopPropagation();
            p.onMenu(e.currentTarget as HTMLElement);
          }}
          style={{ width: 32, height: 32 }}
        >
          <Ellipsis size={18} />
        </IconButton>
      )}
    </div>
  );
}

export function AnnotTab(p: {
  session: ReaderSession;
  reversed: boolean;
  initialFilter?: AnnotFilter;
  onClose: () => void;
  onSelection: (count: number, deleteFn: () => void) => void;
}) {
  const { session, onClose } = p;
  const items = useAnnotations((s) => s.items);
  const filter = tocSettings.use((s) => s.annotFilter);
  const byTime = annoSettings.use((s) => s.bookmarkSortByDate);
  const [kw, setKw] = useState('');
  const [searching, setSearching] = useState(false);
  const [color, setColor] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    if (p.initialFilter !== undefined) tocSettings.set({ annotFilter: p.initialFilter });
  }, [p.initialFilter]);

  const colors = useMemo(() => usedColors(items), [items]);
  const list = useMemo(
    () => sortAnnotations(items.filter((a) => matchFilter(a, filter) && (!color || a.color.toLowerCase() === color) && matchKeyword(a, kw)), byTime, p.reversed),
    [items, filter, color, kw, byTime, p.reversed],
  );

  const exitSelect = useCallback(() => {
    setSel(new Set());
    setSelecting(false);
  }, []);

  const deleteSelected = useCallback(async () => {
    if (!sel.size) return;
    if (!(await confirmDialog(tt('confirmDeleteSelected', { n: sel.size })))) return;
    await removeAnnotations([...sel]);
    exitSelect();
    toast(tt('deleted'));
  }, [sel, exitSelect]);

  useEffect(() => {
    p.onSelection(sel.size, () => void deleteSelected());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, deleteSelected]);
  useEffect(() => () => p.onSelection(0, () => undefined), []); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteAllInList = async () => {
    if (!list.length) return;
    if (!(await confirmDialog(tt('confirmDeleteAll', { n: list.length })))) return;
    await removeAnnotations(list.map((a) => a.id));
    toast(tt('deleted'));
  };

  const openMenu = (a: AnnotationRecord, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const share = {
      label: tt('share'),
      onSelect: () => {
        const lang = appSettings.get().language;
        void shareText(buildShareText([a], { title: session.record.title, author: session.record.authors.join(', '), withChapter: annoSettings.get().shareWithChapter, lang }), session.record.title);
      },
    };
    const del = {
      label: tt('delete'),
      onSelect: async () => {
        await removeAnnotation(a.id);
        if (a.kind === 'highlight') await removeHlAllByText(session.bookId, a.text);
        toast(tt('deleted'));
      },
    };
    const all = { label: tt('deleteAll'), onSelect: () => void deleteAllInList() };
    const menu =
      a.kind === 'bookmark'
        ? [{ label: tt('edit'), onSelect: () => void editBookmark(a) }, del, all]
        : a.note
          ? [share, { label: tt('edit'), onSelect: () => void openEditNote(session, a) }, del, all]
          : [share, del, all];
    popupMenu(Math.max(8, r.right - 190), r.bottom, menu);
  };

  const chips: { f: AnnotFilter; label: string }[] = [
    { f: 0, label: tt('all') },
    { f: 1, label: tt('bookmark') },
    { f: 2, label: tt('note') },
    { f: 3, label: tt('highlight') },
  ];

  return (
    <>
      <div className={css.annotBar}>
        <IconButton label={tt('search')} active={searching} onClick={() => (setSearching((v) => !v), setKw(''))} style={{ width: 34, height: 34 }}>
          <Search size={17} />
        </IconButton>
        <div className={feat.chips} style={{ padding: 0, flex: 1 }}>
          {chips.map((c) => (
            <button key={c.f} type="button" className={feat.chip} data-active={filter === c.f ? 'true' : undefined} data-testid={`filter-${c.f}`} onClick={() => tocSettings.set({ annotFilter: c.f })}>
              {c.label}
            </button>
          ))}
        </div>
        <IconButton
          label={tt('export')}
          onClick={() => {
            const chosen = sel.size ? items.filter((a) => sel.has(a.id)) : list;
            void openExportMenu(session, chosen, sel.size, items);
          }}
          style={{ width: 34, height: 34 }}
        >
          <Download size={17} />
        </IconButton>
        <IconButton label={tt('options')} onClick={() => void openOptions()} style={{ width: 34, height: 34 }}>
          <Settings2 size={17} />
        </IconButton>
      </div>
      {colors.length > 1 && (
        <div className={css.annotBar} style={{ gap: 8, padding: '6px 12px' }}>
          <span className={feat.muted}>{tt('colorFilter')}</span>
          {colors.map((c) => (
            <button key={c} type="button" className={css.colorDot} style={{ background: c }} data-active={color === c ? 'true' : undefined} aria-label={c} onClick={() => setColor(color === c ? null : c)} />
          ))}
        </div>
      )}
      {searching && (
        <div className={css.searchBox}>
          <input autoFocus className={css.searchInput} placeholder={tt('searchHint')} value={kw} onChange={(e) => setKw(e.target.value)} data-testid="annot-search" />
        </div>
      )}
      {selecting && (
        <div className={css.annotBar} style={{ justifyContent: 'space-between' }}>
          <span>{tt('selectedN', { n: sel.size })}</span>
          <button type="button" className={feat.chip} onClick={exitSelect}>
            {tt('cancelSelect')}
          </button>
        </div>
      )}
      <div className={css.annotList} data-testid="annot-list">
        {list.length === 0 ? (
          <div className={feat.empty}>{items.length === 0 ? tt('noBookmark') : tt('noMatch')}</div>
        ) : (
          list.map((a, i) => (
            <ItemRow
              key={a.id}
              a={a}
              n={i + 1}
              kw={kw}
              selecting={selecting}
              selected={sel.has(a.id)}
              onOpen={() => {
                onClose();
                pushLinkBackHere(session.controller); // 原版目录对话框（PrefChapters.onGetChapter）跳转前都压回退栈
                void goToAnnotation(session, a);
              }}
              onToggle={() =>
                setSel((s) => {
                  const n = new Set(s);
                  if (n.has(a.id)) n.delete(a.id);
                  else n.add(a.id);
                  return n;
                })
              }
              onLong={() => {
                setSelecting(true);
                setSel((s) => new Set(s).add(a.id));
              }}
              onMenu={(el) => openMenu(a, el)}
            />
          ))
        )}
      </div>
      <AddBookmarkFooter session={session} />
    </>
  );
}

import { openOverlay } from '@/ui';
function openOptions() {
  openOverlay((close) => <OptionsDialog close={close} />);
}

/** 底部「增加新书签」：长按 = 不命名直接加 */
function AddBookmarkFooter({ session }: { session: ReaderSession }) {
  const lp = useLongPress(() => void toggleBookmark(session, { silent: true, addOnly: true }));
  return (
    <div style={{ flex: 'none', borderTop: '1px solid var(--mr-border)', padding: '8px 10px', display: 'flex', justifyContent: 'center' }}>
      <button
        type="button"
        className={css.footerBtn}
        data-testid="add-bookmark"
        {...lp.bind}
        onClick={() => {
          if (lp.consumed()) return;
          void toggleBookmark(session, { addOnly: true });
        }}
      >
        + {tt('addNewBookmark')}
      </button>
    </div>
  );
}
