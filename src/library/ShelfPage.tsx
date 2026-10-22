// 我的书架（LIB-006..012、017、018、027）：分类下钻、三种视图、排序过滤、搜索、多选批量、拖拽排序。
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Filter, FolderOpen, Heart, Info, MoreVertical, Pencil, Tag, Trash2, Users, Library as LibraryIcon, Layers, Tags } from 'lucide-react';
import { IconButton, popupMenu, toast, chooseDialog } from '@/ui';
import { dbEvents, getDb, getKV, listBooks } from '@/storage/db';
import { BooksView } from './BookViews';
import { TopBar } from './TopBar';
import { useLibrary } from './data';
import { useSelection } from './interactions';
import { shelfSettings, DEFAULT_FAV, type ShelfCategory } from './settings';
import { ALL_KEY, computeShelf, groupLabel, suggestFor, type Group, type ShelfView } from './shelf-model';
import { useUiNight } from './theme';
import { Empty } from './ui-kit';
import { moveBook, clearManualOrder, pickRandom } from './actions';
import { addToFavoriteFlow, readStateFlow, removeFlow, showBookMenu, tagsFlow } from './book-menu';
import { openBookInfo } from './BookInfo';
import { openShelfFilter } from './ShelfFilter';
import { askNumber, askRenameFavorite } from './dialogs';
import { openImportDialog } from './ImportDialogs';
import { openBook } from './open';
import { makeThumb, PALETTES, coverSvg } from './covers';
import { renameFavorite } from './actions';
import { t } from './i18n';
import s from './library.module.css';

const CATEGORY_NAMES = () => [t('shelfAll'), t('shelfFavorites'), t('shelfSeries'), t('shelfAuthors'), t('shelfTags'), t('shelfDirs')];

/** 木纹自选图片（日/夜各一张，存 kv） */
export function useWoodImage(night: boolean): string | undefined {
  const [url, setUrl] = useState<string>();
  const key = `library.wood.${night ? 'night' : 'day'}`;
  useEffect(() => {
    let live = true;
    let made: string | undefined;
    const load = () =>
      void getKV<Blob>(key).then((b) => {
        if (!live) return;
        if (made) URL.revokeObjectURL(made);
        made = b ? URL.createObjectURL(b) : undefined;
        setUrl(made);
      });
    load();
    const off = dbEvents.on('change', (e) => e.store === 'kv' && e.key === key && load());
    return () => {
      live = false;
      off();
      if (made) URL.revokeObjectURL(made);
    };
  }, [key]);
  return url;
}

/** 书架页的当前视图参数 */
export function useShelfView(query = ''): ShelfView {
  const st = shelfSettings.use((x) => x);
  return {
    category: st.category,
    sub: st.subCollection,
    subAuthor: st.subAuthor,
    sortBy: st.sortBy,
    filter: { states: { unread: st.filterUnread, reading: st.filterReading, finished: st.filterFinished }, allTypes: st.filterAll, types: st.filterTypes },
    query,
  };
}

export function ShelfPage() {
  const lib = useLibrary();
  const st = shelfSettings.use((x) => x);
  const night = useUiNight();
  const woodImg = useWoodImage(night);
  const [query, setQuery] = useState('');
  const sel = useSelection();
  const view = useShelfView(query);
  const result = useMemo(() => computeShelf(lib.books, lib.history, view), [lib.books, lib.history, view.category, view.sub, view.subAuthor, view.sortBy, view.query, st.filterUnread, st.filterReading, st.filterFinished, st.filterAll, st.filterTypes]); // eslint-disable-line react-hooks/exhaustive-deps
  const inFav = st.category === 1 && !!st.subCollection;
  const shown = result.groups ? [] : result.books;
  const wood = st.woody && st.shelfStyle === 1;
  const woodRes = night ? st.woodyResNight : st.woodyResDay;

  // LIB-001：首次进入书架且书架是空的，自动弹出「导入书籍」对话框（只弹一次；已有书则不弹）
  // 判空直接查库：书库状态可能还是旧快照（刚恢复完备份就进书架时，书已入库但列表还没刷新）
  useEffect(() => {
    if (!lib.loaded || st.firstShelfShown) return;
    shelfSettings.set({ firstShelfShown: true });
    void listBooks().then((all) => {
      if (all.every((b) => b.onShelf === false)) openImportDialog();
    });
  }, [lib.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // 离开分组/换分类时退出多选
  useEffect(() => sel.clear(), [st.category, st.subCollection]); // eslint-disable-line react-hooks/exhaustive-deps

  const goUp = () => {
    if (st.subCollection) shelfSettings.set({ subCollection: '', ...(st.category === 3 ? {} : {}) });
    else if (st.subAuthor) shelfSettings.set({ subAuthor: '', category: 3 });
    else if (st.category !== 0) shelfSettings.set({ category: 0, subCollection: '', subAuthor: '' });
  };
  const canUp = !!st.subCollection || !!st.subAuthor || st.category !== 0;

  const showCategories = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const names = CATEGORY_NAMES();
    const favs = [...new Set(lib.books.filter((b) => b.onShelf !== false).map((b) => b.favorite ?? '').filter(Boolean))].sort();
    popupMenu(rect.left, rect.bottom, [
      ...names.map((label, i) => ({ label, onSelect: () => shelfSettings.set({ category: i as ShelfCategory, subCollection: '', subAuthor: '' }) })),
      ...favs.filter((f) => f !== DEFAULT_FAV).map((f) => ({ label: `★ ${f}`, onSelect: () => shelfSettings.set({ category: 1, subCollection: f, subAuthor: '' }) })),
    ]);
  };

  const openGroup = (g: Group) => {
    if (st.category === 3) {
      // 作者下有系列 → 转到系列视图
      const hasSeries = lib.books.some((b) => b.onShelf !== false && b.authors.includes(g.key) && b.series?.name);
      if (hasSeries) {
        shelfSettings.set({ category: 2, subCollection: '', subAuthor: g.key });
        return;
      }
    }
    shelfSettings.set({ subCollection: g.key });
  };

  // 在分组列表里搜索联想：只联想分组名
  const suggest = (q: string) => {
    if (result.groups) {
      return result.groups.slice(0, 8).map((g) => ({ key: g.key, label: g.label, sub: `(${g.count})`, onPick: () => setQuery(g.label) }));
    }
    return suggestFor(shown.length ? shown : lib.books.filter((b) => b.onShelf !== false), q).map((x, i) => ({
      key: `${x.kind}${i}`,
      label: x.text,
      sub: x.sub,
      onPick: () => {
        if (x.kind === 'book' && x.bookId) void openBook(x.bookId);
        else {
          // 「@@作者」：转到该作者的系列/书
          shelfSettings.set({ category: 3, subCollection: '', subAuthor: '' });
          setQuery(x.text);
        }
      },
    }));
  };

  const selectedBooks = shown.filter((b) => sel.ids.has(b.id));
  const selectActions = (
    <>
      {selectedBooks.length === 1 ? (
        <>
          <IconButton label={t('editBook')} onClick={() => openBookInfo(selectedBooks[0].id)}>
            <Info size={21} />
          </IconButton>
          <IconButton label={t('addFavorite')} onClick={() => void addToFavoriteFlow([...sel.ids]).then(sel.clear)}>
            <Heart size={21} />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton label={t('addFavorite')} onClick={() => void addToFavoriteFlow([...sel.ids]).then(sel.clear)}>
            <Heart size={21} />
          </IconButton>
          <IconButton label={t('tags')} onClick={() => void tagsFlow([...sel.ids]).then(sel.clear)}>
            <Tag size={21} />
          </IconButton>
        </>
      )}
      <IconButton label={t('delete')} onClick={() => void removeFlow(selectedBooks, inFav ? 'shelf-fav' : 'shelf').then((ok) => ok && sel.clear())}>
        <Trash2 size={21} />
      </IconButton>
      <IconButton
        label={t('more')}
        onClick={(e) =>
          popupMenu(e.clientX - 160, e.clientY, [
            { label: t('readFilter'), onSelect: () => void readStateFlow([...sel.ids]).then(sel.clear) },
            { label: t('selectAll'), onSelect: () => sel.setAll(shown.map((b) => b.id)) },
          ])
        }
      >
        <MoreVertical size={21} />
      </IconButton>
    </>
  );

  const overflow = (e: React.MouseEvent) =>
    popupMenu(e.clientX - 200, e.clientY, [
      { label: t('importBooks'), onSelect: openImportDialog },
      { label: t('setDefaultCover'), onSelect: () => void chooseDefaultCover() },
      { label: t('rebuildCovers'), onSelect: () => void rebuildCovers() },
      { label: t('randomBook'), onSelect: () => { const b = pickRandom(shown); if (b) void openBook(b.id); else toast(t('noMatch')); } },
      { label: t('resetManualOrder'), onSelect: () => void clearManualOrder() },
      { label: t('selectAll'), onSelect: () => sel.setAll(shown.map((b) => b.id)) },
    ]);

  const title = inFav ? `★ ${groupLabel(1, st.subCollection)}` : CATEGORY_NAMES()[st.category];
  const subtitle = st.subCollection && !inFav ? groupLabel(st.category, st.subCollection) : st.subAuthor && !st.subCollection ? st.subAuthor : undefined;
  const totalOnShelf = lib.books.filter((b) => b.onShelf !== false).length;
  // 木纹只铺在有书的格子视图下；分组列表、空书架、无匹配时用普通背景（木纹上的浅色字配白色行看不清）
  const showWood = wood && !result.groups && shown.length > 0;

  return (
    <>
      <TopBar
        title={title}
        subtitle={subtitle}
        onTitleClick={showCategories}
        nav={canUp ? 'back' : 'menu'}
        onNav={canUp ? goUp : undefined}
        search={{ scope: 'shelf', value: query, onChange: setQuery, suggest, placeholder: t('searchBooksIn') }}
        selecting={sel.active ? { count: sel.ids.size, onCancel: sel.clear, actions: selectActions } : undefined}
        actions={
          <>
            <IconButton label={t('filterTitle')} onClick={openShelfFilter}>
              <Filter size={21} />
            </IconButton>
            <IconButton label={t('more')} onClick={overflow}>
              <MoreVertical size={21} />
            </IconButton>
          </>
        }
      />
      <div
        className={`${s.content} ${showWood ? `${s.wood} ${woodImg && woodRes === 5 ? s.wood5 : s[`wood${woodRes === 5 ? 0 : woodRes}` as 'wood0']}` : ''}`}
        style={showWood && woodRes === 5 && woodImg ? { backgroundImage: `url(${woodImg})` } : undefined}
      >
        {!lib.loaded ? null : totalOnShelf === 0 ? (
          <Empty icon={<LibraryIcon size={48} />} text={<><b>{t('emptyShelf')}</b><div>{t('emptyShelfHint')}</div></>}>
            <button className="mr-primary" style={primaryBtn} onClick={openImportDialog}>
              {t('importBooks')}
            </button>
          </Empty>
        ) : result.groups ? (
          <GroupList groups={result.groups} category={st.category} onOpen={openGroup} />
        ) : shown.length === 0 ? (
          <Empty text={t('noMatch')} />
        ) : (
          <div className={st.shelfStyle === 1 ? s.shelfBody : undefined} style={st.shelfStyle === 2 ? { height: '100%' } : undefined}>
            <BooksView
              books={shown}
              style={st.shelfStyle}
              selection={sel}
              onOpen={(b) => void openBook(b.id)}
              onMenu={(b, x, y) => showBookMenu(b, x, y, inFav ? 'shelf-fav' : 'shelf')}
              wood={wood}
              gauge={st.coverWithProgress}
              dragEnabled={st.sortBy === 0 && !query}
              onDragMove={(id, to) => void moveBook(shown, id, to)}
              coverSize={st.shelfCoverSize}
            />
          </div>
        )}
      </div>
    </>
  );
}

const primaryBtn: React.CSSProperties = { border: 'none', background: 'var(--mr-accent)', color: '#fff', padding: '10px 22px', borderRadius: 8, fontWeight: 600, fontSize: 15, cursor: 'pointer' };

function GroupList(props: { groups: Group[]; category: ShelfCategory; onOpen: (g: Group) => void }) {
  const icon = (g: Group) => (props.category === 1 ? <Heart size={18} /> : props.category === 2 ? (g.key === ALL_KEY ? <LibraryIcon size={18} /> : <Layers size={18} />) : props.category === 3 ? <Users size={18} /> : props.category === 4 ? <Tags size={18} /> : <FolderOpen size={18} />);
  return (
    <div>
      {props.groups.map((g) => (
        <div key={g.key} className={s.groupRow} onClick={() => props.onOpen(g)}>
          <span className={s.dim} style={{ display: 'flex' }}>{icon(g)}</span>
          <span className={s.grow}>{g.label}</span>
          <span className={s.cnt}>({g.count})</span>
          {props.category === 1 && g.key !== DEFAULT_FAV && (
            <button
              className={s.moreBtn}
              onClick={async (e) => {
                e.stopPropagation();
                const name = await askRenameFavorite(g.key);
                if (name !== null && name !== g.key) await renameFavorite(g.key, name);
              }}
            >
              <Pencil size={13} style={{ verticalAlign: -2 }} /> {t('rename')}
            </button>
          )}
          <ChevronDown size={16} style={{ transform: 'rotate(-90deg)', opacity: 0.5 }} />
        </div>
      ))}
    </div>
  );
}

// ───────────── 缺省封面 / 重建封面 ─────────────
async function chooseDefaultCover(): Promise<void> {
  const cur = shelfSettings.get().defaultCover;
  const v = await chooseDialog<number>(t('setDefaultCover'), [
    { value: -1, label: `${t('readAuto')}${cur === -1 ? ' ✓' : ''}` },
    ...PALETTES.map((_, i) => ({
      value: i,
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img alt="" width={36} height={52} style={{ borderRadius: 2 }} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverSvg(t('appTitle'), '', i))}`} />
          {cur === i ? '✓' : ''}
        </span>
      ),
    })),
  ]);
  if (v !== null) shelfSettings.set({ defaultCover: v });
}

/** 重新创建书籍封面（LIB-019）：用保存的原图重新生成缩略图，尺寸 40..600 */
async function rebuildCovers(): Promise<void> {
  const size = await askNumber(t('coverRebuildTitle'), t('coverSize'), shelfSettings.get().shelfCoverSize, 40, 600);
  if (size === null) return;
  shelfSettings.set({ shelfCoverSize: size });
  const db = await getDb();
  let n = 0;
  for (const b of await listBooks()) {
    const orig = await db.get('covers', [b.id, 'cover']);
    if (!orig) continue;
    await db.put('covers', { bookId: b.id, kind: 'thumb', blob: await makeThumb(orig.blob, Math.round(size * 3.2)) });
    n++;
  }
  dbEvents.emit('change', { store: 'covers' });
  toast(t('coverRebuildDone', { n }));
}

