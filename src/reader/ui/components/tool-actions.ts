// 工具按钮的点击与长按行为（VIEW-004 / VIEW-005）。长按菜单用 popupMenu，锚点在按钮上方。
import { autoScrollSettings, controlSettings, flipSettings, screenSettings, textSettings } from '@/reader/settings';
import { popupMenu, toast, type MenuItem } from '@/ui';
import type { ActionHost } from '../actions/actions';
import { ToolButton } from '../ui-settings';
import { TOOL_META } from './tool-meta';
import { openToolbarCustomizer } from '../settings/MiscOptions';
import { openTiltDialog, setTiltEnabled } from '../settings/MiscDialogs';
import { openFontPicker } from '../settings/FontPicker';
import { openThemeLoader, openThemeSaver } from '../settings/ThemeDialogs';
import { openSettings } from '../settings/open';
import { SCROLL_MODES, startAutoScroll, stopAutoScroll } from '../autoscroll';
import { dayNightThemes, loadTheme } from '../themes/theme-manager';
import { leaveReader } from '../actions/host';
import { adjustBrightness, setBrightness } from '../services/brightness-actions';
import { applyScreenState, isLandscapeNow, nextScreenState, orientationSupported } from '../services/system';
import { clampFontSize } from '../settings/options-data';
import { currentLocator, getSession, sectionCount, stepChapter } from '../ops';
import { t } from '../messages';

export interface Anchor {
  x: number;
  y: number;
}

async function setOrientation(state: number): Promise<void> {
  screenSettings.set({ screenState: state });
  if (!orientationSupported()) return void toast(t('orient_unsupported'));
  const r = await applyScreenState(state);
  if (!r.ok) toast(r.reason === 'unsupported' ? t('orient_unsupported') : t('orient_lock_failed', { msg: r.message ?? '' }));
}

export function toggleDualPage(): void {
  const cur = screenSettings.get().dualPage;
  // 自动/开 → 关；关 → 开
  screenSettings.set({ dualPage: cur === 'off' ? 'on' : 'off' });
}

export function toolClick(id: number, host: ActionHost): void {
  switch (id) {
    case ToolButton.Orientation:
      void setOrientation(nextScreenState(screenSettings.get().screenState, isLandscapeNow()));
      break;
    case ToolButton.DayNight:
      host.changeTheme();
      break;
    case ToolButton.Speak:
      host.command('tts.toggle', {});
      break;
    case ToolButton.AutoScroll:
      host.autoScroll();
      break;
    case ToolButton.Chapters:
      host.command('toc.open', {});
      break;
    case ToolButton.Bookmarks:
      host.command('bookmarks.open', {});
      break;
    case ToolButton.Brightness:
      host.brightnessPanel();
      break;
    case ToolButton.FontSize:
      host.fontSizeBar();
      break;
    case ToolButton.Search:
      host.command('search.open', {});
      break;
    case ToolButton.Tilt:
      void setTiltEnabled(!controlSettings.get().tiltTurnPage);
      break;
    case ToolButton.Visual:
      host.openOptions('visual');
      break;
    case ToolButton.Control:
      host.openOptions('control');
      break;
    case ToolButton.Misc:
      host.openOptions('misc');
      break;
    case ToolButton.Themes:
      openThemeLoader();
      break;
    case ToolButton.Options:
      host.optionsMenu();
      break;
    case ToolButton.Shutdown:
      leaveReader();
      break;
    case ToolButton.DualPage:
      toggleDualPage();
      break;
    case ToolButton.Customize:
      openToolbarCustomizer();
      break;
    case ToolButton.SyncUp:
    case ToolButton.SyncDown:
      toast(t('sync_in_settings'));
      break;
  }
}

function menuAt(a: Anchor, items: MenuItem[]): void {
  popupMenu(a.x - 90, a.y - items.length * 42 - 12, items);
}

export function toolLongPress(id: number, host: ActionHost, a: Anchor): void {
  switch (id) {
    case ToolButton.Orientation:
      menuAt(
        a,
        (['orient_auto', 'orient_landscape', 'orient_portrait', 'orient_landscape_rev', 'orient_portrait_rev', 'orient_landscape_sensor', 'orient_portrait_sensor'] as const).map((k, i) => ({
          label: t(k),
          onSelect: () => void setOrientation(i),
        })),
      );
      return;
    case ToolButton.DayNight: {
      const { day, night } = dayNightThemes();
      menuAt(a, [
        { label: t('day_theme'), onSelect: () => void loadTheme(day.name, { colorOnly: true }) },
        { label: t('night_theme'), onSelect: () => void loadTheme(night.name, { colorOnly: true }) },
        { label: t('load_from_theme_dots'), onSelect: openThemeLoader },
        { label: t('save_as_theme_dots'), onSelect: () => void openThemeSaver() },
      ]);
      return;
    }
    case ToolButton.AutoScroll:
      menuAt(
        a,
        SCROLL_MODES.map((m) => ({
          label: t(`scroll_mode_${m}` as 'scroll_mode_0'),
          onSelect: () => {
            autoScrollSettings.set({ autoScrollMode: m as 0 });
            stopAutoScroll({ silent: true });
            startAutoScroll();
          },
        })),
      );
      return;
    case ToolButton.Chapters:
      menuAt(a, [
        { label: t('chapters_total', { n: sectionCount() }), onSelect: () => host.command('toc.open', {}) },
        { label: t('prior_chapter'), onSelect: () => void stepChapter(-1) },
        { label: t('next_chapter'), onSelect: () => void stepChapter(1) },
      ]);
      return;
    case ToolButton.Bookmarks:
      menuAt(a, [
        { label: t('saved_bookmarks'), onSelect: () => host.command('bookmarks.open', {}) },
        { label: t('add_new_bookmark'), onSelect: () => host.command('bookmark.add', { at: currentLocator() ?? undefined }) },
      ]);
      return;
    case ToolButton.Brightness:
      menuAt(a, [
        { label: t('bright_auto'), onSelect: () => setBrightness(-100) },
        { label: '100%', onSelect: () => setBrightness(100) },
        { label: '50%', onSelect: () => setBrightness(50) },
        { label: '1%', onSelect: () => setBrightness(1) },
        { label: t('bright_plus'), onSelect: () => adjustBrightness(1) },
        { label: t('bright_minus'), onSelect: () => adjustBrightness(-1) },
      ]);
      return;
    case ToolButton.FontSize:
      // 原菜单文案写 ±0.5，代码实际 ±1.0（spec §7.4），这里按代码
      menuAt(a, [
        { label: t('font_name_menu'), onSelect: () => openFontPicker({ get: () => textSettings.get().fontName, set: (v) => textSettings.set({ fontName: v }) }) },
        { label: t('font_plus'), onSelect: () => textSettings.set({ fontSize: clampFontSize(textSettings.get().fontSize + 1) }) },
        { label: t('font_minus'), onSelect: () => textSettings.set({ fontSize: clampFontSize(textSettings.get().fontSize - 1) }) },
      ]);
      return;
    case ToolButton.Tilt:
      openTiltDialog();
      return;
    case ToolButton.Shutdown:
    case ToolButton.DualPage:
    case ToolButton.Customize:
      toolClick(id, host);
      return;
    default:
      toast(t(TOOL_META[id].label)); // 其余按钮长按只提示按钮名
  }
}

void flipSettings;
void openSettings;
void getSession;
