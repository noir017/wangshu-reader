// 14 套内置主题（THEME-001，spec 02 §5.2）。只写出原 XML 里真正写了的键；缺省键载入时取当前全局值。
// 背景图用程序纹理 id（tex:<apk 背景图文件名去扩展名>），由引擎的 textures.ts 提供样式；
// id 与 apk 背景图文件名一一对应（引擎的 textures.ts 提供程序化版本）。
import type { THEME_KEYS } from '@/reader/settings';

export type ThemeStyleKey = Exclude<(typeof THEME_KEYS)[number], 'fontColor' | 'backgroundColor' | 'useBackgroundImage' | 'backgroundImage'>;

export interface ThemeData {
  fontColor: string;
  /** 缺省 = 载入时保持当前背景色（只写图的主题） */
  backgroundColor?: string;
  useBackgroundImage: boolean;
  backgroundImage: string;
  /** 带字体排版的主题（原 pFontName 存在）才有；其余为仅颜色主题（emptyFontStyle） */
  style?: Partial<Record<ThemeStyleKey, unknown>>;
}

export interface BuiltinTheme extends ThemeData {
  name: string;
}

export const DAY_THEME = 'Day Theme';
export const NIGHT_THEME = 'Night Theme';
/** 临时主题（日夜切换时暂存「上次的自定义主题」），不在列表里显示 */
export const TEMP_THEME = 'circle_only';

/** 有符号 ARGB int32 → #RRGGBB（忽略 alpha，原版读取背景色时强制不透明） */
export function argbToHex(argb: number): string {
  const v = argb >>> 0;
  return `#${(v & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
}

export const BUILTIN_THEMES: BuiltinTheme[] = [
  { name: 'Day Theme', useBackgroundImage: true, backgroundImage: 'tex:day161', backgroundColor: '#DCD7D1', fontColor: '#000000' },
  { name: 'Night Theme', useBackgroundImage: true, backgroundImage: 'tex:night161', backgroundColor: '#000000', fontColor: '#CCCCCC' },
  { name: 'Day 1', useBackgroundImage: true, backgroundImage: 'tex:readbg_13', fontColor: '#000000' },
  { name: 'Day 2', useBackgroundImage: true, backgroundImage: 'tex:readbg_14', fontColor: '#000000' },
  { name: 'Day 3', useBackgroundImage: true, backgroundImage: 'tex:readbg_11', fontColor: '#191919' },
  { name: 'Night 1 (True black)', useBackgroundImage: false, backgroundImage: '', backgroundColor: '#000000', fontColor: '#FFFFFF' },
  // 原资源字色为纯黑（黑字配深蓝灰底，疑为原资源失误，spec §7.3）：这里保持原样，用户可自行改色
  { name: 'Night 2', useBackgroundImage: true, backgroundImage: 'tex:readbg223', fontColor: '#000000' },
  { name: 'Night 3', useBackgroundImage: false, backgroundImage: '', backgroundColor: '#0A0C13', fontColor: '#354552' },
  { name: 'Outdoor (Pure white)', useBackgroundImage: false, backgroundImage: '', backgroundColor: '#FFFFFF', fontColor: '#000000' },
  {
    name: 'nature',
    useBackgroundImage: true,
    backgroundImage: 'tex:readbg201',
    backgroundColor: '#E6EACF',
    fontColor: '#082D52',
    // 原 pFontName=DroidSerif-BoldItalic（assets 无此字体，回退 serif）
    style: { fontName: 'serif', fontSize: 16, fontShadow: true, lineSpace: 3, fontSpace: 0, fontBold: false, fontItalic: false, textJustified: false },
  },
  { name: 'pro 1', useBackgroundImage: true, backgroundImage: 'tex:readbg203', fontColor: '#4A4539' },
  { name: 'pro 2', useBackgroundImage: true, backgroundImage: 'tex:readbg204', fontColor: '#4A4539' },
  { name: 'pro 3', useBackgroundImage: true, backgroundImage: 'tex:readbg221', fontColor: '#BDC9C8' },
  { name: 'pro 4', useBackgroundImage: true, backgroundImage: 'tex:readbg222', fontColor: '#BDC9C8' },
];

/**
 * 列表顺序（A.getThemeList）：Day Theme、Night Theme 在前，其余按 ASCII 排序
 * （大写在小写前，所以 nature、pro 排在 Outdoor 之后）。
 */
export function sortThemeNames(names: string[]): string[] {
  const head = names.filter((n) => n === DAY_THEME || n === NIGHT_THEME).sort((a, b) => (a === DAY_THEME ? -1 : b === DAY_THEME ? 1 : 0));
  const rest = names.filter((n) => n !== DAY_THEME && n !== NIGHT_THEME).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [...head, ...rest];
}
