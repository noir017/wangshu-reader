// 阅读页界面自己的设置（不属于 reader/settings.ts 契约的部分）：工具栏布局、首次提示开关等。
import { defineSettings } from '@/core/settings';

/** 底部工具按钮（ReaderBar，VIEW-004）的序号，同原 app。15「关闭」已撤（与顶栏「返回」完全相同），编号保留不复用 */
export const ToolButton = {
  Orientation: 0,
  DayNight: 1,
  Speak: 2,
  AutoScroll: 3,
  Chapters: 4,
  Bookmarks: 5,
  Brightness: 6,
  FontSize: 7,
  Search: 8,
  Tilt: 9,
  Visual: 10,
  Control: 11,
  Misc: 12,
  Themes: 13,
  Options: 14,
  DualPage: 16,
  Customize: 17,
  SyncUp: 18,
  SyncDown: 19,
} as const;

/** 已撤的按钮编号：旧设置的工具栏列表里可能还有，读取时过滤掉 */
const RETIRED_TOOLS: ReadonlySet<number> = new Set([15]);
const TOOL_COUNT = 20;

export interface ToolbarItem {
  id: number;
  on: boolean;
}

/** 默认勾选 0,1,2,3,4,17（原版 2 号朗读仅 Pro，web 视为全开） */
export const DEFAULT_TOOLBAR: ToolbarItem[] = Array.from({ length: TOOL_COUNT }, (_, id) => ({
  id,
  on: [0, 1, 2, 3, 4, 17].includes(id),
})).filter((it) => !RETIRED_TOOLS.has(it.id));

export const uiSettings = defineSettings('reader.ui', {
  /** 工具栏：各按钮的顺序与勾选 */
  toolbar: DEFAULT_TOOLBAR,
  doubleLineBar: false,
  /** 首次使用确认/提示的开关 */
  askForScrollEvent: true,
  askAutoScrollTip: true,
  askForSwipeEvent: true,
  askForTiltAction: true,
  showedReaderClickTip: false,
  sysDarkModeTip: true,
  saveThemeHint: true,
  /** 被用户删除的内置主题名（内置数据不可改，用隐藏表示删除） */
  hiddenThemes: [] as string[],
  /** 上次阅读时间（自动日夜切换用，THEME-004） */
  lastReadTime: 0,
  /** 固定时间提醒上次触发的本地日期序号（一天只提醒一次） */
  remind2LastDay: -1,
  /** 开启蓝光遮罩前的有效值缓存无需持久化；这里只放面板用的上次非零过滤量 */
  lastBluelight: 30,
  /** 自定义阅读器工具栏等对话框的上次状态不持久化 */
  /** 翻页声音文件的 kv 键存在 flipSettings 约定里（reader.pageSoundFile），这里存文件名用于显示 */
  pageSoundFileName: '',
  /** 上次选择的「浅色/深色」文字色，选背景色后自动切换字色用（VIEW-023） */
  lastLightFontColor: '#F4F4F4',
  lastDarkFontColor: '#333333',
  /** 速读窗口的字体颜色等无需设置 */
  speedReadBarVisible: true,
});

/** 补齐/规整工具栏：缺项补到末尾、重复/越界/已撤的项丢弃 */
export function normalizeToolbar(items: ToolbarItem[] | undefined): ToolbarItem[] {
  const seen = new Set<number>();
  const out: ToolbarItem[] = [];
  for (const it of items ?? []) {
    if (it && Number.isInteger(it.id) && it.id >= 0 && it.id < TOOL_COUNT && !RETIRED_TOOLS.has(it.id) && !seen.has(it.id)) {
      seen.add(it.id);
      out.push({ id: it.id, on: !!it.on });
    }
  }
  for (let id = 0; id < TOOL_COUNT; id++) if (!seen.has(id) && !RETIRED_TOOLS.has(id)) out.push({ id, on: false });
  return out;
}
