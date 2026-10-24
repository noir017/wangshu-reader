// 动作宿主：ActionHost 的真实实现（把 ReaderAction 落到引擎、bus、对话框上）。
import { navigate } from '@/core/router';
import { openBookInfo, getAdjacentBook } from '@/library';
import { screenSettings, themeSettings } from '@/reader/settings';
import { getBookFile } from '@/storage/db';
import { openNamesDialog } from '@/features';
import { popupMenu, toast } from '@/ui';
import type { ActionHost } from './actions';
import { cycleThemes } from '../themes/theme-manager';
import { setPdfNight } from '../settings/PdfOptions';
import { openSettings } from '../settings/open';
import { openThemeLoader } from '../settings/ThemeDialogs';
import { stopAutoScroll, toggleAutoScroll } from '../autoscroll';
import { enterFullscreen, exitFullscreen, isFullscreen } from '../services/system';
import { getSession, pageNext, pagePrev, stepChapter } from '../ops';
import { useReaderUi } from '../store';
import { t } from '../messages';

/** 打开设置/菜单前：停止自动滚屏与朗读（doOptionsMenuClick） */
function quiesce(): void {
  stopAutoScroll({ silent: true });
  getSession()?.bus.emit('tts.stop', {});
}

export function leaveReader(): void {
  quiesce();
  navigate('');
}

async function shareBook(): Promise<void> {
  const s = getSession();
  if (!s || typeof navigator.share !== 'function') return void toast(t('share_failed'));
  const title = s.record.title;
  const text = [s.record.title, ...s.record.authors].filter(Boolean).join(' - ');
  try {
    const blob = await getBookFile(s.bookId);
    const file = blob ? new File([blob], s.record.fileName, { type: blob.type || 'application/octet-stream' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ title, text, files: [file] });
    else await navigator.share({ title, text });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast(t('share_failed'));
  }
}

export function toggleFullscreen(): void {
  if (isFullscreen()) {
    screenSettings.set({ fullscreen: false });
    void exitFullscreen();
  } else {
    screenSettings.set({ fullscreen: true });
    void enterFullscreen().then((ok) => !ok && toast(t('fullscreen_failed')));
  }
}

export function showOptionsMenu(host: ActionHost): void {
  quiesce();
  popupMenu(window.innerWidth - 8, 56, [
    { label: t('visual_options'), onSelect: () => host.openOptions('visual') },
    { label: t('control_options'), onSelect: () => host.openOptions('control') },
    { label: t('miscellaneous'), onSelect: () => host.openOptions('misc') },
    { label: t('theme_menu'), onSelect: openThemeLoader },
    { label: t('names_replacement'), onSelect: () => { const s = getSession(); if (s) openNamesDialog(s); } },
    { label: t('more_operations'), onSelect: () => showNavigateMenu(host) },
    { label: t('share'), onSelect: () => void shareBook() },
    { label: t('book_info'), onSelect: () => host.bookInfo() },
    { label: t('fullscreen_toggle'), onSelect: toggleFullscreen },
  ]);
}

/** 导航菜单 = 「更多操作...」；点击后先收起菜单栏再执行 */
export function showNavigateMenu(host: ActionHost): void {
  useReaderUi.getState().setMenu(false);
  const items: [string, () => void][] = [
    [t('speak'), () => host.command('tts.toggle', {})],
    [t('text_select'), () => host.command('selection.start', {})],
    [t('full_search'), () => host.command('search.open', {})],
    [t('auto_scroll'), () => host.autoScroll()],
    [t('chapters'), () => host.command('toc.open', {})],
    [t('prior_chapter'), () => host.chapter(-1)],
    [t('next_chapter'), () => host.chapter(1)],
    [t('prior_file'), () => host.adjacentFile(-1)],
    [t('next_file'), () => host.adjacentFile(1)],
    [t('bookmark_manage'), () => host.command('bookmarks.open', {})],
    [t('font_size_adjust'), () => host.fontSizeBar()],
    [t('brightness_adjust'), () => host.brightnessPanel()],
  ];
  popupMenu(Math.max(8, window.innerWidth / 2 - 100), Math.max(56, window.innerHeight / 2 - 260), items.map(([label, onSelect]) => ({ label, onSelect })));
}

export function createActionHost(): ActionHost {
  const host: ActionHost = {
    pageUp: () => void pagePrev(),
    pageDown: () => void pageNext(),
    adjacentFile: (dir) => {
      const s = getSession();
      if (!s) return;
      void getAdjacentBook(s.bookId, dir).then((id) => {
        if (id) {
          quiesce();
          navigate('read', id);
        } else toast(dir === 1 ? t('no_next_file') : t('no_prior_file'));
      });
    },
    command: (type, payload) => {
      const s = getSession();
      if (!s) return;
      // 打开 features 的面板前先收起菜单栏与自动滚屏
      useReaderUi.getState().setMenu(false);
      if (type === 'toc.open' || type === 'search.open' || type === 'bookmarks.open') stopAutoScroll({ silent: true });
      s.bus.emit(type, payload);
    },
    bookInfo: () => {
      const s = getSession();
      if (s) openBookInfo(s.bookId);
    },
    changeTheme: () => {
      const s = getSession();
      if (!s) return;
      if (s.book.kind === 'fixed') setPdfNight(!themeSettings.get().nightMode);
      else cycleThemes(s.record.fileName);
    },
    optionsMenu: () => showOptionsMenu(host),
    navigateMenu: () => showNavigateMenu(host),
    fontSizeBar: () => useReaderUi.getState().setPanel('font'),
    chapter: (dir) => void stepChapter(dir),
    backToShelf: leaveReader,
    autoScroll: toggleAutoScroll,
    brightnessPanel: () => useReaderUi.getState().setPanel('brightness'),
    openOptions: (which) => {
      quiesce();
      useReaderUi.getState().setMenu(false);
      openSettings(which);
    },
  };
  return host;
}
