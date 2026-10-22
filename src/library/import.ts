// 导入书籍（LIB-021/040）：文件 → 指纹 id → 探测元数据与封面 → 存文件/封面/书记录。
// 目录扫描与拖放收集在 import-collect.ts；导入前选择列表与新书列表的界面在 ImportDialogs.tsx。
import type { BookRecord } from '@/core/library';
import { detectFormat, probeBook } from '@/formats';
import { getBook, getBookFile, putBook, putBookFile, updateBook } from '@/storage/db';
import { fileFingerprint } from '@/storage/fingerprint';
import { decodeEntities } from '@/storage/xml';
import { storeExtractedCover } from './covers';
import { TYPE_GROUPS } from './shelf-model';

export interface ImportItem {
  file: File;
  /** 相对所选目录的子目录（webkitRelativePath 的目录部分），用于「存储目录」分组 */
  dir?: string;
}

export interface ImportOptions {
  /** 加入收藏夹（'default_fav' = 默认分类）；不传 = 不改 */
  favorite?: string;
  /** false = 只是打开（原 tmpbooks 语义），不上书架 */
  onShelf?: boolean;
  source?: BookRecord['source'];
  signal?: AbortSignal;
  onProgress?: (p: { done: number; total: number; current: string }) => void;
}

export interface ImportFailure {
  name: string;
  reason: string;
  /** 类型不受支持（不是解析失败）：界面可以问「是否以纯文本模式打开」（LIB-035） */
  unsupported?: boolean;
}

export class UnsupportedFileError extends Error {
  constructor() {
    super('不支持此文件');
    this.name = 'UnsupportedFileError';
  }
}

/** 按纯文本重新导入：文件名加 .txt，交给 TXT 解析器（书名仍是原文件名） */
export function asTextItem(item: ImportItem): ImportItem {
  const f = item.file;
  return { ...item, file: new File([f], `${f.name}.txt`, { type: 'text/plain', lastModified: f.lastModified }) };
}

export interface ImportResult {
  added: BookRecord[];
  /** 书库里本来就有的（内容指纹相同） */
  existing: BookRecord[];
  failed: ImportFailure[];
}

export const ZERO_RESULT = (): ImportResult => ({ added: [], existing: [], failed: [] });

export function stripExt(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  return base.replace(/\.(fb2\.zip|[a-z0-9]{1,6})$/i, '') || base;
}

export function extOf(name: string): string {
  const m = /\.(fb2\.zip|[a-z0-9]{1,6})$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** 简介里常有 HTML（EPUB description）：去标签、解码实体、压缩空白；超 2000 字截断（BookInfo 构造） */
export function cleanDescription(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const t = decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  if (!t) return undefined;
  return t.length > 2000 ? t.slice(0, 2000) + '...' : t;
}

/** 原 app 导入时给无元数据格式自动打的标签（BD.createBookInfoFromFile） */
export function formatTag(format: string): string | undefined {
  switch (format) {
    case 'txt':
      return '(TXT)';
    case 'html':
    case 'md':
      return '(HTML)';
    case 'pdf':
      return 'PDF';
    case 'djvu':
      return 'DJVU';
    default:
      return undefined;
  }
}

/** 单个文件导入。已存在（同内容）时合并收藏夹/上架状态并返回 existing */
export async function importFile(item: ImportItem, opts: ImportOptions = {}): Promise<{ book: BookRecord; isNew: boolean }> {
  const { file } = item;
  const name = file.name;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const parser = detectFormat(name, head);
  if (!parser) throw new UnsupportedFileError();
  const id = await fileFingerprint(file);
  const onShelf = opts.onShelf !== false;

  const old = await getBook(id);
  if (old) {
    const patch: Partial<BookRecord> = {};
    if (onShelf && !old.onShelf) patch.onShelf = true;
    if (onShelf && opts.favorite) patch.favorite = opts.favorite;
    if (!(await getBookFile(id))) await putBookFile(id, file);
    const book = Object.keys(patch).length ? ((await updateBook(id, patch)) ?? old) : old;
    return { book, isNew: false };
  }

  let probe;
  try {
    probe = await probeBook(file, { fileName: name, signal: opts.signal });
  } catch (e) {
    throw new Error(`无法解析：${(e as Error).message}`);
  }
  const meta = probe.metadata;
  const tag = formatTag(probe.format);
  const tags = [...new Set([...(tag ? [tag] : []), ...(meta.subjects ?? []).map((s) => s.trim()).filter(Boolean)])];
  const book: BookRecord = {
    id,
    fileName: name,
    format: probe.format || parser.format,
    size: file.size,
    title: meta.title?.trim() || stripExt(name),
    authors: (meta.authors ?? []).map((a) => a.trim()).filter(Boolean),
    description: cleanDescription(meta.description),
    language: meta.language,
    publisher: meta.publisher,
    tags,
    ...(meta.series ? { series: { name: meta.series, ...(meta.seriesIndex !== undefined ? { index: meta.seriesIndex } : {}) } } : {}),
    ...(onShelf && opts.favorite ? { favorite: opts.favorite } : {}),
    addedAt: Date.now(),
    onShelf,
    source: opts.source ?? { kind: 'local', ...(item.dir ? { url: `${item.dir}/${name}` } : {}) },
    hasCover: !!probe.cover,
    chars: probe.size?.chars,
    pages: probe.size?.pages,
  };
  await putBookFile(id, file);
  if (probe.cover) await storeExtractedCover(id, probe.cover);
  await putBook(book);
  return { book, isNew: true };
}

/** 批量导入，逐个处理（避免同时解析多本撑爆内存），支持取消与进度 */
export async function importFiles(items: ImportItem[], opts: ImportOptions = {}): Promise<ImportResult> {
  const res = ZERO_RESULT();
  for (const [i, item] of items.entries()) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.({ done: i, total: items.length, current: item.file.name });
    try {
      const { book, isNew } = await importFile(item, opts);
      (isNew ? res.added : res.existing).push(book);
    } catch (e) {
      res.failed.push({ name: item.file.name, reason: (e as Error).message, unsupported: e instanceof UnsupportedFileError || undefined });
    }
  }
  opts.onProgress?.({ done: items.length, total: items.length, current: '' });
  return res;
}

// ───────────── 目录扫描的过滤 ─────────────
export interface ScanFilter {
  /** TYPE_GROUPS 的键 */
  types: string[];
  /** KB；<=0 不限 */
  minSizeKB: number;
}

export function passesScanFilter(file: { name: string; size: number }, f: ScanFilter): boolean {
  if (f.minSizeKB > 0 && file.size < f.minSizeKB * 1024) return false;
  const ext = extOf(file.name);
  return f.types.some((t) => TYPE_GROUPS[t]?.formats.includes(ext));
}

export interface ScanEntry extends ImportItem {
  /** 已在书库中（按内容指纹判断，选择列表里标「已导入」默认不勾） */
  imported?: boolean;
  /** 解析不了（扩展名受支持但内容损坏等，由调用方标记） */
  broken?: boolean;
}

/** 给扫描结果标上「已导入」（比较指纹） */
export async function markImported(entries: ScanEntry[]): Promise<ScanEntry[]> {
  for (const e of entries) {
    try {
      const b = await getBook(await fileFingerprint(e.file));
      e.imported = !!b && b.onShelf !== false;
    } catch {
      e.imported = false;
    }
  }
  return entries;
}
