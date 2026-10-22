// Types for the vendored foliate-js mobi.js (only the surface wangshu-reader uses).
export interface MobiMetadata {
  identifier?: string;
  title?: string;
  author?: string[];
  publisher?: string;
  /** EXTH 里是数组，MOBI 头里是字符串 */
  language?: string | string[];
  published?: string;
  description?: string;
  subject?: string[];
  rights?: string;
  contributor?: string[];
}

export interface MobiExth {
  isbn?: string;
  asin?: string;
  boundary?: number;
  fixedLayout?: string;
  coverOffset?: number;
  thumbnailOffset?: number;
  pageProgressionDirection?: string;
  [k: string]: unknown;
}

export interface MobiTocItem {
  label: string;
  href: string;
  subitems?: MobiTocItem[];
}

export interface MobiSection {
  id?: number;
  /** KF8 里没有片段的空骨架为 'no'（此时没有 loadText） */
  linear?: 'no';
  size?: number;
  loadText?: () => Promise<string>;
}

export interface MobiBookBase {
  mobi: MOBI;
  sections: MobiSection[];
  toc?: MobiTocItem[];
  metadata: MobiMetadata;
  getCover(): Promise<Blob | undefined>;
  destroy(): void;
}

export interface Mobi6Book extends MobiBookBase {
  /** 同步：filepos:N → 章节下标 */
  resolveHref(href: string): { index: number; anchor: unknown };
}

export interface Kf8Book extends MobiBookBase {
  dir?: string;
  loadFlow(index: number): Promise<Uint8Array>;
  resolveHref(href: string): Promise<{ index: number; selector?: string; anchor: unknown } | undefined>;
}

export class MOBI6 implements Mobi6Book {
  constructor(mobi: MOBI);
  init(): Promise<Mobi6Book>;
  mobi: MOBI;
  sections: MobiSection[];
  toc?: MobiTocItem[];
  metadata: MobiMetadata;
  getCover(): Promise<Blob | undefined>;
  destroy(): void;
  resolveHref(href: string): { index: number; anchor: unknown };
}

export class KF8 implements Kf8Book {
  constructor(mobi: MOBI);
  init(): Promise<Kf8Book>;
  mobi: MOBI;
  sections: MobiSection[];
  toc?: MobiTocItem[];
  metadata: MobiMetadata;
  dir?: string;
  getCover(): Promise<Blob | undefined>;
  destroy(): void;
  loadFlow(index: number): Promise<Uint8Array>;
  resolveHref(href: string): Promise<{ index: number; selector?: string; anchor: unknown } | undefined>;
}

export class MOBI {
  constructor(opts: { unzlib: (data: Uint8Array) => Uint8Array | Promise<Uint8Array> });
  headers: {
    palmdoc: { compression: number; numTextRecords: number; recordSize: number; encryption: number };
    mobi: { version: number; uid: number; encoding: number; language?: string };
    exth: MobiExth | null;
  };
  /** 第一个 PalmDOC 头里的 encryption 字段：0 无，1/2 为 Mobipocket DRM */
  encryption: number;
  isKF8: boolean;
  openHeaders(file: Blob): Promise<boolean>;
  open(file: Blob): Promise<Mobi6Book | Kf8Book>;
  decode(data: Uint8Array | ArrayBuffer): string;
  getMetadata(): MobiMetadata;
  getCover(): Promise<Blob | undefined>;
  loadResource(index: number): Promise<ArrayBuffer | Uint8Array>;
}

export function isMOBI(file: Blob): Promise<boolean>;
