// 格式模块对外入口（src/formats 负责实现）。其他模块只通过这里打开书，不直接引用具体解析器。
// 内部按格式拆成独立解析器（FormatParser），在 PARSERS 里注册；新增格式只需加一个文件并登记。
import type { Book, BookProbe, FormatParser, OpenOptions } from '@/core/book';
import { UnsupportedFormatError, fmtMsg } from './errors';
import { readHead } from './lib/bytes';
import { epubParser } from './epub';
import { txtParser } from './txt';

export * from './errors';
export { countWords, extractIsbn, metaFromFileName } from './lib/text';
export { TEXT_ENCODINGS, detectEncoding, normalizeEncoding } from './encoding';
export { txtSettings, htmlSettings } from './settings';

/** 注册表。顺序即嗅探优先级（具体格式在前，兜底的 TXT 在最后） */
const PARSERS: FormatParser[] = [epubParser, txtParser];

/** 文件名里的候选扩展名，长的在前：a.fb2.zip → ['fb2.zip', 'zip'] */
function candidateExts(fileName: string): string[] {
  const base = (fileName.split('?').pop() ?? fileName).split(/[\\/]/).pop()!.toLowerCase();
  const parts = base.split('.');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(i).join('.'));
  return out.slice(0, 2);
}

/** 文件头看起来是文本（没有二进制控制字符） */
function looksLikeText(head: Uint8Array): boolean {
  if (!head.length) return true;
  let ctrl = 0;
  const n = Math.min(head.length, 2048);
  for (let i = 0; i < n; i++) {
    const c = head[i];
    if (c === 0 || (c < 9) || (c > 13 && c < 32 && c !== 27)) ctrl++;
  }
  return ctrl / n < 0.02;
}

/** 识别格式：先按扩展名，其次按文件头嗅探；都不认且像文本时按 TXT（与原 app「未知扩展名当 TXT」一致，但二进制会被拒绝）；不支持返回 null */
export function detectFormat(fileName: string, head?: Uint8Array): FormatParser | null {
  for (const ext of candidateExts(fileName)) {
    const hit = PARSERS.find((p) => p.extensions.includes(ext));
    if (hit) return hit;
  }
  if (head) {
    const hit = PARSERS.find((p) => p.sniff?.(head, fileName));
    if (hit) return hit;
    if (looksLikeText(head)) return txtParser;
  }
  return null;
}

/** 支持打开的全部扩展名（小写、不带点），文件选择框 accept 用 */
export function supportedExtensions(): string[] {
  const set = new Set<string>();
  for (const p of PARSERS) for (const e of p.extensions) if (!e.includes('.')) set.add(e);
  return [...set].sort();
}

async function pick(file: Blob, opts: OpenOptions): Promise<FormatParser> {
  const head = await readHead(file, 4096);
  const parser = detectFormat(opts.fileName, head);
  if (!parser) throw new UnsupportedFormatError(fmtMsg('unsupportedNamed', { name: opts.fileName }));
  return parser;
}

/** 按扩展名（不可信时按文件头）选择解析器打开整本书 */
export async function openBook(file: Blob, opts: OpenOptions): Promise<Book> {
  return (await pick(file, opts)).open(file, opts);
}

/** 导入书架用的轻量探测：元数据 + 封面 */
export async function probeBook(file: Blob, opts: OpenOptions): Promise<BookProbe> {
  return (await pick(file, opts)).probe(file, opts);
}
