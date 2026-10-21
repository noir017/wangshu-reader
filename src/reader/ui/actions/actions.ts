// 动作分发（CTRL-002）：tap / 长按 / 手势 / 按键 / 状态栏 / 摇一摇 / 媒体键 最后都归到 ReaderAction，
// 由 performAction 交给宿主（ActionHost）执行。宿主接口很小，所以可以用 mock 单测。
import { ReaderAction, type ReaderActionId } from '@/reader/settings';
import { defineMessages } from '@/core/i18n';
import type { ReaderCommands } from '@/core/reader-session';

const tt = defineMessages({
  zh: {
    a0: '向上翻页',
    a1: '向下翻页',
    a2: '上一文件',
    a3: '下一文件',
    a4: '搜索',
    a5: '书签',
    a6: '显示书籍信息',
    a7: '改变配色方案',
    a8: '打开选项菜单',
    a9: '打开导航菜单',
    a10: '字体大小调节',
    a11: '显示章节目录',
    a12: '前一章节',
    a13: '下一章节',
    a14: '返回书库',
    a15: '无',
    a16: '退出整个程序',
    a17: '页面文字摘录',
    a18: '自动滚屏',
    a19: '朗读',
    a20: '亮度调节',
    a21: '可视选项',
    a22: '控制选项',
    a23: '其它选项',
    a24: '向上滑动',
    a25: '向下滑动',
  },
  en: {
    a0: 'Page up',
    a1: 'Page down',
    a2: 'Previous file',
    a3: 'Next file',
    a4: 'Search',
    a5: 'Bookmarks',
    a6: 'Book information',
    a7: 'Change theme',
    a8: 'Open options menu',
    a9: 'Open navigate menu',
    a10: 'Font size bar',
    a11: 'Show chapters',
    a12: 'Previous chapter',
    a13: 'Next chapter',
    a14: 'Back to shelf',
    a15: 'None',
    a16: 'Close reader',
    a17: 'Text selection',
    a18: 'Auto scroll',
    a19: 'Speak',
    a20: 'Brightness',
    a21: 'Visual options',
    a22: 'Control options',
    a23: 'Miscellaneous options',
    a24: 'Move up',
    a25: 'Move down',
  },
});

export const ALL_ACTIONS: ReaderActionId[] = Array.from({ length: 26 }, (_, i) => i as ReaderActionId);

export function actionLabel(id: number): string {
  return tt(`a${id}` as 'a0');
}

/** 下拉框用的全部 26 项 */
export function actionOptions(): { value: ReaderActionId; label: string }[] {
  return ALL_ACTIONS.map((value) => ({ value, label: actionLabel(value) }));
}

/** 动作执行宿主：由阅读页实现。方法都是「发起」，不要求同步完成 */
export interface ActionHost {
  pageUp(): void;
  pageDown(): void;
  lineUp(): void;
  lineDown(): void;
  adjacentFile(dir: 1 | -1): void;
  /** 发 bus 命令（搜索/书签/目录/选择/朗读） */
  command<K extends keyof ReaderCommands>(type: K, payload: ReaderCommands[K]): void;
  bookInfo(): void;
  changeTheme(): void;
  optionsMenu(): void;
  navigateMenu(): void;
  fontSizeBar(): void;
  chapter(dir: 1 | -1): void;
  backToShelf(): void;
  exitReader(): void;
  autoScroll(): void;
  brightnessPanel(): void;
  openOptions(which: 'visual' | 'control' | 'misc'): void;
}

/**
 * doEvent：返回 false = 无动作（事件继续向下传），其余执行并返回 true。
 * pos 为触发位置（长按坐标），只用于「文字摘录」。
 */
export function performAction(id: number, host: ActionHost, pos?: { x: number; y: number }): boolean {
  switch (id) {
    case ReaderAction.PageUp:
      host.pageUp();
      return true;
    case ReaderAction.PageDown:
      host.pageDown();
      return true;
    case ReaderAction.PriorFile:
      host.adjacentFile(-1);
      return true;
    case ReaderAction.NextFile:
      host.adjacentFile(1);
      return true;
    case ReaderAction.Search:
      host.command('search.open', {});
      return true;
    case ReaderAction.Bookmarks:
      host.command('bookmarks.open', {});
      return true;
    case ReaderAction.BookInfo:
      host.bookInfo();
      return true;
    case ReaderAction.ChangeTheme:
      host.changeTheme();
      return true;
    case ReaderAction.OptionsMenu:
      host.optionsMenu();
      return true;
    case ReaderAction.NavigateMenu:
      host.navigateMenu();
      return true;
    case ReaderAction.FontSizeBar:
      host.fontSizeBar();
      return true;
    case ReaderAction.ShowChapters:
      host.command('toc.open', {});
      return true;
    case ReaderAction.PriorChapter:
      host.chapter(-1);
      return true;
    case ReaderAction.NextChapter:
      host.chapter(1);
      return true;
    case ReaderAction.BackToShelf:
      host.backToShelf();
      return true;
    case ReaderAction.Exit:
      host.exitReader();
      return true;
    case ReaderAction.TextSelection:
      host.command('selection.start', pos ? { x: pos.x, y: pos.y } : {});
      return true;
    case ReaderAction.AutoScroll:
      host.autoScroll();
      return true;
    case ReaderAction.Speak:
      host.command('tts.toggle', {});
      return true;
    case ReaderAction.Brightness:
      host.brightnessPanel();
      return true;
    case ReaderAction.VisualOptions:
      host.openOptions('visual');
      return true;
    case ReaderAction.ControlOptions:
      host.openOptions('control');
      return true;
    case ReaderAction.MiscOptions:
      host.openOptions('misc');
      return true;
    case ReaderAction.LineUp:
      host.lineUp();
      return true;
    case ReaderAction.LineDown:
      host.lineDown();
      return true;
    default:
      return false; // 15 无 / 未知
  }
}

import type { TapArea } from '@/core/reader';

interface TapBindings {
  doTapScreenTop: number;
  doTapScreenBottom: number;
  doTapScreenLeft: number;
  doTapScreenRight: number;
}

/** 点击区 → 绑定动作（doTouchDown）。区域 0（中间）没有绑定，返回 null */
export function actionForArea(area: TapArea, b: TapBindings): number | null {
  switch (area) {
    case 1:
      return b.doTapScreenTop;
    case 2:
      return b.doTapScreenBottom;
    case 3:
      return b.doTapScreenLeft;
    case 4:
      return b.doTapScreenRight;
    default:
      return null;
  }
}

export interface TapOutcome {
  /** 'toggle-menu' 中间区呼出/收起菜单；'hide-menu' 菜单已显示时任意点击只收起；'action' 执行动作；'none' 无事 */
  kind: 'toggle-menu' | 'hide-menu' | 'action' | 'none';
  action?: number;
  area?: TapArea;
}

/**
 * 单击的完整决策（do_TapUp_Event）：菜单已显示 → 只收起；否则按区域：中间切换菜单，其余执行绑定动作。
 * 绑定为 None(15) 的区域无动作（不翻页也不弹菜单）。
 */
export function decideTap(opts: { menuVisible: boolean; area: TapArea; bindings: TapBindings }): TapOutcome {
  if (opts.menuVisible) return { kind: 'hide-menu', area: opts.area };
  if (opts.area === 0) return { kind: 'toggle-menu', area: 0 };
  const action = actionForArea(opts.area, opts.bindings);
  if (action === null || action === ReaderAction.None) return { kind: 'none', area: opts.area };
  return { kind: 'action', action, area: opts.area };
}
