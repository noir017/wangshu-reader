// 书的三种展示：网格、列表、封面流（LIB-007），以及长按多选、⋮ 菜单、长按拖拽排序（LIB-018）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MoreVertical, Star } from 'lucide-react';
import type { BookRecord } from '@/core/library';
import { BookCover } from './BookCover';
import { useElementWidth, useLongPress, type Selection } from './interactions';
import { formatPercent } from './format';
import { authorText, seriesText } from './shelf-model';
import { shelfSettings } from './settings';
import { DEFAULT_FAV } from './settings';
import { t } from './i18n';
import s from './library.module.css';

export interface BooksViewProps {
  books: BookRecord[];
  style: 0 | 1 | 2;
  selection: Selection;
  onOpen: (b: BookRecord) => void;
  /** ⋮ 菜单（x,y 为点击位置） */
  onMenu: (b: BookRecord, x: number, y: number) => void;
  /** 网格用木纹背景的书架底板 */
  wood?: boolean;
  /** 封面上画进度圆环 */
  gauge?: boolean;
  /** 列表/最近阅读用的额外描述行 */
  detail?: (b: BookRecord) => ReactNode;
  /** 封面宽度(px)；默认读设置 */
  coverSize?: number;
  /** 拖拽排序：启用时长按一本书后可拖动；返回 true 表示已处理 */
  dragEnabled?: boolean;
  onDragMove?: (bookId: string, targetIndex: number) => void;
  onDragRejected?: () => void;
  /** 列表里显示收藏夹/系列等「书架」信息；最近阅读页不显示 */
  showShelfInfo?: boolean;
}

export function BooksView(props: BooksViewProps) {
  const sel = props.selection;
  const [drag, setDrag] = useState<{ id: string; drop: number | null } | null>(null);
  const dropRef = useRef<number | null>(null);
  const idx = useMemo(() => new Map(props.books.map((b, i) => [b.id, i])), [props.books]);

  const beginDrag = (id: string) => {
    if (!props.onDragMove) return;
    if (!props.dragEnabled) return;
    const from = idx.get(id) ?? -1;
    dropRef.current = null;
    setDrag({ id, drop: null });
    const point = (ev: PointerEvent | TouchEvent): { x: number; y: number } | undefined => {
      if ('touches' in ev) return ev.touches[0] ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : undefined;
      return { x: ev.clientX, y: ev.clientY };
    };
    const move = (ev: PointerEvent | TouchEvent) => {
      const p = point(ev);
      if (!p) return;
      const el = document.elementFromPoint(p.x, p.y)?.closest('[data-idx]') as HTMLElement | null;
      const di = el ? Number(el.dataset.idx) : null;
      if (di !== dropRef.current) {
        dropRef.current = di;
        setDrag({ id, drop: di });
      }
      if ('touches' in ev && ev.cancelable) ev.preventDefault();
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('touchend', end);
      const to = dropRef.current;
      setDrag(null);
      if (to !== null && to !== from) props.onDragMove!(id, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('touchend', end);
  };

  const common = {
    selection: sel,
    onOpen: props.onOpen,
    onMenu: props.onMenu,
    gauge: props.gauge,
    onLong: (b: BookRecord) => {
      sel.add(b.id);
      if (props.dragEnabled) beginDrag(b.id);
    },
    drag,
  };
  if (props.style === 2) return <CoverFlow {...props} />;
  if (props.style === 0 || props.detail) {
    return <ListView {...props} {...common} />;
  }
  return <GridView {...props} {...common} />;
}

type CellCommon = Pick<BooksViewProps, 'selection' | 'onOpen' | 'onMenu' | 'gauge'> & { onLong: (b: BookRecord) => void; drag: { id: string; drop: number | null } | null };

function clickHandler(selection: Selection, book: BookRecord, onOpen: (b: BookRecord) => void) {
  return (e: React.PointerEvent | React.MouseEvent) => {
    if (selection.active || e.ctrlKey || e.metaKey || e.shiftKey) selection.toggle(book.id);
    else onOpen(book);
  };
}

// ───────────── 网格 ─────────────
function GridView(props: BooksViewProps & CellCommon) {
  const [ref, w] = useElementWidth<HTMLDivElement>();
  const size = props.coverSize ?? shelfSettings.use((st) => st.shelfCoverSize);
  const font = shelfSettings.use((st) => st.shelfFontSize);
  const bold = shelfSettings.use((st) => st.shelfBoldFont);
  const tablet = (globalThis.screen?.width ?? 400) >= 600;
  const cols = Math.max(2, Math.round((w || 360) / (size * (tablet ? 1.36 : 1.1))));
  return (
    <div ref={ref} className={s.grid} style={{ ['--cols' as string]: cols, ['--cover-w' as string]: `${size}px`, ['--font' as string]: `${font}px`, fontWeight: bold ? 700 : undefined }}>
      {props.books.map((b, i) => (
        <GridCell key={b.id} book={b} index={i} {...props} />
      ))}
    </div>
  );
}

function GridCell(props: CellCommon & { book: BookRecord; index: number }) {
  const { book, selection } = props;
  const lp = useLongPress({ onClick: clickHandler(selection, book, props.onOpen), onLong: () => props.onLong(book) });
  return (
    <div
      className={s.cell}
      data-idx={props.index}
      data-id={book.id}
      data-dragging={props.drag?.id === book.id ? 'true' : undefined}
      data-drop={props.drag && props.drag.drop === props.index && props.drag.id !== book.id ? 'true' : undefined}
      {...lp}
    >
      <BookCover book={book} gauge={props.gauge} selected={selection.ids.has(book.id)} />
      <div className={s.cellTitle}>{book.title}</div>
      <button
        className={s.cellMore}
        aria-label={t('itemActions')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          props.onMenu(book, e.clientX, e.clientY);
        }}
      >
        <MoreVertical size={15} />
      </button>
    </div>
  );
}

// ───────────── 列表 ─────────────
function ListView(props: BooksViewProps & CellCommon) {
  const [ref, w] = useElementWidth<HTMLDivElement>();
  const size = props.coverSize ?? shelfSettings.use((st) => st.shelfCoverSize);
  const font = shelfSettings.use((st) => st.shelfFontSize);
  const bold = shelfSettings.use((st) => st.shelfBoldFont);
  const cols = w >= 1100 ? 3 : w >= 720 ? 2 : 1;
  const coverW = Math.round(Math.min(size, 120) * 0.7 + 22);
  return (
    <div ref={ref} className={s.list} style={{ ['--cols' as string]: cols, ['--cover-w' as string]: `${coverW}px`, ['--font' as string]: `${font}px` }}>
      {props.books.map((b, i) => (
        <ListItem key={b.id} book={b} index={i} bold={bold} {...props} />
      ))}
    </div>
  );
}

function ListItem(props: CellCommon & BooksViewProps & { book: BookRecord; index: number; bold: boolean }) {
  const { book, selection } = props;
  const lp = useLongPress({ onClick: clickHandler(selection, book, props.onOpen), onLong: () => props.onLong(book) });
  const series = seriesText(book);
  const fav = book.favorite;
  return (
    <div
      className={s.item}
      data-idx={props.index}
      data-id={book.id}
      data-selected={selection.ids.has(book.id) ? 'true' : undefined}
      data-dragging={props.drag?.id === book.id ? 'true' : undefined}
      data-drop={props.drag && props.drag.drop === props.index && props.drag.id !== book.id ? 'true' : undefined}
      {...lp}
    >
      <div className={s.itemCover}>
        <BookCover book={book} gauge={props.gauge} selected={selection.ids.has(book.id)} />
      </div>
      <div className={s.itemBody}>
        <div className={`${s.itemTitle} ${props.bold ? s.itemBold : ''}`}>{book.title}</div>
        {authorText(book) && <div className={s.itemAuthor}>{authorText(book)}</div>}
        {props.showShelfInfo !== false && (series || fav) && (
          <div className={s.itemMeta}>
            {series && <span>{series}</span>}
            {fav && (
              <span className={s.fav}>
                <Star size={11} style={{ verticalAlign: -1 }} /> {fav === DEFAULT_FAV ? t('defaultFav') : fav}
              </span>
            )}
          </div>
        )}
        {props.detail?.(book)}
        {!props.detail && book.description && <div className={s.itemDesc}>{book.description}</div>}
        <div className={s.itemProg}>
          <div className={s.progressLine}>
            <div style={{ width: `${(book.progress ?? 0) * 100}%` }} />
          </div>
          <span>{formatPercent(book.progress)}</span>
        </div>
      </div>
      <div className={s.itemRight}>
        <button
          className={s.cellMore}
          style={{ opacity: 1, background: 'transparent', color: 'var(--mr-muted)' }}
          aria-label={t('itemActions')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            props.onMenu(book, e.clientX, e.clientY);
          }}
        >
          <MoreVertical size={18} />
        </button>
      </div>
    </div>
  );
}

// ───────────── 封面流（P2）：scroll-snap + 按距离做 3D 倾斜 ─────────────
function CoverFlow(props: BooksViewProps) {
  const { books } = props;
  const [ref, w] = useElementWidth<HTMLDivElement>();
  const trackRef = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState(0);
  const itemW = Math.min(180, Math.max(110, Math.round((w || 360) * 0.42)));
  const update = () => {
    const el = trackRef.current;
    if (!el) return;
    setCenter(el.scrollLeft / itemW);
  };
  useEffect(() => {
    update();
  }, [itemW, books.length]);
  const cur = Math.max(0, Math.min(books.length - 1, Math.round(center)));
  const book = books[cur];
  const lp = useLongPress({ onClick: () => book && (props.selection.active ? props.selection.toggle(book.id) : props.onOpen(book)), onLong: () => book && props.selection.add(book.id) });
  return (
    <div className={s.flow} ref={ref}>
      <div className={s.flowStage}>
        <div ref={trackRef} className={s.flowTrack} style={{ ['--w' as string]: `${itemW}px` }} onScroll={update}>
          {books.map((b, i) => {
            const d = i - center;
            const ad = Math.min(Math.abs(d), 3);
            const style: React.CSSProperties = {
              transform: `rotateY(${Math.max(-1, Math.min(1, d)) * -55}deg) scale(${1 - ad * 0.12}) translateZ(${-ad * 20}px)`,
              opacity: 1 - ad * 0.18,
              zIndex: 10 - Math.round(ad),
              marginLeft: d < -0.5 ? -itemW * 0.25 : 0,
              marginRight: d > 0.5 ? -itemW * 0.25 : 0,
            };
            return (
              <div
                key={b.id}
                className={s.flowItem}
                style={style}
                onClick={() => {
                  if (i !== cur) trackRef.current?.scrollTo({ left: i * itemW, behavior: 'smooth' });
                }}
              >
                <BookCover book={b} gauge={props.gauge} selected={props.selection.ids.has(b.id)} />
              </div>
            );
          })}
        </div>
      </div>
      {book && (
        <div className={s.flowInfo} {...lp} style={{ cursor: 'pointer' }}>
          <div className={s.t}>{book.title}</div>
          <div className={s.s}>
            {t('flowPos', { i: cur + 1, n: books.length })}
            {authorText(book) ? ` · ${authorText(book)}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
