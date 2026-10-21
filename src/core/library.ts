// 书库数据模型（IndexedDB 中的记录形状）。实现见 src/storage/db.ts。
// 对应原 app 的 mrbooks.db（books/notes/statistics/tmpbooks）与 positions10 等（docs/spec/01-library.md §4）。
import type { BookFormat, Locator, TextRange } from './book';

export interface BookRecord {
  /** 稳定 id：文件内容指纹（见 storage/fingerprint.ts），同内容不同文件名视为同一本书 */
  id: string;
  /** 原始文件名（含扩展名）；与原 app 的 .po/.an 云同步按文件名互通时用 */
  fileName: string;
  format: BookFormat;
  /** 字节数 */
  size: number;
  title: string;
  authors: string[];
  description?: string;
  language?: string;
  publisher?: string;
  /** 标签（原 category 中的标签行） */
  tags: string[];
  /** 系列（原 category 中的 <系列名 与 #序号#） */
  series?: { name: string; index?: number };
  /** 收藏夹名；'' 或缺省 = 未收藏，'default_fav' = 默认收藏夹（LIB-014） */
  favorite?: string;
  addedAt: number;
  lastReadAt?: number;
  /** 置顶时间（LIB-017），越新越靠前 */
  pinnedAt?: number;
  /** 手动拖拽排序序号（LIB-018） */
  manualOrder?: number;
  /** false = 只打开过、未加入书架（原 tmpbooks） */
  onShelf: boolean;
  /** 手动阅读状态（LIB-016）：1 未读 / 2 在读 / 3 已读；缺省由进度推导 */
  readState?: 1 | 2 | 3;
  /** 缓存的阅读进度 0..1（书架显示用；权威值在 positions） */
  progress?: number;
  /** 来源（网络书库下载、服务端书库、URL…） */
  source?: { kind: 'local' | 'opds' | 'server-library' | 'url'; url?: string; catalog?: string };
  /** 是否有封面（covers 里有 'cover' 记录） */
  hasCover: boolean;
  /** 粗略规模：字数（可重排书）或页数（PDF/漫画） */
  chars?: number;
  pages?: number;
}

export type CoverKind = 'thumb' | 'cover' | 'edit' | 'net';

export interface PositionRecord {
  bookId: string;
  locator: Locator;
  /** 0..1 */
  progress: number;
  updatedAt: number;
  deviceId: string;
  /** 格式专用附加状态（PDF 缩放/偏移、滚动模式 Y 等） */
  extra?: Record<string, unknown>;
}

export type AnnotationKind = 'bookmark' | 'highlight';
export type HighlightStyle = 'highlight' | 'underline' | 'strikethrough' | 'squiggly';

/** 书签、高亮、笔记（原 notes 表）。笔记 = 带 note 文本的高亮 */
export interface AnnotationRecord {
  id: string;
  bookId: string;
  kind: AnnotationKind;
  /** 书签：start=end=书签位置 */
  range: TextRange;
  /** 被标注的原文（书签为该处开头一段文字）。偏移失效（换编码、书内容变化）时用 prefix+text+suffix 模糊重定位 */
  text: string;
  /** 原文前后各约 32 字的上下文（W3C TextQuote 思路，ANNO-009） */
  prefix?: string;
  suffix?: string;
  /** 笔记内容 */
  note?: string;
  /** 书签名（原 bookmark 列） */
  title?: string;
  /** CSS 颜色 #rrggbb 或 #rrggbbaa */
  color: string;
  style: HighlightStyle;
  /** 所在章节标题（列表显示用，写入时快照） */
  chapterTitle?: string;
  /** 写入时的全书进度，列表排序/显示百分比用 */
  progress?: number;
  createdAt: number;
  updatedAt: number;
  /** 软删除时间（同步时作为墓碑传播，见 SYNC-003） */
  deletedAt?: number;
}

/** 阅读统计（原 statistics 表）。dayNumber = 本地日期的 Math.floor(本地毫秒 / 86400000) */
export interface ReadingStatRecord {
  bookId: string;
  usedMs: number;
  words: number;
  days: Record<number, { ms: number; words: number }>;
  /** 翻过的页数（STAT-003 第 3/5/6 张卡片）；老记录没有 */
  pages?: number;
  /** 按 dayNumber 记的翻页数 */
  dayPages?: Record<number, number>;
}

export interface FontRecord {
  id: string;
  /** CSS font-family 名 */
  family: string;
  fileName: string;
  blob: Blob;
  addedAt: number;
}
