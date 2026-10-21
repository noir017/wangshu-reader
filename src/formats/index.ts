// 格式模块对外入口（src/formats 负责实现）。其他模块只通过这里打开书，不直接引用具体解析器。
import type { Book, BookProbe, FormatParser, OpenOptions } from '@/core/book';

/** 按扩展名（不可信时按文件头）选择解析器打开整本书 */
export async function openBook(_file: Blob, _opts: OpenOptions): Promise<Book> {
  throw new Error('formats.openBook 尚未实现');
}

/** 导入书架用的轻量探测：元数据 + 封面 */
export async function probeBook(_file: Blob, _opts: OpenOptions): Promise<BookProbe> {
  throw new Error('formats.probeBook 尚未实现');
}

/** 识别格式；不支持返回 null */
export function detectFormat(_fileName: string, _head?: Uint8Array): FormatParser | null {
  return null;
}

/** 支持打开的全部扩展名（小写、不带点），文件选择框 accept 用 */
export function supportedExtensions(): string[] {
  return [];
}
