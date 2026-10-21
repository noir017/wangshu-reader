// 最近阅读完整列表（LIB-004）
import { useEffect, useMemo, useState } from 'react';
import { Heart, Info, MoreVertical, Trash2 } from 'lucide-react';
import { IconButton, popupMenu } from '@/ui';
import { dbEvents, listStats, type StatRecord } from '@/storage/db';
import { BooksView } from './BookViews';
import { TopBar } from './TopBar';
import { recentBooks, useLibrary } from './data';
import { useSelection } from './interactions';
import { bookHasKey, suggestFor } from './shelf-model';
import { addToFavoriteFlow, removeFlow, showBookMenu } from './book-menu';
import { openBookInfo } from './BookInfo';
import { openBook } from './open';
import { Empty } from './ui-kit';
import { openImportDialog } from './ImportDialogs';
import { dateRange, bookSpeed } from './stats';
import { shelfSettings } from './settings';
import { RemoteRecentCard } from './RemoteRecent';
import { t } from './i18n';
import s from './library.module.css';

export function useStatsMap(): Map<string, StatRecord> {
  const [m, setM] = useState<Map<string, StatRecord>>(new Map());
  useEffect(() => {
    let live = true;
    const load = () => void listStats().then((l) => live && setM(new Map(l.map((x) => [x.bookId, x]))));
    load();
    const off = dbEvents.on('change', (e) => e.store === 'stats' && load());
    return () => {
      live = false;
      off();
    };
  }, []);
  return m;
}

export function RecentPage({ start }: { start?: boolean }) {
  const lib = useLibrary();
  const stats = useStatsMap();
  const sel = useSelection();
  const [q, setQ] = useState('');
  const size = shelfSettings.use((x) => x.recentCoverSize);
  const gauge = shelfSettings.use((x) => x.coverWithProgress);
  const all = useMemo(() => recentBooks(lib), [lib.history, lib.byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = q ? all.filter((b) => bookHasKey(b, q)) : all;
  const selected = shown.filter((b) => sel.ids.has(b.id));

  const detail = (b: (typeof shown)[number]) => {
    const st = stats.get(b.id);
    const sp = bookSpeed(st);
    const parts = [st && st.usedMs > 0 ? `${(st.usedMs / 3_600_000).toFixed(2)} ${t('hoursUnit')}${sp ? `, ${sp} ${t('wpmUnit')}` : ''}` : '', dateRange(st)].filter(Boolean);
    return (
      <>
        {b.format === 'pdf' && b.fileName.replace(/\.pdf$/i, '') !== b.title && <div className={s.itemMeta}>({b.fileName})</div>}
        {parts.length > 0 && <div className={s.itemMeta}>{parts.map((p, i) => <span key={i}>{p}</span>)}</div>}
        {b.description && <div className={s.itemDesc}>#{b.description}</div>}
      </>
    );
  };

  return (
    <>
      <TopBar
        title={start ? t('appTitle') : t('tabRecent')}
        nav={start ? 'menu' : 'back'}
        search={{
          scope: 'dash',
          value: q,
          onChange: setQ,
          suggest: (k) => (all.length < 200 ? suggestFor(all, k).map((x, i) => ({ key: String(i), label: x.text, sub: x.sub, onPick: () => x.bookId && void openBook(x.bookId) })) : []),
        }}
        selecting={
          sel.active
            ? {
                count: sel.ids.size,
                onCancel: sel.clear,
                actions: (
                  <>
                    {selected.length === 1 && (
                      <IconButton label={t('bookInfo')} onClick={() => openBookInfo(selected[0].id)}>
                        <Info size={21} />
                      </IconButton>
                    )}
                    <IconButton label={t('addFavorite')} onClick={() => void addToFavoriteFlow([...sel.ids]).then(sel.clear)}>
                      <Heart size={21} />
                    </IconButton>
                    <IconButton label={t('delete')} onClick={() => void removeFlow(selected, 'recent').then((ok) => ok && sel.clear())}>
                      <Trash2 size={21} />
                    </IconButton>
                    <IconButton label={t('more')} onClick={(e) => popupMenu(e.clientX - 160, e.clientY, [{ label: t('selectAll'), onSelect: () => sel.setAll(shown.map((b) => b.id)) }])}>
                      <MoreVertical size={21} />
                    </IconButton>
                  </>
                ),
              }
            : undefined
        }
        actions={
          start ? (
            <IconButton
              label={t('more')}
              onClick={(e) => popupMenu(e.clientX - 180, e.clientY, [{ label: t('simpleRecent'), onSelect: () => shelfSettings.set({ simpleRecentList: false }) }, { label: t('importBooks'), onSelect: openImportDialog }])}
            >
              <MoreVertical size={21} />
            </IconButton>
          ) : undefined
        }
      />
      <div className={s.content}>
        <RemoteRecentCard />
        {!lib.loaded ? null : shown.length === 0 ? (
          <Empty text={q ? t('noMatch') : t('emptyRecent')}>
            {!q && (
              <button className={s.moreBtn} onClick={openImportDialog}>
                {t('importBooks')}
              </button>
            )}
          </Empty>
        ) : (
          <div style={{ paddingBottom: 90 }}>
            <BooksView
              books={shown}
              style={0}
              selection={sel}
              onOpen={(b) => void openBook(b.id)}
              onMenu={(b, x, y) => showBookMenu(b, x, y, 'recent')}
              gauge={gauge}
              detail={detail}
              coverSize={size}
              showShelfInfo={false}
            />
          </div>
        )}
      </div>
    </>
  );
}
