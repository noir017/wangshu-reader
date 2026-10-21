// 阅读设置契约：引擎（src/reader/engine）订阅并应用，界面（src/reader/ui）读写，功能模块（src/features）按需读取。
// 字段名、默认值、取值范围都照原 app 的 A.java（docs/spec/02-reader-view.md §3）；单位换算在引擎里做，这里存原始值。
// 改字段/默认值只能由总控改；各模块自己的私有设置（朗读、词典、工具栏布局等）在各自目录 defineSettings。
import { defineSettings } from '@/core/settings';

const zh = (globalThis.navigator?.language ?? 'zh').toLowerCase().startsWith('zh');
const tablet = Math.min(globalThis.screen?.width ?? 400, globalThis.screen?.height ?? 800) >= 600;

/** 翻页动画（flip_animation，ANIM-001） */
export const FlipAnimation = {
  None: 0, // 无动画：上下滚动阅读
  Curl: 1, // (Apple) 纸张翻页 / 仿真翻页
  GoogleCurl: 2, // (Google) 纸张翻页
  Push: 3, // 水平切换
  VerticalPush: 4, // 上下滚动（翻页动画）
  Fade: 5, // 渐隐
  Cover: 6, // 左右覆盖
  VerticalCover: 7, // 上下覆盖
} as const;
export type FlipAnimationId = (typeof FlipAnimation)[keyof typeof FlipAnimation];

/** 可绑定动作（CTRL-002，序号即原 app 的 doEvent 编号） */
export const ReaderAction = {
  PageUp: 0,
  PageDown: 1,
  PriorFile: 2,
  NextFile: 3,
  Search: 4,
  Bookmarks: 5,
  BookInfo: 6,
  ChangeTheme: 7, // 日夜切换
  OptionsMenu: 8,
  NavigateMenu: 9,
  FontSizeBar: 10,
  ShowChapters: 11,
  PriorChapter: 12,
  NextChapter: 13,
  BackToShelf: 14,
  None: 15,
  Exit: 16,
  TextSelection: 17,
  AutoScroll: 18,
  Speak: 19,
  Brightness: 20,
  VisualOptions: 21,
  ControlOptions: 22,
  MiscOptions: 23,
  LineUp: 24,
  LineDown: 25,
} as const;
export type ReaderActionId = (typeof ReaderAction)[keyof typeof ReaderAction];

/** 自动滚屏模式（autoScrollMode，AUTO-*） */
export const AutoScrollMode = {
  RollingPixel: 0, // 卷帘·像素
  RollingLine: 1, // 卷帘·行
  Pixel: 2, // 像素平滑
  Line: 3, // 逐行
  Page: 4, // 逐页
  SpeedRead: 5, // 速读（RSVP）
} as const;
export type AutoScrollModeId = (typeof AutoScrollMode)[keyof typeof AutoScrollMode];

/** 文字/排版（§3.1）。标★的字段可被主题保存/载入（见 THEME_KEYS） */
export const textSettings = defineSettings('reader.text', {
  /** ★ 字号（原 app 为 sp，web 按 CSS px 使用）。范围 10..100，步长 0.1 */
  fontSize: tablet ? 18 : zh ? 17 : 14,
  /** ★ 字体：'serif' | 'sans-serif' | 'monospace' | 'font:<FontRecord.id>'（用户导入） | 'server:<file>'（服务端字体） | 系统字体族名 */
  fontName: 'serif',
  /** ★ 文字颜色 */
  fontColor: '#1B211E',
  /** ★ 背景纯色（也是背景图缺失时的回退色） */
  backgroundColor: '#E6EACF',
  /** ★ 用背景图（true）还是纯色（false） */
  useBackgroundImage: false,
  /** ★ 背景图 id：内置纹理 'tex:<名>' 或用户图片 'img:<kv 键>' */
  backgroundImage: '',
  fontBold: false,
  fontItalic: false,
  fontUnderline: false,
  fontShadow: false,
  dashUnderline: true,
  /** ★ 行距 -5..20，行高倍数 = 1 + 值/10（叠加在字体自然行高上，引擎换算） */
  lineSpace: 3,
  /** ★ 段距 0..20（UI 显示 ×10%） */
  paragraphSpace: 7,
  /** ★ 字距 -4..20，letter-spacing = 值/20 em */
  fontSpace: 0,
  /** ★ 字体横向伸缩 -4..20，scaleX = 1 + 值/10 */
  fontScale: 0,
  /** ★ 页边距（CSS px，对应原 dp）0..200（平板 300） */
  topMargin: Math.round(20 * 12 / 9),
  bottomMargin: 20,
  leftMargin: 20,
  rightMargin: 20,
  /** ★ 两端对齐 */
  textJustified: zh,
  textHyphenation: false,
  /** 断字语言（BCP47），空 = 跟随书籍语言 */
  hyphenationLang: '',
  /** 东亚排版：按字折行 + 避头尾 */
  textCJK: zh,
  textDense: false,
  /** 竖排 */
  verticalAlignment: false,
  textJian2Fan: false,
  textFan2Jian: false,
  /** 首行缩进与缩进字数 0..4 */
  indentParagraph: zh,
  indentLength: 2,
  /** 删除多余空格空行 */
  trimBlankSpace: false,
  /** TXT 新章换页 */
  txtChapterSplit: false,
  /** 翻页时保留上一页最后一行 */
  keepOneLineWhenPaging: false,
  /** 文本编码：'auto' 或 TextDecoder 支持的标签（gbk、big5、utf-16le…） */
  textEncode: 'auto',
  /** 双页模式字号加减 */
  dualFontSizeAdd: 0,
});

/** 主题可保存/载入的字段（THEME-001） */
export const THEME_KEYS = [
  'fontSize', 'fontName', 'fontColor', 'backgroundColor', 'useBackgroundImage', 'backgroundImage',
  'fontBold', 'fontItalic', 'fontUnderline', 'fontShadow', 'lineSpace', 'paragraphSpace', 'fontSpace', 'fontScale',
  'topMargin', 'bottomMargin', 'leftMargin', 'rightMargin', 'textJustified',
] as const satisfies readonly (keyof ReturnType<typeof textSettings.get>)[];

/** 书内 CSS 与内容显示（§3.2） */
export const cssSettings = defineSettings('reader.css', {
  /** 禁用书内 CSS 总开关（下列 8 项任一为真即视为开启） */
  disableCSS: false,
  cssFontStyle: false,
  cssFontSize: false,
  cssFontColor: false,
  cssAlignment: false,
  cssJustify: true,
  cssIndent: false,
  cssLineSpace: false,
  cssOthers: false,
  /** 使用 EPUB 内嵌字体 */
  useCssFont: true,
  disableLinkColor: false,
  linkColor: '#6060E4',
  linkColorNight: '#6060E4',
  linkVisitedColor: '#999999',
  linkVisitedColorNight: '#999999',
  noteTextColor: '#111111',
  noteBackColor: '#F6EA8C',
  noteTextColorNight: '#DDDDDD',
  noteBackColorNight: '#333333',
  /** 直接在页底显示注解（不弹窗） */
  footnoteOnBottom: false,
  chapterEndPrompt: false,
  imageWhiteTransparent: false,
  fitImageToScreen: false,
  longTapImageFullScreen: true,
});

/** 翻页、动画与触摸开关（§3.3 前半） */
export const flipSettings = defineSettings('reader.flip', {
  flipAnimation: 0 as FlipAnimationId,
  /** 无动画模式下横划翻页使用的动画 */
  horiFlingAnimation: (tablet ? 0 : 4) as FlipAnimationId,
  /** 0..50 */
  flipSpeed: 30,
  allowScrollHorizontally: true,
  /** 禁止触摸上下滑动 */
  disableMove: false,
  pageSound: false,
  /** 0..4 内置声音；5 = 用户文件（kv 'reader.pageSoundFile'） */
  pageSoundIndex: 0,
});

/** 操控：点击区、长按、手势、按键、状态栏点击、边缘滑动（§3.3 后半） */
export const controlSettings = defineSettings('reader.control', {
  /** 点击区模式 0..6（§4.5） */
  tapMode: 1,
  /** true = 左右模式（tapMode<4 时有效） */
  toggleTapMode: true,
  doTapScreenTop: 0 as ReaderActionId,
  doTapScreenBottom: 1 as ReaderActionId,
  doTapScreenLeft: 0 as ReaderActionId,
  doTapScreenRight: 1 as ReaderActionId,
  doLongTap: 17 as ReaderActionId,
  /** 长按触发秒数 ≥0.05 */
  longTapInterval: 0.4,
  doSwipeLeftToRight: 15 as ReaderActionId,
  doSwipeRightToLeft: 15 as ReaderActionId,
  doSwipeTopToBottom: 15 as ReaderActionId,
  doSwipeBottomToTop: 15 as ReaderActionId,
  doShakePhone: 15 as ReaderActionId,
  /** 键盘映射：KeyboardEvent.key → 动作（原硬件键在 web 上的对应，CTRL-005） */
  keyMap: {
    PageUp: 0,
    PageDown: 1,
    ArrowUp: 0,
    ArrowDown: 1,
    ArrowLeft: 0,
    ArrowRight: 1,
    ' ': 1,
    Enter: 8,
    Home: 15,
    End: 15,
    'Ctrl+f': 4,
    MediaTrackNext: 15,
    MediaTrackPrevious: 15,
    MediaPlayPause: 15,
  } as Record<string, ReaderActionId>,
  /** 状态栏点击/长按（左/中/右） */
  statusClickLeft: 6 as ReaderActionId,
  statusClickMiddle: 15 as ReaderActionId,
  statusClickRight: 5 as ReaderActionId,
  statusLongClickLeft: 20 as ReaderActionId,
  statusLongClickMiddle: 15 as ReaderActionId,
  statusLongClickRight: 15 as ReaderActionId,
  /** 双指缩放改字号 */
  multTouch: false,
  /** 边缘滑动调亮度 / 哪条边 0左 1右 2上 3下 */
  adjustBrightness: true,
  brightnessEdge: 0,
  /** 边缘滑动调字号 / 哪条边 */
  adjustFontSizeAtSlide: false,
  fontsizeEdge: 1,
  /** 边缘防误触与四边宽度（px） */
  disableEdgeTouch: false,
  leftEdge: 8,
  rightEdge: 8,
  topEdge: 8,
  bottomEdge: 8,
  /** 倾斜翻页（DeviceMotion，仅手机浏览器） */
  tiltTurnPage: false,
  tiltForward: 0 as ReaderActionId,
  tiltBackward: 1 as ReaderActionId,
  tiltForwardSensitive: 1.0,
  tiltBackwardSensitive: 1.2,
});

/** 屏幕/系统（§3.4） */
export const screenSettings = defineSettings('reader.screen', {
  /** 屏幕方向 0自动 1横 2竖 3反横 4反竖 5横感应 6竖感应（Screen Orientation API，多数桌面浏览器无效） */
  screenState: tablet ? 0 : 6,
  fullscreen: true,
  keepScreenAwake: true,
  /** 无操作 N 分钟后取消常亮（100 = 永不） */
  screenAwakeExtend: 5,
  /** 亮度 -100 = 跟随系统（不加遮罩），-50..100 用遮罩模拟 */
  brightnessValue: -100,
  bluelightEnable: false,
  /** 0..100（有效 0..80） */
  bluelightOpacity: 30,
  /** 启动时打开上次读的书 */
  openLastFile: false,
  openBookAnim: false,
  /** 双页：'auto' = 仅横屏且宽度足够时；'on'；'off' */
  dualPage: (tablet ? 'auto' : 'off') as 'auto' | 'on' | 'off',
  /** 健康提醒：连续阅读 N 分钟提醒；夜间时刻提醒 */
  remind1: true,
  remind1Time: 60,
  remind2: false,
  remind2TimeHour: 23,
  remind2TimeMinute: 30,
  showBookmarkIcon: true,
});

/** 主题与自动日夜（§3.5）。用户主题列表存这里；内置 14 套主题的数据在 src/reader/ui 的主题模块 */
export const themeSettings = defineSettings('reader.theme', {
  /** 当前主题名（内置主题名或用户主题名） */
  lastTheme: 'Day Theme',
  /** 日夜切换前后各自的主题名（THEME-002） */
  dayTheme: 'Day Theme',
  nightTheme: 'Night Theme',
  /** 当前是否夜间（阅读页 UI 也据此切深色） */
  nightMode: false,
  loadThemeWithColorOnly: true,
  autoTheme: false,
  autoThemeDay: true,
  autoThemeNight: true,
  /** HHMM 整数 */
  autoThemeDayTime: 600,
  autoThemeNightTime: 2200,
  autoDaySetBright: false,
  autoNightSetBright: false,
  autoThemeDayBrightness: 10,
  autoThemeNightBrightness: 1,
  /** 跟随系统深色模式（prefers-color-scheme） */
  sysDarkModeFollow: false,
  /** 用户保存的主题：名称 → THEME_KEYS 子集 */
  userThemes: {} as Record<string, Partial<Record<(typeof THEME_KEYS)[number], unknown>>>,
});

/** 状态栏（§3.6） */
export const statusSettings = defineSettings('reader.status', {
  showStatusbar: true,
  statusBarOnTop: false,
  statusTime: true,
  statusChapter: true,
  statusProgress: true,
  use12Hour: false,
  statusCustomizeFont: false,
  statusFontName: 'sans-serif',
  statusFontColor: '#222222',
  statusFontSize: tablet ? 13 : 10,
  statusMargin: tablet ? 2 : 0,
  statusBackColor: '#33333333',
  showRemainingTime: false,
  remainingTimeInStatusBar: false,
});

/** 自动滚屏与速读（§3.7、§4.6） */
export const autoScrollSettings = defineSettings('reader.auto', {
  autoScrollMode: 0 as AutoScrollModeId,
  /** 0..100，值越大越慢（UI 滑条显示 100 - speed） */
  autoScrollSpeed: 50,
  startAutoScroll: false,
  speedReadWPM: 200,
  speedReadSize: 30,
  speedReadWords: 1,
});

/** 固定版式（PDF / DJVU / 漫画），docs/spec/03-content.md §3.6 */
export const fixedSettings = defineSettings('reader.fixed', {
  /** 0 自动 / 1 单页 / 2 连续滚动 */
  pdfViewMode: 0 as 0 | 1 | 2,
  /** 0 高 / 1 中 / 2 低（渲染分辨率倍数） */
  pdfRenderQuality: 1 as 0 | 1 | 2,
  pdfBackColor: '#C0C0C0',
  cbzBackColor: '#FFFFFF',
  /** 统一页面尺寸 */
  fitDifferentPageSize: false,
  pdfShowThumb: false,
  /** 滚动锁定（锁住横向平移） */
  pdfScrollLock: false,
  /** 0 普通 / 1 夜间（反色） */
  pdfTheme: 0 as 0 | 1,
  /** PDF/漫画翻页动画（同 FlipAnimation） */
  flipPdf: 0 as FlipAnimationId,
  /** 平滑缩放 */
  cbzSmooth: true,
  /** 漫画阅读方向（原版无界面开关，web 新增） */
  comicRtl: false,
  /** 适配方式：'page' 整页 / 'width' 适合宽度 / 'height' 适合高度 */
  fitMode: 'page' as 'page' | 'width' | 'height',
});
