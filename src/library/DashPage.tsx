// 首页 Dash（LIB-003）：6 行横向卡片——最近阅读、我的珍藏、我的文件、网上书库、书签、阅读统计
import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Cloud, Folder, Heart, MoreVertical, Plus, RefreshCcw, Server } from 'lucide-react';
import { IconButton, chooseDialog, confirmDialog, popupMenu } from '@/ui';
import { navigate } from '@/core/router';
import { dbEvents, listAllAnnotations, listPositions, listStats } from '@/storage/db';
import type { BookRecord } from '@/core/library';
import { BookCover } from './BookCover';
import { TopBar } from './TopBar';
import { recentBooks, useLibrary } from './data';
import { DEFAULT_FAV, filesSettings, shelfSettings, syncSettings } from './settings';
import { openBook } from './open';
import { catalogTitle, useCatalogs } from './catalogs';
import { computeStatCards, type StatCards } from './stats';
import { clearAllStatistics } from './actions';
import { openCloudImport } from './files/CloudImport';
import { openFavFolders } from './files/FavFolders';
import { openImportDialog } from './ImportDialogs';
import { showBookMenu } from './book-menu';
import { suggestFor } from './shelf-model';
import { RemoteRecentCard } from './RemoteRecent';
import { t } from './i18n';
import s from './library.module.css';

/** 8 张统计卡片的数据（Dash 与统计页共用） */
export function useStatCards(): StatCards {
  const lib = useLibrary();
  const [data, setData] = useState<{ stats: Awaited<ReturnType<typeof listStats>>; positions: number }>({ stats: [], positions: 0 });
  useEffect(() => {
    let live = true;
    const load = () => void Promise.all([listStats(), listPositions()]).then(([stats, p]) => live && setData({ stats, positions: p.length }));
    load();
    const off = dbEvents.on('change', (e) => (e.store === 'stats' || e.store === 'positions') && load());
    return () => {
      live = false;
      off();
    };
  }, []);
  return computeStatCards(lib.books, data.stats, data.positions);
}

export function StatCardsGrid({ cards, onBooks, onRead }: { cards: StatCards; onBooks?: () => void; onRead?: () => void }) {
  const items: { label: string; value: string; onClick?: () => void }[] = [
    { label: t('statBooks'), value: String(cards.books), onClick: onBooks },
    { label: t('statRead'), value: String(cards.readBooks), onClick: onRead },
    { label: t('statHours'), value: cards.hours.toFixed(1) },
    { label: t('statPages'), value: String(cards.pages) },
    { label: t('statHoursDay'), value: cards.hoursPerDay.toFixed(1) },
    { label: t('statSecPage'), value: String(Math.round(cards.secPerPage)) },
    { label: t('statPagesHour'), value: String(Math.round(cards.pagesPerHour)) },
    { label: t('statWordsMin'), value: String(Math.round(cards.wordsPerMinute)) },
  ];
  return (
    <div className={s.statGrid}>
      {items.map((it) => (
        <button key={it.label} className={s.statCard} data-click={it.onClick ? 'true' : undefined} onClick={it.onClick}>
          <b>{it.value}</b>
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/** 「清空全部阅读统计」确认（STAT-005） */
export async function confirmClearStats(): Promise<void> {
  let alsoRecent = false;
  const ok = await confirmDialog(
    <div>
      <div>{t('clearAllStatsConfirm')}</div>
      <label style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-start' }}>
        <input type="checkbox" onChange={(e) => (alsoRecent = e.target.checked)} style={{ marginTop: 3 }} />
        <span>{t('clearRecentToo')}</span>
      </label>
    </div>,
    { title: t('clearAllStats') },
  );
  if (ok) await clearAllStatistics(alsoRecent);
}

function Row(props: { title: string; icon?: ReactNode; onMore?: () => void; head?: ReactNode; children: ReactNode; moreLabel?: string }) {
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        {props.icon}
        <h3>{props.title}</h3>
        {props.head}
        {props.onMore && (
          <button className={s.moreBtn} onClick={props.onMore}>
            {props.moreLabel ?? t('more')} ›
          </button>
        )}
      </div>
      {props.children}
    </div>
  );
}

function CoverStrip({ books, ctx }: { books: BookRecord[]; ctx: 'recent' | 'recent-fav' }) {
  const size = shelfSettings.use((x) => x.recentCoverSize);
  const gauge = shelfSettings.use((x) => x.coverWithProgress);
  return (
    <div className={s.hscroll}>
      {books.map((b) => (
        <div
          key={b.id}
          className={s.hitem}
          data-book-id={b.id}
          style={{ width: Math.max(64, size) }}
          onClick={() => void openBook(b.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            showBookMenu(b, e.clientX, e.clientY, ctx);
          }}
        >
          <BookCover book={b} gauge={gauge} />
          <div className={s.cap}>{b.title}</div>
        </div>
      ))}
    </div>
  );
}

export function DashPage() {
  const lib = useLibrary();
  const catalogs = useCatalogs();
  const cards = useStatCards();
  const favName = shelfSettings.use((x) => x.recentFavName);
  const favFolders = filesSettings.use((x) => x.favFolders);
  const showDav = filesSettings.use((x) => x.showDavInFavorites) && syncSettings.use((x) => x.enabled);
  const [noteBooks, setNoteBooks] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    const load = () =>
      void listAllAnnotations().then((all) => {
        if (!live) return;
        const latest = new Map<string, number>();
        for (const a of all) latest.set(a.bookId, Math.max(latest.get(a.bookId) ?? 0, a.updatedAt));
        setNoteBooks([...latest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id));
      });
    load();
    const off = dbEvents.on('change', (e) => e.store === 'annotations' && load());
    return () => {
      live = false;
      off();
    };
  }, []);

  const recent = recentBooks(lib).slice(0, 24);
  const favBooks = lib.books.filter((b) => b.onShelf !== false && (b.favorite ?? '') === (favName || DEFAULT_FAV));
  const noteList = noteBooks.map((id) => lib.byId.get(id)).filter((b): b is BookRecord => !!b);

  const chooseFav = async () => {
    const names = [...new Set(lib.books.filter((b) => b.onShelf !== false).map((b) => b.favorite ?? '').filter(Boolean))];
    if (!names.includes(DEFAULT_FAV)) names.unshift(DEFAULT_FAV);
    const v = await chooseDialog<string>(
      t('chooseFavorite'),
      names.map((n) => ({ value: n, label: n === DEFAULT_FAV ? t('defaultFav') : n })),
    );
    if (v) shelfSettings.set({ recentFavName: v });
  };

  return (
    <>
      <TopBar
        title={t('appTitle')}
        search={{
          scope: 'dash',
          value: '',
          onChange: () => undefined,
          suggest: (q) =>
            suggestFor(lib.books.filter((b) => b.onShelf !== false), q).map((x, i) => ({
              key: `${i}`,
              label: x.text,
              sub: x.sub,
              onPick: () => x.bookId && void openBook(x.bookId),
            })),
        }}
        actions={
          <IconButton
            label={t('more')}
            onClick={(e) =>
              popupMenu(e.clientX - 160, e.clientY, [
                { label: t('importBooks'), onSelect: openImportDialog },
                { label: t('continueReading'), onSelect: () => lib.history[0] && void openBook(lib.history[0].bookId) },
                { label: t('simpleRecent'), onSelect: () => shelfSettings.set({ simpleRecentList: true }) },
                { label: t('about'), onSelect: () => navigate('about') },
              ])
            }
          >
            <MoreVertical size={21} />
          </IconButton>
        }
      />
      <div className={s.content}>
        <RemoteRecentCard />
        <Row title={t('dashRecent')} onMore={() => navigate('recent')}>
          {recent.length ? (
            <CoverStrip books={recent} ctx="recent" />
          ) : (
            <div className={`${s.pad} ${s.dim}`} style={{ fontSize: 13 }}>
              {t('emptyRecent')}{' '}
              <button className={s.moreBtn} onClick={openImportDialog}>
                <Plus size={13} style={{ verticalAlign: -2 }} /> {t('importBooks')}
              </button>
            </div>
          )}
        </Row>
        <Row
          title={t('dashFavorites')}
          head={
            <IconButton label={t('chooseFavorite')} onClick={() => void chooseFav()}>
              <Heart size={18} />
            </IconButton>
          }
          onMore={() => {
            shelfSettings.set({ category: 1, subCollection: favName || DEFAULT_FAV, subAuthor: '' });
            navigate('shelf');
          }}
        >
          {favBooks.length > 0 && <CoverStrip books={favBooks} ctx="recent-fav" />}
        </Row>
        <Row
          title={t('dashFiles')}
          head={
            <IconButton label={t('filesFavorites')} onClick={openFavFolders}>
              <Folder size={18} />
            </IconButton>
          }
          onMore={() => navigate('files')}
        >
          {(favFolders.length > 0 || showDav) && (
            <div className={s.hscroll}>
              {showDav && (
                <button className={s.tag} style={{ border: 'none', cursor: 'pointer', fontSize: 13, padding: '6px 12px', flex: 'none' }} onClick={openCloudImport}>
                  <Cloud size={13} /> [WebDav]
                </button>
              )}
              {favFolders.map((p) => (
                <button key={p} className={s.tag} style={{ border: 'none', cursor: 'pointer', fontSize: 13, padding: '6px 12px', flex: 'none' }} onClick={() => navigate('files', { path: p })}>
                  <Folder size={13} /> {p.split('/').filter(Boolean).pop() ?? t('filesRoot')}
                </button>
              ))}
            </div>
          )}
        </Row>
        <Row title={t('dashNet')} onMore={() => navigate('net')}>
          <div className={s.hscroll}>
            {catalogs.map((c) => (
              <div key={c.id} className={s.hitem} style={{ width: 72 }} onClick={() => navigate('net', c.id)}>
                <div style={{ width: 56, height: 56, margin: '0 auto', borderRadius: 14, background: 'var(--mr-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 }}>
                  {c.html ? <Server size={26} /> : catalogTitle(c)[0]?.toUpperCase() || <Cloud />}
                </div>
                <div className={s.cap}>{catalogTitle(c)}</div>
              </div>
            ))}
          </div>
        </Row>
        <Row title={t('dashBookmarks')} onMore={() => navigate('notes')}>
          {noteList.length > 0 && (
            <div className={s.hscroll}>
              {noteList.slice(0, 24).map((b) => (
                <div key={b.id} className={s.hitem} onClick={() => navigate('notes', b.id)}>
                  <BookCover book={b} />
                  <div className={s.cap}>{b.title}</div>
                </div>
              ))}
            </div>
          )}
        </Row>
        <Row
          title={t('dashStats')}
          icon={<BarChart3 size={18} />}
          head={
            <IconButton
              label={t('more')}
              onClick={(e) => popupMenu(e.clientX - 160, e.clientY, [{ label: t('clearAllStats'), icon: <RefreshCcw size={16} />, onSelect: () => void confirmClearStats() }])}
            >
              <MoreVertical size={18} />
            </IconButton>
          }
          onMore={() => navigate('stats')}
        >
          <StatCardsGrid cards={cards} onBooks={() => navigate('shelf')} onRead={() => navigate('recent')} />
        </Row>
        <div style={{ height: 90 }} />
      </div>
    </>
  );
}
