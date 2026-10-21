// 格式模块对外入口（src/formats 负责实现）。其他模块只通过这里打开书，不直接引用具体解析器。
// 内部按格式拆成独立解析器（FormatParser），在 PARSERS 里注册；新增格式只需加一个文件并登记。
import type { Book, BookProbe, FormatParser, OpenOptions } from '@/core/book';
import { UnsupportedFormatError, fmtMsg } from './errors';
import { make7zParser, makeRarParser, makeZipParser } from './archive';
import { cbzParser } from './cbz';
import { docxParser } from './docx';
import { epubParser } from './epub';
import { fb2Parser } from './fb2';
import { htmlParser } from './html';
import { readHead, startsWithAscii } from './lib/bytes';
import { candidateExts } from './lib/names';
import { markdownParser } from './markdown';
import { mobiParser } from './mobi';
import { odtParser } from './odt';
import { pdfParser } from './pdf';
import { rtfParser } from './rtf';
import { cb7Parser, cbrParser, chmParser, djvuParser } from './server-formats';
import { txtParser } from './txt';
import { umdParser } from './umd';

export * from './errors';
export { countWords, extractIsbn, metaFromFileName } from './lib/text';
export { TEXT_ENCODINGS, detectEncoding, normalizeEncoding } from './encoding';
export { txtSettings, htmlSettings } from './settings';

const getParsers = () => PARSERS;

// 靠文件头认出 ODT：zip 第一个条目是 mimetype，内容 application/vnd.oasis.opendocument.text
const odtSniff: FormatParser['sniff'] = (head) => startsWithAscii(head, 'PK') && new TextDecoder('latin1').decode(head.subarray(30, 120)).includes('application/vnd.oasis.opendocument.text');
const docxSniff: FormatParser['sniff'] = (head) => startsWithAscii(head, 'PK') && new TextDecoder('latin1').decode(head.subarray(0, 4096)).includes('word/');

/** 注册表。顺序即嗅探优先级（具体格式在前，通用的 zip 与兜底的 TXT 在最后） */
const PARSERS: FormatParser[] = [
  epubParser,
  pdfParser,
  fb2Parser,
  umdParser,
  mobiParser,
  rtfParser,
  { ...odtParser, sniff: odtSniff },
  { ...docxParser, sniff: docxSniff },
  cbzParser,
  chmParser,
  cbrParser,
  cb7Parser,
  djvuParser,
  makeZipParser(getParsers),
  makeRarParser(getParsers),
  make7zParser(getParsers),
  markdownParser,
  htmlParser,
  txtParser,
];

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
