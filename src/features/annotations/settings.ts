// 选择/标注/书签设置（spec 03 §3.2），字段名与默认值照原 app 的 A.java。颜色统一用 CSS #rrggbb[aa]。
import { defineSettings } from '@/core/settings';
import type { HighlightStyle } from '@/core/library';

const tablet = Math.min(globalThis.screen?.width ?? 400, globalThis.screen?.height ?? 800) >= 600;

/** highlightMode 的序号 → 样式：0 高亮 / 1 下划线 / 2 删除线 / 3 波浪线 */
export const HL_STYLES: readonly HighlightStyle[] = ['highlight', 'underline', 'strikethrough', 'squiggly'];

export const annoSettings = defineSettings('features.annotation', {
  /** 当前样式（0..3） */
  highlightMode: 0,
  /** 每种样式各一个全局色（原 #7700AAFF / #FF555555 / #FF555555 / #FF00FF00 的 CSS 写法） */
  highlightColor: '#00aaff77',
  underlineColor: '#555555',
  strikethroughColor: '#555555',
  squigglyColor: '#00ff00',
  /** 颜色模板下行 / 高亮对话框「最近颜色」的 5 个预设（原 highlight_color1..5） */
  presetColors: ['#99aa77', '#ff9200', '#cc99c0', '#88888888', '#00aaff77'] as string[],
  /** 使用最后标注类型来高亮文字 */
  highlightStyleAsSelec: false,
  /** 长按+拖动直接标注（引擎选择结束时由本模块直接创建高亮） */
  directHighlight: false,
  /** 选择时放大镜（引擎读取；这里只存开关） */
  showMagnifier: !tablet,
  /** 工具条上方显示颜色快速选择模板 */
  showColorTemplate: true,
  bookmarkColor: '#ff0000',
  /** 书签不带颜色（原默认 true） */
  bookmarkNoColor: true,
  /** 创建书签前先输入书签名 */
  bookmarkManually: true,
  /** 书签/标注列表按时间排序 */
  bookmarkSortByDate: false,
  /** 分享内容里包含章节信息 */
  shareWithChapter: true,
  /** 页面右上角书签角标可点（点按切换书签） */
  bookmarkCorner: true,
});

export type AnnoSettings = ReturnType<typeof annoSettings.get>;

export function styleColorOf(s: AnnoSettings, style: HighlightStyle): string {
  switch (style) {
    case 'underline':
      return s.underlineColor;
    case 'strikethrough':
      return s.strikethroughColor;
    case 'squiggly':
      return s.squigglyColor;
    default:
      return s.highlightColor;
  }
}

export function setStyleColor(style: HighlightStyle, color: string): void {
  const key = { highlight: 'highlightColor', underline: 'underlineColor', strikethrough: 'strikethroughColor', squiggly: 'squigglyColor' } as const;
  annoSettings.set({ [key[style]]: color });
}

/** 书签颜色：无色（原默认）时返回 ''，AnnotationRecord.color 约定 '' = 无色 */
export function bookmarkColorOf(s: AnnoSettings): string {
  return s.bookmarkNoColor ? '' : s.bookmarkColor;
}
