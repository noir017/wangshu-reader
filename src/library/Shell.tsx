// 书架模块的外壳：抽屉/侧栏 + 路由到各页 + 全局拖放导入 + 启动密码 + 继续阅读浮动按钮。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { Sheet } from '@/ui';
import { back, navigate, type Route } from '@/core/router';
import { DrawerContent } from './Drawer';
import { ShellContext } from './shell-context';
import { LockScreen, isUnlocked } from './lock';
import { useApplyUiTheme } from './theme';
import { shelfSettings } from './settings';
import { useLibrary } from './data';
import { importDropped } from './ImportDialogs';
import { runStartup } from './startup';
import { openBook } from './open';
import { DashPage } from './DashPage';
import { RecentPage } from './RecentPage';
import { ShelfPage } from './ShelfPage';
import { FilesPage } from './files/FilesPage';
import { NetPage } from './net/NetPage';
import { NotesPage } from './NotesPage';
import { StatsPage } from './StatsPage';
import { SettingsPage } from './settings/SettingsPage';
import { AboutPage } from './AboutPage';
import { t } from './i18n';
import s from './library.module.css';

const FAB_ROUTES = new Set(['', 'recent', 'shelf', 'files', 'net']);

export function LibraryShell({ route }: { route: Route }) {
  useApplyUiTheme();
  const [drawer, setDrawer] = useState(false);
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [dropping, setDropping] = useState(false);
  const lib = useLibrary();
  const hideFab = shelfSettings.use((x) => x.hideFab);
  const simpleRecent = shelfSettings.use((x) => x.simpleRecentList);

  useEffect(() => runStartup(route.name), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 整页拖放导入：拖文件/文件夹进窗口即可
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDropping(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (--depth <= 0) {
        depth = 0;
        setDropping(false);
      }
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      void importDropped(e.dataTransfer!);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const ctx = useMemo(
    () => ({
      openDrawer: () => setDrawer(true),
      goBack: () => back(),
    }),
    [],
  );
  const closeDrawer = useCallback(() => setDrawer(false), []);

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;

  const last = lib.history[0]?.bookId;
  let page: React.ReactNode;
  switch (route.name) {
    case 'recent':
      page = <RecentPage />;
      break;
    case 'shelf':
      page = <ShelfPage />;
      break;
    case 'files':
      page = <FilesPage route={route} />;
      break;
    case 'net':
      page = <NetPage route={route} />;
      break;
    case 'notes':
      page = <NotesPage bookId={route.params[0]} />;
      break;
    case 'stats':
      page = <StatsPage />;
      break;
    case 'settings':
      page = <SettingsPage section={route.params[0]} />;
      break;
    case 'about':
      page = <AboutPage />;
      break;
    default:
      page = simpleRecent ? <RecentPage start /> : <DashPage />;
  }

  return (
    <ShellContext.Provider value={ctx}>
      <div className={s.root}>
        <aside className={s.sidebar}>
          <DrawerContent route={route.name} onGo={closeDrawer} />
        </aside>
        <Sheet open={drawer} onClose={closeDrawer} position="left">
          <DrawerContent route={route.name} onGo={closeDrawer} />
        </Sheet>
        <div className={s.main}>
          {page}
          {!hideFab && last && FAB_ROUTES.has(route.name) && (
            <button className={s.fab} aria-label={t('continueReading')} title={t('continueReading')} onClick={() => void openBook(last)}>
              <Play size={24} fill="currentColor" />
            </button>
          )}
          {dropping && <div className={s.dropHint}>{t('importDrop')}</div>}
        </div>
      </div>
    </ShellContext.Provider>
  );
}

void navigate;
