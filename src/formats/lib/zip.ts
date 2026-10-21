// zip 访问封装（jszip）。EPUB/CBZ/DOCX/ODT/FB2.ZIP/压缩包书都走这里。
import JSZip from 'jszip';
import { decodeBytes, decodeMarkup, guessNameEncoding } from '../encoding';
import { mimeOf } from './mime';

export interface ZipArchive {
  /** 全部文件条目（不含目录），原始路径 */
  readonly names: string[];
  has(path: string): boolean;
  /** 容错解析路径：精确 → 去掉前导 ./ 与 / → 百分号解码 → 忽略大小写；找不到返回 null */
  resolve(path: string): string | null;
  /** 解压后字节数（未知为 0） */
  size(path: string): number;
  bytes(path: string): Promise<Uint8Array>;
  /** 按 UTF-8 读；XML/HTML 请用 markup() 以处理声明的编码 */
  text(path: string): Promise<string>;
  /** 标记语言文本：BOM / XML 声明 / meta charset / 自动检测 */
  markup(path: string): Promise<string>;
  blob(path: string, type?: string): Promise<Blob>;
}

export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function joinPath(dir: string, rel: string): string {
  return normalizePath(dir ? `${dir}/${rel}` : rel);
}

export function safeDecodeURI(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export async function openZip(source: Blob | Uint8Array | ArrayBuffer): Promise<ZipArchive> {
  const data = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source instanceof Uint8Array ? source : new Uint8Array(source);
  // 没有 UTF-8 标志位的文件名（FMT-001：旧 Windows 压缩软件按系统代码页写 GBK/Big5/Shift_JIS）：
  // 第一遍只收集原始字节，整包一起猜编码，再按它重新读一遍目录（只在出现这种名字时才多读一遍）
  const raw: Uint8Array[] = [];
  const collect = (bytes: ArrayLike<number>) => {
    const u = Uint8Array.from(bytes);
    raw.push(u);
    return String.fromCharCode(...u);
  };
  let zip = await JSZip.loadAsync(data, { decodeFileName: collect as never });
  if (raw.length) {
    const enc = guessNameEncoding(raw);
    zip = await JSZip.loadAsync(data, { decodeFileName: ((bytes: ArrayLike<number>) => decodeBytes(Uint8Array.from(bytes), enc)) as never });
  }
  const names: string[] = [];
  const lower = new Map<string, string>();
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    names.push(path);
    const key = path.toLowerCase();
    if (!lower.has(key)) lower.set(key, path);
  });
  const exact = new Set(names);

  const resolve = (path: string): string | null => {
    const tries = [path, path.replace(/^(\.\/|\/)+/, '')];
    const dec = safeDecodeURI(tries[1]);
    if (dec !== tries[1]) tries.push(dec);
    for (const t of tries) if (exact.has(t)) return t;
    for (const t of tries) {
      const hit = lower.get(t.toLowerCase());
      if (hit) return hit;
    }
    return null;
  };

  const need = (path: string) => {
    const real = resolve(path);
    const file = real ? zip.file(real) : null;
    if (!file) throw new Error(`压缩包内找不到 ${path}`);
    return file;
  };

  return {
    names,
    has: (p) => resolve(p) !== null,
    resolve,
    size(path) {
      const real = resolve(path);
      const f = real ? zip.file(real) : null;
      const data = (f as unknown as { _data?: { uncompressedSize?: number } } | null)?._data;
      return data?.uncompressedSize ?? 0;
    },
    bytes: (p) => need(p).async('uint8array'),
    async text(p) {
      return new TextDecoder('utf-8').decode(await need(p).async('uint8array'));
    },
    async markup(p) {
      return decodeMarkup(await need(p).async('uint8array')).text;
    },
    async blob(p, type) {
      return new Blob([await need(p).async('uint8array') as BlobPart], { type: type ?? mimeOf(p) });
    },
  };
}
