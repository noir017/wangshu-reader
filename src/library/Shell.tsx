// 书架模块的外壳：抽屉/侧栏 + 路由到各页 + 全局拖放导入 + 启动密码 + 继续阅读浮动按钮。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { autoImportNow } from './linked-dirs';
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
/** 五个标签页（首页/书架/文件/网上书库/书签），LIB-001 记住最后停留的一个 */
const TAB_ROUTES = new Set(['', 'shelf', 'files', 'net', 'notes']);

export function LibraryShell({ route }: { route: Route }) {
  useApplyUiTheme();
  const [drawer, setDrawer] = useState(false);
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [dropping, setDropping] = useState(false);
  const lib = useLibrary();
  const hideFab = shelfSettings.use((x) => x.hideFab);
  const simpleRecent = shelfSettings.use((x) => x.simpleRecentList);

  // 冷启动回到上次的标签页（原 lastDash）：只在地址里没有路由时恢复；读的是挂载时的值，随后才开始记录新的
  const startTab = useRef(shelfSettings.get().lastTab);
  useEffect(() => {
    runStartup(route.name);
    const h = globalThis.location.hash;
    if ((h === '' || h === '#' || h === '#/') && startTab.current && startTab.current !== route.name && TAB_ROUTES.has(startTab.current)) {
      navigate(startTab.current);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (TAB_ROUTES.has(route.name) && route.name !== startTab.current) {
      shelfSettings.set({ lastTab: route.name });
      startTab.current = '';
    }
  }, [route.name]);

  // 自动导入已链接目录里的新书（LIB-024）：进入书架、窗口重新获得焦点时扫描
  useEffect(() => {
    if (route.name !== 'shelf') return;
    void autoImportNow().catch(() => undefined);
    const onFocus = () => void autoImportNow().catch(() => undefined);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [route.name]);

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

