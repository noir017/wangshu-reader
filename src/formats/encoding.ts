// 文本编码检测与解码（FMT-002，spec §4.1 的 Web 版）。
// 原版按「界面语言」猜编码，这里改为按内容判断：BOM → 无 BOM 的 UTF-16 → 严格 UTF-8 → 逐个候选编码解码后按常用字命中率打分。
// 解码一律用浏览器 TextDecoder（gbk/gb18030/big5/shift_jis/euc-jp/euc-kr/windows-125x/koi8-r…）；UTF-32 自己解。

export interface DetectedEncoding {
  /** TextDecoder 标签（小写）：'utf-8' | 'utf-16le' | 'gbk' | 'big5' | … */
  encoding: string;
  /** BOM 字节数（解码时已由 decodeBytes 处理，调用方一般不用关心） */
  bom: number;
  /** 0..1，粗略置信度；BOM/纯 ASCII/严格 UTF-8 为 1 */
  confidence: number;
}

/** 供界面「文字编码」下拉用，顺序与原 app 的 R.array.charsets 接近；value 即 opts.encoding 可传的值 */
export const TEXT_ENCODINGS: { value: string; label: string }[] = [
  { value: 'auto', label: 'AUTO' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16LE' },
  { value: 'utf-16be', label: 'UTF-16BE' },
  { value: 'utf-32le', label: 'UTF-32LE' },
  { value: 'utf-32be', label: 'UTF-32BE' },
  { value: 'gbk', label: 'GBK / GB2312' },
  { value: 'gb18030', label: 'GB18030' },
  { value: 'big5', label: 'BIG5' },
  { value: 'shift_jis', label: 'SHIFT-JIS' },
  { value: 'euc-jp', label: 'EUC-JP' },
  { value: 'iso-2022-jp', label: 'ISO-2022-JP' },
  { value: 'euc-kr', label: 'EUC-KR' },
  { value: 'koi8-r', label: 'KOI8-R' },
  { value: 'ibm866', label: 'CP866' },
  { value: 'windows-874', label: 'CP874' },
  { value: 'macintosh', label: 'Macintosh' },
  ...['1250', '1251', '1252', '1253', '1254', '1255', '1256', '1257', '1258'].map((n) => ({ value: `windows-${n}`, label: `Windows-${n}` })),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16].map((n) => ({ value: `iso-8859-${n}`, label: `ISO-8859-${n}` })),
];

/** 把用户/原 app 风格的编码名（GB2312、Windows-950、US-ASCII…）规整成 TextDecoder 标签；不支持返回 null */
export function normalizeEncoding(label: string | undefined | null): string | null {
  if (!label) return null;
  const l = label.trim().toLowerCase().replace(/_/g, '-');
  if (!l || l === 'auto') return null;
  const alias: Record<string, string> = {
    'utf8': 'utf-8',
    'utf-16': 'utf-16le',
    'utf16': 'utf-16le',
    'utf-32': 'utf-32le',
    'utf32': 'utf-32le',
    'ucs-2': 'utf-16le',
    'gb2312': 'gbk',
    'euc-cn': 'gbk',
    'cp936': 'gbk',
    'windows-936': 'gbk',
    'windows-950': 'big5',
    'cp950': 'big5',
    'big5-hkscs': 'big5',
    'sjis': 'shift_jis',
    'shift-jis': 'shift_jis',
    'x-sjis': 'shift_jis',
    'windows-31j': 'shift_jis',
    'cp932': 'shift_jis',
    'us-ascii': 'windows-1252',
    'ascii': 'windows-1252',
    'latin1': 'windows-1252',
    'iso-8859-1': 'windows-1252',
    'cp866': 'ibm866',
    'cp874': 'windows-874',
    'x-jis7': 'iso-2022-jp',
    'x-jis8': 'shift_jis',
  };
  const target = alias[l] ?? l;
  if (target === 'utf-32le' || target === 'utf-32be') return target;
  try {
    return new TextDecoder(target).encoding; // 规范名，如 'gbk'、'shift_jis'、'windows-1252'
  } catch {
    return null;
  }
}

function decodeUtf32(bytes: Uint8Array, le: boolean): string {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.byteLength >> 2;
  const parts: string[] = [];
  let buf: number[] = [];
  for (let i = 0; i < n; i++) {
    let cp = dv.getUint32(i * 4, le);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
    buf.push(cp);
    if (buf.length >= 8192) {
      parts.push(String.fromCodePoint(...buf));
      buf = [];
    }
  }
  if (buf.length) parts.push(String.fromCodePoint(...buf));
  return parts.join('');
}

/** 按编码解码。会去掉对应 BOM；非法序列变成 U+FFFD，不抛错。encoding 必须已规整（见 normalizeEncoding） */
export function decodeBytes(bytes: Uint8Array, encoding: string): string {
  if (encoding === 'utf-32le' || encoding === 'utf-32be') {
    let b = bytes;
    const bomLe = b.length >= 4 && b[0] === 0xff && b[1] === 0xfe && b[2] === 0 && b[3] === 0;
    const bomBe = b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff;
    if ((encoding === 'utf-32le' && bomLe) || (encoding === 'utf-32be' && bomBe)) b = b.subarray(4);
    return decodeUtf32(b, encoding === 'utf-32le');
  }
  return new TextDecoder(encoding).decode(bytes); // 默认 ignoreBOM=false：UTF-8/16 的 BOM 会被剥掉
}

// ───────────────────────── 打分用的常用字表 ─────────────────────────
// 简体 + 繁体各取高频字（共有字重复无妨），正确编码下命中率通常 >25%，错配时多落在生僻字里 <8%
const ZH_COMMON = new Set(
  Array.from(
    '的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山无水' +
      '這來個說們為時過學對裡後麼發開見經頭長從兩樣現將與進實點種聲兒話問機給幾業間電門東聽氣關內們書讀寫國會應體間當將還愛樂',
  ),
);
const KO_COMMON = new Set(Array.from('이다는에의가을를은로하고한서도지기으리자시수대아사인정나일그제것어보부없있라마여장전상년들과와해면게니미소못되만말안중신오우위동공주구'));
const RU_COMMON = new Set(Array.from('оеаинтсрвлкмдпу'));

interface Stat {
  nonAscii: number;
  bad: number;
  cjk: number;
  zhCommon: number;
  kana: number;
  halfKana: number;
  hangul: number;
  koCommon: number;
  cyrLetters: number;
  ruCommon: number;
  /** 不属于任何正常文字/标点区间的字符（框线、私用区、生僻符号…），错配编码的典型产物 */
  weird: number;
}

function stat(s: string): Stat {
  const st: Stat = { nonAscii: 0, bad: 0, cjk: 0, zhCommon: 0, kana: 0, halfKana: 0, hangul: 0, koCommon: 0, cyrLetters: 0, ruCommon: 0, weird: 0 };
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) continue;
    st.nonAscii++;
    if (cp === 0xfffd) st.bad++;
    else if (cp >= 0x4e00 && cp <= 0x9fff) {
      st.cjk++;
      if (ZH_COMMON.has(ch)) st.zhCommon++;
    } else if (cp >= 0x3040 && cp <= 0x30ff) st.kana++;
    else if (cp >= 0xff61 && cp <= 0xff9f) st.halfKana++;
    else if (cp >= 0xac00 && cp <= 0xd7af) {
      st.hangul++;
      if (KO_COMMON.has(ch)) st.koCommon++;
    } else if (cp >= 0x0430 && cp <= 0x044f) {
      st.cyrLetters++;
      if (RU_COMMON.has(ch)) st.ruCommon++;
    } else if (cp >= 0x0400 && cp <= 0x04ff) st.cyrLetters++;
    else if (
      (cp >= 0x00a0 && cp <= 0x024f) || // Latin-1 补充与扩展
      (cp >= 0x2000 && cp <= 0x206f) || // 常用标点
      (cp >= 0x3000 && cp <= 0x303f) || // CJK 标点
      (cp >= 0xff00 && cp <= 0xff60) || // 全角形式
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20a0 && cp <= 0x20cf) || // 货币
      (cp >= 0x2190 && cp <= 0x21ff) || // 箭头
      (cp >= 0x3400 && cp <= 0x4dbf) // 扩展 A 区汉字：偶有出现，不算错配
    ) {
      /* 中性 */
    } else st.weird++;
  }
  return st;
}

interface Candidate {
  enc: string;
  plaus: (st: Stat) => number;
}

const junk = (st: Stat, extra = 0) => 1 - Math.min(1, ((st.bad + st.weird + extra) / Math.max(1, st.nonAscii)) * 3);
const zhPlaus = (st: Stat) => (st.cjk >= 3 ? (st.zhCommon / st.cjk) * junk(st, st.halfKana) : 0);
const jaPlaus = (st: Stat) => {
  const script = st.cjk + st.kana;
  if (st.kana < 3 || script === 0) return 0;
  const half = st.halfKana / Math.max(1, st.kana + st.halfKana);
  return (st.kana / script) * (1 - half) * junk(st);
};
const koPlaus = (st: Stat) => (st.hangul >= 3 ? (st.koCommon / st.hangul) * junk(st, st.halfKana) : 0);
const ruPlaus = (st: Stat) => (st.cyrLetters >= 8 ? (st.ruCommon / st.cyrLetters) * junk(st, st.halfKana) : 0);

const CANDIDATES: Candidate[] = [
  { enc: 'gbk', plaus: zhPlaus },
  { enc: 'big5', plaus: zhPlaus },
  { enc: 'shift_jis', plaus: jaPlaus },
  { enc: 'euc-jp', plaus: jaPlaus },
  { enc: 'euc-kr', plaus: koPlaus },
  { enc: 'windows-1251', plaus: ruPlaus },
  { enc: 'koi8-r', plaus: ruPlaus },
  { enc: 'ibm866', plaus: ruPlaus },
];

const SAMPLE = 64 * 1024;

/** 严格 UTF-8 校验（容忍末尾被截断的多字节序列） */
function strictUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}

function countFffd(s: string): number {
  let n = 0;
  for (let i = s.indexOf('�'); i >= 0; i = s.indexOf('�', i + 1)) n++;
  return n;
}

/** 无 BOM 的 UTF-16：ASCII 为主的文本里 NUL 字节会规律地出现在奇数位（LE）或偶数位（BE） */
function sniffUtf16NoBom(b: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(b.length, 4096) & ~1;
  if (n < 8) return null;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < n; i += 2) {
    if (b[i] === 0) even++;
    if (b[i + 1] === 0) odd++;
  }
  const pairs = n / 2;
  if (odd > pairs * 0.3 && even < pairs * 0.05) return 'utf-16le';
  if (even > pairs * 0.3 && odd < pairs * 0.05) return 'utf-16be';
  return null;
}

export function detectEncoding(bytes: Uint8Array): DetectedEncoding {
  const n = bytes.length;
  if (n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', bom: 3, confidence: 1 };
  if (n >= 4 && bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) return { encoding: 'utf-32le', bom: 4, confidence: 1 };
  if (n >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff) return { encoding: 'utf-32be', bom: 4, confidence: 1 };
  if (n >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', bom: 2, confidence: 1 };
  if (n >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', bom: 2, confidence: 1 };
  if (n === 0) return { encoding: 'utf-8', bom: 0, confidence: 1 };

  const head = bytes.subarray(0, Math.min(n, SAMPLE));
  const u16 = sniffUtf16NoBom(head);
  if (u16) return { encoding: u16, bom: 0, confidence: 0.9 };

  let ascii = true;
  let esc = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c >= 0x80) {
      ascii = false;
      break;
    }
    if (c === 0x1b) esc = true;
  }
  if (ascii) return { encoding: esc ? 'iso-2022-jp' : 'utf-8', bom: 0, confidence: esc ? 0.8 : 1 };

  // UTF-8：头部严格校验；再抽查中段和尾部（对齐到字符边界），防止只有开头是 ASCII
  if (strictUtf8(head)) {
    let ok = true;
    if (n > SAMPLE * 2) {
      for (const at of [Math.floor(n / 2), n - SAMPLE]) {
        let s = at;
        while (s < n && (bytes[s] & 0xc0) === 0x80) s++;
        if (!strictUtf8(bytes.subarray(s, Math.min(n, s + SAMPLE)))) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return { encoding: 'utf-8', bom: 0, confidence: 1 };
  }
  // 近似 UTF-8：只有零星坏字节（文件被截断/拼接），仍当 UTF-8
  {
    const text = new TextDecoder('utf-8').decode(head);
    const bad = countFffd(text);
    if (bad > 0 && bad / Math.max(1, text.length) < 0.0005) return { encoding: 'utf-8', bom: 0, confidence: 0.7 };
  }

  let best: { enc: string; score: number } | null = null;
  const clean: string[] = [];
  for (const c of CANDIDATES) {
    let text: string;
    try {
      text = new TextDecoder(c.enc).decode(head);
    } catch {
      continue;
    }
    const st = stat(text);
    const score = c.plaus(st);
    if (st.bad === 0 && st.weird === 0 && st.halfKana === 0) clean.push(c.enc);
    if (!best || score > best.score + 1e-9) best = { enc: c.enc, score };
  }
  if (best && best.score >= 0.04) return { encoding: best.enc, bom: 0, confidence: Math.min(1, 0.4 + best.score) };
  // 样本太短、证据不足：优先选解出来没有乱码的东亚编码，否则当西欧文本
  if (clean.length) return { encoding: clean[0], bom: 0, confidence: 0.3 };
  return { encoding: 'windows-1252', bom: 0, confidence: 0.2 };
}

/** 解码结果 + 实际使用的编码。encoding 为 'auto' / 空 / 不支持时自动检测 */
export function decodeAuto(bytes: Uint8Array, encoding?: string | null): { text: string; encoding: string; detected: boolean } {
  const forced = normalizeEncoding(encoding ?? undefined);
  if (forced) return { text: decodeBytes(bytes, forced), encoding: forced, detected: false };
  const d = detectEncoding(bytes);
  return { text: decodeBytes(bytes, d.encoding), encoding: d.encoding, detected: true };
}

/**
 * 标记语言（XML/HTML）解码：BOM → XML 声明 / <meta charset> → 自动检测。
 * 声明里写的编码不被支持时退回自动检测。
 */
export function decodeMarkup(bytes: Uint8Array, hint?: string | null): { text: string; encoding: string } {
  const forced = normalizeEncoding(hint ?? undefined);
  if (forced) return { text: decodeBytes(bytes, forced), encoding: forced };
  const d0 = detectEncoding(bytes.subarray(0, Math.min(bytes.length, 4)));
  if (d0.bom || d0.encoding.startsWith('utf-16') || d0.encoding.startsWith('utf-32')) {
    const d = detectEncoding(bytes);
    return { text: decodeBytes(bytes, d.encoding), encoding: d.encoding };
  }
  const probe = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const m = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(probe) ?? /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(probe);
  const declared = normalizeEncoding(m?.[1]);
  if (declared && declared !== 'utf-8') {
    const text = decodeBytes(bytes, declared);
    return { text, encoding: declared };
  }
  if (declared === 'utf-8' && strictUtf8(bytes.subarray(0, Math.min(bytes.length, SAMPLE)))) return { text: decodeBytes(bytes, 'utf-8'), encoding: 'utf-8' };
  const d = detectEncoding(bytes);
  return { text: decodeBytes(bytes, d.encoding), encoding: d.encoding };
}
