// 左侧抽屉（LIB-002）。窄屏是滑出的 Sheet，宽屏是常驻侧栏。
import { BookMarked, BookOpen, ChevronDown, ChevronRight, Cloud, FolderOpen, Info, Library, Moon, Play, Settings, Sun, BarChart3, Star } from 'lucide-react';
import { chooseDialog } from '@/ui';
import { navigate } from '@/core/router';
import { useLibrary, recentBooks } from './data';
import { shelfSettings, DEFAULT_FAV } from './settings';
import { openBook } from './open';
import { useUiNight } from './theme';
import { t } from './i18n';
import s from './library.module.css';

export function DrawerContent(props: { route: string; onGo: () => void }) {
  const lib = useLibrary();
  const st = shelfSettings.use((x) => x);
  const night = useUiNight();
  const go = (name: string) => {
    navigate(name);
    props.onGo();
  };
  const active = (names: string[]) => names.includes(props.route);
  const favs = [...new Set(lib.books.filter((b) => b.onShelf !== false).map((b) => b.favorite ?? '').filter(Boolean))].sort((a, b) => (a === DEFAULT_FAV ? -1 : b === DEFAULT_FAV ? 1 : a.localeCompare(b)));
  const last = lib.history[0]?.bookId;

  const longRecent = async () => {
    const list = recentBooks(lib).slice(0, 100);
    if (!list.length) return;
    const id = await chooseDialog<string>(t('continueReading'), list.map((b) => ({ value: b.id, label: b.title, subtitle: b.authors.join(' & ') })));
    if (id) {
      props.onGo();
      void openBook(id);
    }
  };

  return (
    <div>
      <div className={s.drawerHead}>
        <b>{t('appTitle')}</b>
        <span>{t('appSubtitle')}</span>
      </div>
      <button className={s.drawerItem} data-active={active(['', 'recent'])} onClick={() => go('')}>
        <BookOpen size={20} /> <span className={s.grow}>{t('tabRecent')}</span>
      </button>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button className={s.drawerItem} style={{ flex: 1 }} data-active={active(['shelf'])} onClick={() => { shelfSettings.set({ category: 0, subCollection: '', subAuthor: '' }); go('shelf'); }}>
          <Library size={20} /> <span className={s.grow}>{t('tabShelf')}</span>
        </button>
        <button className={s.drawerItem} style={{ width: 48, padding: 0, justifyContent: 'center' }} aria-label={t('shelfFavorites')} onClick={() => shelfSettings.set({ favoriteOnDrawer: !st.favoriteOnDrawer })}>
          {st.favoriteOnDrawer ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>
      {st.favoriteOnDrawer &&
        favs.map((f) => (
          <button
            key={f}
            className={`${s.drawerItem} ${s.drawerSub}`}
            onClick={() => {
              shelfSettings.set({ category: 1, subCollection: f, subAuthor: '' });
              go('shelf');
            }}
          >
            <Star size={15} /> <span className={s.grow}>{f === DEFAULT_FAV ? t('defaultFav') : f}</span>
          </button>
        ))}
      <button className={s.drawerItem} data-active={active(['files'])} onClick={() => go('files')}>
        <FolderOpen size={20} /> <span className={s.grow}>{t('tabFiles')}</span>
      </button>
      <button className={s.drawerItem} data-active={active(['net'])} onClick={() => go('net')}>
        <Cloud size={20} /> <span className={s.grow}>{t('tabNet')}</span>
      </button>
      <button className={s.drawerItem} data-active={active(['notes'])} onClick={() => go('notes')}>
        <BookMarked size={20} /> <span className={s.grow}>{t('tabNotes')}</span>
      </button>
      <button className={s.drawerItem} data-active={active(['stats'])} onClick={() => go('stats')}>
        <BarChart3 size={20} /> <span className={s.grow}>{t('tabStats')}</span>
      </button>
      <div className={s.drawerSep} />
      <button
        className={s.drawerItem}
        disabled={!last}
        style={!last ? { opacity: 0.45 } : undefined}
        onClick={() => {
          if (last) {
            props.onGo();
            void openBook(last);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          void longRecent();
        }}
        title="右键 / 长按：最近 100 本"
      >
        <Play size={20} /> <span className={s.grow}>{t('continueReading')}</span>
      </button>
      <button className={s.drawerItem} data-active={active(['settings'])} onClick={() => go('settings')}>
        <Settings size={20} /> <span className={s.grow}>{t('options')}</span>
      </button>
      <button className={s.drawerItem} data-active={active(['about'])} onClick={() => go('about')}>
        <Info size={20} /> <span className={s.grow}>{t('about')}</span>
      </button>
      <button
        className={s.drawerItem}
        onClick={() => {
          shelfSettings.set({ mainNightTheme: !night, sysDarkModeFollow: false });
          props.onGo();
        }}
      >
        {night ? <Sun size={20} /> : <Moon size={20} />} <span className={s.grow}>{night ? t('dayMode') : t('nightMode')}</span>
      </button>
    </div>
  );
}
