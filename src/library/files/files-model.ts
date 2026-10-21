// 文件页的纯逻辑：路径（含压缩包内 '?' 路径）、排序、类型判断（LIB-028）。
import type { LibraryEntry } from '@shared/api';

export interface PathParts {
  /** 文件系统路径（目录，或压缩包文件本身） */
  fs: string;
  /** 压缩包内路径；undefined = 不在压缩包里 */
  inner?: string;
}

export function splitPath(p: string): PathParts {
  const i = p.indexOf('?');
  return i < 0 ? { fs: p } : { fs: p.slice(0, i), inner: p.slice(i + 1) };
}

export function joinPath(dir: string, name: string): string {
  const { fs, inner } = splitPath(dir);
  if (inner !== undefined) return `${fs}?${inner ? inner + '/' : ''}${name}`;
  return dir ? `${dir.replace(/\/+$/, '')}/${name}` : name;
}

export function parentPath(p: string): string {
  const { fs, inner } = splitPath(p);
  if (inner !== undefined) {
    if (!inner) return fs; // 压缩包根 → 回到它所在的目录视图里（压缩包文件路径）
    const up = inner.split('/').slice(0, -1).join('/');
    return up ? `${fs}?${up}` : fs;
  }
  const segs = fs.split('/').filter(Boolean);
  return segs.slice(0, -1).join('/');
}

/** 进入压缩包后，"上一级" 应回到压缩包所在目录而不是压缩包自身 */
export function upFrom(p: string): string {
  const { fs, inner } = splitPath(p);
  if (inner === undefined) return parentPath(p);
  if (inner === '') return parentPath(fs);
  return parentPath(p);
}

export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbs(p: string, rootName: string): Crumb[] {
  const { fs, inner } = splitPath(p);
  const out: Crumb[] = [{ name: rootName, path: '' }];
  let acc = '';
  for (const seg of fs.split('/').filter(Boolean)) {
    acc = acc ? `${acc}/${seg}` : seg;
    out.push({ name: seg, path: acc });
  }
  if (inner) {
    let ia = '';
    for (const seg of inner.split('/').filter(Boolean)) {
      ia = ia ? `${ia}/${seg}` : seg;
      out.push({ name: seg, path: `${fs}?${ia}` });
    }
  }
  return out;
}

export type FileSort = 0 | 1 | 2 | 3 | 4 | 5; // 名称↑↓ 大小↑↓ 时间↑↓

const nameCmp = new Intl.Collator(['zh-Hans-CN', 'en'], { numeric: true, sensitivity: 'base' });

/** 目录在前；文件里「阅读器支持的格式」在前，其他在后；再按所选排序 */
export function sortEntries(entries: LibraryEntry[], by: FileSort, isBook: (name: string) => boolean): LibraryEntry[] {
  const key = Math.floor(by / 2);
  const dir = by % 2 === 0 ? 1 : -1;
  const cmp = (a: LibraryEntry, b: LibraryEntry) => (key === 0 ? nameCmp.compare(a.name, b.name) : key === 1 ? a.size - b.size || nameCmp.compare(a.name, b.name) : a.mtime - b.mtime || nameCmp.compare(a.name, b.name)) * dir;
  const rank = (e: LibraryEntry) => (e.dir ? 0 : isBook(e.name) ? 1 : 2);
  return [...entries].sort((a, b) => rank(a) - rank(b) || cmp(a, b));
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i;
export const isImageName = (n: string) => IMAGE_EXT.test(n);

/** zip/rar/7z 浏览；cbz/cbr/cb7 是漫画，点开当书读（菜单里仍可浏览） */
export const isBrowsableArchive = (e: Pick<LibraryEntry, 'name' | 'archive'>) => !!e.archive && !/\.(cbz|cbr|cb7)$/i.test(e.name);

export function fileExt(name: string): string {
  const m = /\.([a-z0-9]{1,6})$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}
