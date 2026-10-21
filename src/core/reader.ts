// 阅读引擎对外接口：src/reader/engine 实现，src/reader/ui 与 src/features 只通过它与正文交互。
// 引擎自己订阅排版/翻页/操控相关设置（src/reader/settings.ts），UI 改设置即生效，不需要调用方法。
import type { Book, Locator, TextRange } from '@/core/book';

export interface ReaderLocation {
  locator: Locator;
  /** 全书进度 0..1（按章节 charCount 加权） */
  progress: number;
  section: number;
  /** 当前章节标题（取目录中最近的条目） */
  sectionTitle?: string;
  /** 章节内页码（1 起）/ 章节页数；滚动模式下为按视口高度折算的估计值 */
  page: number;
  pages: number;
  /** 全书页码估算（按字数折算，翻到时才精确） */
  bookPage?: number;
  bookPages?: number;
  /** 当前屏幕上可见的文本区间（朗读从此处开始、书签记录此处） */
  visible: TextRange;
  atStart: boolean;
  atEnd: boolean;
}

/** 点击区判定结果（CTRL-001，原 A.clickArea 返回码）：0 中(菜单) 1 上 2 下 3 左 4 右 */
export type TapArea = 0 | 1 | 2 | 3 | 4;

export interface ReaderSelection {
  range: TextRange;
  text: string;
  /** 选区包围盒（相对浏览器视口），用于定位选择菜单 */
  rect: DOMRect;
}

export interface ReaderEvents {
  /** 位置变化（翻页、跳转、窗口尺寸改变后重排） */
  relocate: ReaderLocation;
  /** 章节加载完成并完成排版 */
  sectionReady: { section: number; doc: Document };
  /**
   * 单击（未命中链接/标注/图片、且不是翻页拖拽时）。x/y 为 0..1 的阅读区归一化坐标（双页时相对整个阅读区）。
   * 点击区判定（tapMode → TapArea）与动作执行由 reader/ui 负责，引擎只报坐标。
   */
  tap: { x: number; y: number };
  /** 长按（未选中文字时，如长按空白处） */
  longPress: { x: number; y: number };
  /** 双击 */
  doubleTap: { x: number; y: number };
  /** 滑动手势（翻页以外的方向，如竖向滑动调亮度/字号由 UI 决定动作）。edge 表示从屏幕边缘起手 */
  swipe: { dir: 'up' | 'down' | 'left' | 'right'; startX: number; startY: number; dist: number; edge?: 'left' | 'right' | 'top' | 'bottom' };
  /** 竖向拖动过程（原 app：左边缘上下滑调亮度），连续派发 */
  verticalDrag: { startX: number; dy: number; phase: 'move' | 'end' };
  /** 双指缩放（改字号） */
  pinch: { scale: number; phase: 'move' | 'end' };
  /** 文字选择变化；null 表示选择取消 */
  selection: ReaderSelection | null;
  /** 点到书内链接。internal=true 时引擎已自行跳转（除非是脚注，见 footnote） */
  link: { href: string; internal: boolean; footnoteHtml?: string; rect: DOMRect };
  /** 点到图片（UI 打开看图器） */
  image: { src: string; alt?: string; rect: DOMRect };
  /** 点到装饰（高亮/笔记）。decorationId 对应 setDecorations 时给的 id */
  decorationClick: { layer: string; id: string; rect: DOMRect };
  /** 键盘按键（引擎已处理翻页类按键时不再派发） */
  key: { key: string; code: string; event: KeyboardEvent };
  /** 自动滚屏状态。paused=true：仍处于自动滚屏中、只是暂停了（此时 running=false，点击正文可恢复）；真正停止时 paused 为 false */
  autoScroll: { running: boolean; paused?: boolean; speed: number };
  /** 到达书末再往后翻 */
  endOfBook: void;
  error: Error;
}

export type DecorationStyle = 'highlight' | 'underline' | 'strikethrough' | 'squiggly' | 'box' | 'note-mark' | 'search' | 'tts';

export interface Decoration {
  id: string;
  range: TextRange;
  style: DecorationStyle;
  /** CSS 颜色（含透明度），缺省按 style 用默认色 */
  color?: string;
}

export type GoToTarget =
  | Locator
  | { href: string; fromSection?: number }
  | { progress: number }
  | { section: number; anchor?: string }
  | { range: TextRange; flash?: boolean };

export interface ReaderController {
  readonly book: Book;
  /** 挂到容器上并显示 at 位置（缺省为开头）。open 完成之前（以及 destroy 之后）查询类方法返回 null/false/空数组，不得抛错 */
  open(container: HTMLElement, at?: Locator): Promise<void>;
  destroy(): void;

  next(): Promise<void>;
  prev(): Promise<void>;
  nextSection(): Promise<void>;
  prevSection(): Promise<void>;
  goTo(target: GoToTarget): Promise<void>;
  getLocation(): ReaderLocation | null;

  /** 章节纯文本（偏移基准见 core/text.ts），未加载的章节会临时加载 */
  getSectionText(section: number): Promise<string>;
  /** 章节纯文本 + 段落边界 */
  getSectionTextWithBreaks(section: number): Promise<{ text: string; breaks: number[] }>;

  /** 按图层整体替换装饰（layer 如 'annotations' / 'search' / 'tts'），引擎负责在各章节渲染时应用 */
  setDecorations(layer: string, decorations: Decoration[]): void;
  /** 区间在视口中的矩形（不在当前屏返回空数组） */
  getRangeRects(range: TextRange): DOMRect[];
  /** 区间是否完整落在当前屏（朗读时决定要不要翻页） */
  isRangeVisible(range: TextRange): boolean;

  getSelection(): ReaderSelection | null;
  /** 程序化选择（选择菜单的「扩展选区」等） */
  setSelection(range: TextRange | null): void;

  /** 自动滚屏：speed 语义见 reader/settings.ts 的 autoScroll 设置 */
  startAutoScroll(): void;
  stopAutoScroll(): void;
  isAutoScrolling(): boolean;

  /** 强制重排（字体加载完成、容器尺寸变化之外的情况） */
  relayout(): Promise<void>;

  on<K extends keyof ReaderEvents>(type: K, fn: (payload: ReaderEvents[K]) => void): () => void;
}

/** 由引擎模块提供的工厂（src/reader/engine/index.ts 导出 createReader） */
export type CreateReader = (book: Book) => ReaderController;
