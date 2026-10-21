// 统一书籍模型：所有格式解析器（src/formats）都产出这里的 Book，阅读引擎只认这套接口。
// 两类：reflowable（可重排：EPUB/TXT/MOBI/FB2/HTML/DOCX…）与 fixed（固定版式：PDF/漫画）。

export type BookFormat =
  | 'epub'
  | 'txt'
  | 'pdf'
  | 'mobi'
  | 'azw3'
  | 'fb2'
  | 'html'
  | 'md'
  | 'docx'
  | 'odt'
  | 'rtf'
  | 'umd'
  | 'chm'
  | 'cbz'
  | 'cbr'
  | 'cb7'
  | 'djvu'
  | (string & {});

export interface BookMetadata {
  title: string;
  authors: string[];
  language?: string;
  publisher?: string;
  description?: string;
  subjects?: string[];
  series?: string;
  seriesIndex?: number;
  /** isbn / uuid / calibre 等 */
  identifiers?: Record<string, string>;
  /** ISO 日期或原样字符串 */
  published?: string;
  /** 阅读方向；漫画/竖排中文/阿拉伯文等 */
  direction?: 'ltr' | 'rtl';
}

/** 位置：章节（fixed 书为页）序号 + 章节纯文本内的字符偏移 */
export interface Locator {
  /** reflowable：sections 下标；fixed：页下标（0 起） */
  section: number;
  /** 章节纯文本中的 UTF-16 偏移。纯文本 = 章节 body 内文本节点按文档顺序拼接（不含 script/style），见 core/text.ts */
  offset: number;
}

/** 文本区间（标注、搜索命中、朗读高亮共用）。start/end 为同一章节内的偏移，end 不含 */
export interface TextRange {
  section: number;
  start: number;
  end: number;
}

export interface TocEntry {
  title: string;
  level: number;
  /** 指向的章节（fixed 书为页） */
  section: number;
  /** 章节内锚点 id（EPUB 的 #fragment） */
  anchor?: string;
  children?: TocEntry[];
}

/** 章节加载结果：已清洗（无脚本）的 body 内容 + 书内样式，资源 URL 已改写成 blob:/data: */
export interface SectionContent {
  /** <body> 的 innerHTML */
  bodyHtml: string;
  /** body 上需要保留的属性（class、dir、lang 等） */
  bodyAttrs?: Record<string, string>;
  /** 书内 CSS 文本（已把 url() 改写成 blob:/data:），按出现顺序 */
  styles: string[];
  lang?: string;
  dir?: 'ltr' | 'rtl';
}

export interface BookSection {
  /** 稳定 id（EPUB idref、TXT 的 'c12' 等），用于跨次打开定位 */
  id: string;
  /** 章节标题（TXT 分章、无目录格式时由解析器给出） */
  title?: string;
  /** 是否在主线阅读顺序中（EPUB linear="no" 为 false） */
  linear: boolean;
  /** 纯文本长度（字符数）估算，用于全书进度与总页数估算；可以不精确，但要稳定 */
  charCount: number;
  load(): Promise<SectionContent>;
}

interface BookBase {
  format: BookFormat;
  metadata: BookMetadata;
  toc: TocEntry[];
  /** 封面图（可能没有） */
  getCover(): Promise<Blob | null>;
  /** 释放 blob URL、worker 等资源 */
  destroy(): void;
}

export interface ReflowableBook extends BookBase {
  kind: 'reflowable';
  sections: BookSection[];
  /**
   * 解析书内链接。href 为章节内 <a href> 的原始值，fromSection 为链接所在章节。
   * 返回 null 表示外部链接（http/mailto 等）或无法解析。
   */
  resolveHref(href: string, fromSection: number): { section: number; anchor?: string } | null;
  /** 脚注：若该链接指向的是脚注/尾注，返回其 HTML 片段供弹窗显示（FB2/EPUB3 noteref 等） */
  getFootnote?(href: string, fromSection: number): Promise<string | null>;
}

export interface FixedPageText {
  /** 本页纯文本（偏移基准同 Locator.offset） */
  text: string;
  /** 每个字符（或文本块）在页面上的位置，归一化到 0..1；用于选择/高亮/搜索定位 */
  items: { start: number; end: number; x: number; y: number; w: number; h: number }[];
}

export interface FixedBook extends BookBase {
  kind: 'fixed';
  pageCount: number;
  /** 页面原始尺寸（PDF pt / 图片像素），用于排版缩放 */
  getPageSize(index: number): Promise<{ width: number; height: number }>;
  /** 渲染一页。width/height 为目标 CSS 像素，dpr 为设备像素比；返回可直接画到 canvas 上的图像 */
  renderPage(index: number, opts: { width: number; height: number; dpr: number; signal?: AbortSignal }): Promise<CanvasImageSource>;
  /** 页面文本层（PDF 有，漫画没有） */
  getPageText?(index: number): Promise<FixedPageText | null>;
}

export type Book = ReflowableBook | FixedBook;

export interface OpenOptions {
  fileName: string;
  /** TXT 等无编码声明格式的强制编码（如 'gbk'），不给则自动检测 */
  encoding?: string;
  signal?: AbortSignal;
  /** 解析器专用选项（如 TXT 分章规则），由各格式自行定义与读取 */
  extra?: Record<string, unknown>;
}

/** 导入书架时的轻量探测：不完整解析，只取元数据和封面 */
export interface BookProbe {
  format: BookFormat;
  metadata: BookMetadata;
  cover: Blob | null;
  /** 粗略总字数/页数，书架上显示用 */
  size?: { chars?: number; pages?: number };
}

export interface FormatParser {
  format: BookFormat;
  /** 小写扩展名，不带点；如 ['epub'] / ['txt','text','log'] */
  extensions: string[];
  /** 需要服务端才能打开（如 RAR/CHM 先由服务端解包或转换） */
  needsServer?: boolean;
  /** 按文件头嗅探（扩展名不可信时用） */
  sniff?(head: Uint8Array, fileName: string): boolean;
  open(file: Blob, opts: OpenOptions): Promise<Book>;
  probe(file: Blob, opts: OpenOptions): Promise<BookProbe>;
}
