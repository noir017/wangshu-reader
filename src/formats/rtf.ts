// RTF（FMT-016）：只抽文本（段落、制表、常见标点、\uN 与 \'hh 按字体字符集/代码页解码），\info 里的标题作者；无图/无样式。
// 抽出的文本交给 TXT 的分章与分段流程，所以也能得到目录。
import type { Book, BookProbe, FormatParser, OpenOptions } from '@/core/book';
import { normalizeEncoding } from './encoding';
import { corrupt, UnsupportedFormatError } from './errors';
import { readBytes, startsWithAscii } from './lib/bytes';
import { countWords, metaFromFileName } from './lib/text';
import { buildTxtBook, normalizeNewlines } from './txt';

const CODEPAGE: Record<number, string> = {
  437: 'windows-1252', 850: 'windows-1252', 866: 'ibm866', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252',
  1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258', 10000: 'macintosh', 65001: 'utf-8',
};
const CHARSET_CP: Record<number, number> = { 0: 1252, 128: 932, 129: 949, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250 };

const SKIP_DEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable', 'revtbl', 'generator', 'filetbl', 'rsidtbl', 'mmathPr', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'footnote', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'xmlnstbl', 'fldinst', 'bkmkstart', 'bkmkend', 'shpinst', 'private']);
const SYMBOLS: Record<string, string> = { emdash: '—', endash: '–', emspace: ' ', enspace: ' ', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', tab: '\t', line: '\n', par: '\n', sect: '\n', page: '\n', cell: '\t', row: '\n', nestcell: '\t', nestrow: '\n' };

interface RtfResult {
  text: string;
  title?: string;
  author?: string;
}

export function parseRtf(src: string): RtfResult {
  const info: { title?: string; author?: string } = {};
  let out = '';
  let defaultCp = 1252;
  const fontCp = new Map<number, number>();
  interface St {
    skip: boolean;
    uc: number;
    font: number;
    cap?: 'title' | 'author';
    capText: string;
  }
  const stack: St[] = [];
  let st: St = { skip: false, uc: 1, font: -1, capText: '' };
  let pending: number[] = [];
  let ucSkip = 0;
  const emit = (s: string) => {
    if (st.skip) return;
    if (st.cap) st.capText += s;
    else out += s;
  };
  const flushBytes = () => {
    if (!pending.length) return;
    const cp = (st.font >= 0 ? fontCp.get(st.font) : undefined) ?? defaultCp;
    const enc = normalizeEncoding(CODEPAGE[cp] ?? 'windows-1252') ?? 'windows-1252';
    emit(new TextDecoder(enc).decode(Uint8Array.from(pending)));
    pending = [];
  };
  let i = 0;
  const n = src.length;
  let lastFontDef = -1;
  while (i < n) {
    const c = src[i];
    if (c === '{') {
      flushBytes();
      stack.push({ ...st });
      st = { ...st, cap: undefined, capText: '' };
      i++;
    } else if (c === '}') {
      flushBytes();
      if (st.cap && st.capText.trim()) info[st.cap] = st.capText.trim();
      st = stack.pop() ?? st;
      i++;
    } else if (c === '\\') {
      i++;
      const d = src[i];
      if (d === undefined) break;
      if (d === "'") {
        const hex = src.slice(i + 1, i + 3);
        i += 3;
        if (ucSkip > 0) {
          ucSkip--;
          continue;
        }
        const v = parseInt(hex, 16);
        if (!Number.isNaN(v)) pending.push(v);
        continue;
      }
      flushBytes();
      if (!/[a-zA-Z]/.test(d)) {
        i++;
        if (d === '\\' || d === '{' || d === '}') emit(d);
        else if (d === '~') emit(' ');
        else if (d === '_') emit('-');
        else if (d === '*') {
          // 可忽略的目标：整组跳过（\*\title 等已知有用的除外）
          const m = /^\\([a-z]+)/i.exec(src.slice(i, i + 20));
          if (!m || !['title', 'author'].includes(m[1])) st.skip = true;
        } else if (d === '\n' || d === '\r') emit('\n');
        continue;
      }
      let j = i;
      while (j < n && /[a-zA-Z]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let k = j;
      if (src[k] === '-') k++;
      while (k < n && /[0-9]/.test(src[k])) k++;
      const param = k > j ? parseInt(src.slice(j, k), 10) : undefined;
      i = k;
      if (src[i] === ' ') i++; // 控制字后的一个空格是分隔符
      if (ucSkip > 0) {
        // \uN 之后的替代字符：只吞普通文本，不吞控制字
      }
      if (SKIP_DEST.has(word)) {
        st.skip = true;
        continue;
      }
      switch (word) {
        case 'ansicpg':
          if (param) defaultCp = param;
          break;
        case 'f':
          if (param !== undefined) {
            st.font = param;
            lastFontDef = param;
          }
          break;
        case 'fcharset':
          if (param !== undefined && lastFontDef >= 0 && CHARSET_CP[param]) fontCp.set(lastFontDef, CHARSET_CP[param]);
          break;
        case 'uc':
          if (param !== undefined) st.uc = param;
          break;
        case 'u': {
          if (param === undefined) break;
          const cp = param < 0 ? param + 65536 : param;
          emit(String.fromCharCode(cp));
          ucSkip = st.uc;
          break;
        }
        case 'bin':
          if (param) i += param;
          break;
        case 'title':
          st.cap = 'title';
          st.capText = '';
          break;
        case 'author':
          st.cap = 'author';
          st.capText = '';
          break;
        case 'pard':
        case 'plain':
          break;
        default:
          if (SYMBOLS[word] !== undefined) emit(SYMBOLS[word]);
      }
    } else if (c === '\r' || c === '\n') {
      i++;
    } else {
      // 普通文字；\uN 后面跟的替代字符要跳过
      if (ucSkip > 0) {
        ucSkip--;
        i++;
        continue;
      }
      flushBytes();
      let j = i;
      while (j < n && src[j] !== '\\' && src[j] !== '{' && src[j] !== '}' && src[j] !== '\r' && src[j] !== '\n') j++;
      emit(src.slice(i, j));
      i = j;
    }
  }
  flushBytes();
  return { text: normalizeNewlines(out).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'), ...info };
}

async function readRtf(file: Blob): Promise<RtfResult> {
  const bytes = await readBytes(file);
  if (!startsWithAscii(bytes, '{\\rtf')) throw new UnsupportedFormatError();
  try {
    return parseRtf(new TextDecoder('latin1').decode(bytes));
  } catch (e) {
    throw corrupt(e);
  }
}

export const rtfParser: FormatParser = {
  format: 'rtf',
  extensions: ['rtf'],
  sniff: (head) => startsWithAscii(head, '{\\rtf'),
  async open(file, opts): Promise<Book> {
    const r = await readRtf(file);
    const fm = metaFromFileName(opts.fileName);
    return buildTxtBook(r.text, opts, { encoding: 'rtf', detected: false }, { format: 'rtf', metadata: { title: r.title?.trim() || fm.title, authors: r.author?.trim() ? [r.author.trim()] : fm.authors } });
  },
  async probe(file, opts): Promise<BookProbe> {
    const r = await readRtf(file);
    const fm = metaFromFileName(opts.fileName);
    return { format: 'rtf', metadata: { title: r.title?.trim() || fm.title, authors: r.author?.trim() ? [r.author.trim()] : fm.authors }, cover: null, size: { chars: countWords(r.text) } };
  },
};
