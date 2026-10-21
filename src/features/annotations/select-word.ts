// 点选取词（ANNO-001）：从点中的字符向两侧扩展到分隔符；亚洲语言默认「单字模式」只选中该字。
// 原 app：A.PUNCTUATIONS + isSplitChar；点在标点上先左移到非标点。

/** 原 A.PUNCTUATIONS */
export const PUNCTUATIONS = '　/ ,.;?"\':(){}[]!，。；＂”“：？《》（）、！’‘\n\t';

const isPunct = (ch: string) => PUNCTUATIONS.includes(ch) || /\s/.test(ch);
/** Unicode 类别 OTHER_LETTER（汉字、假名、谚文…）：单字模式下每个字独立成词 */
const isOtherLetter = (ch: string) => /^\p{Lo}$/u.test(ch);

function charAt(text: string, i: number): string {
  const cp = text.codePointAt(i);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/** i 若落在代理对后半，退到前半 */
function alignStart(text: string, i: number): number {
  const c = text.charCodeAt(i);
  return c >= 0xdc00 && c <= 0xdfff && i > 0 ? i - 1 : i;
}

export interface WordOptions {
  /** 单字模式（oneCharDict） */
  oneChar?: boolean;
  locale?: string;
}

export function wordRangeAt(text: string, offset: number, opts: WordOptions = {}): { start: number; end: number } | null {
  if (!text) return null;
  let i = alignStart(text, Math.max(0, Math.min(offset, text.length - 1)));
  // 点在标点/空白上：先左移到非标点，左边没有再右移
  if (isPunct(charAt(text, i))) {
    let l = i;
    while (l > 0 && isPunct(charAt(text, l))) l--;
    if (!isPunct(charAt(text, l))) i = alignStart(text, l);
    else {
      let r = i;
      while (r < text.length && isPunct(charAt(text, r))) r++;
      if (r >= text.length) return null;
      i = r;
    }
  }
  const ch = charAt(text, i);
  if (opts.oneChar && isOtherLetter(ch)) return { start: i, end: i + ch.length };

  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<{ index: number; segment: string; isWordLike?: boolean }> } }).Segmenter;
  if (Seg) {
    // 只在附近窗口分词，避免对整章文本分词
    const from = Math.max(0, i - 80);
    const to = Math.min(text.length, i + 80);
    const win = text.slice(from, to);
    for (const seg of new Seg(opts.locale, { granularity: 'word' }).segment(win)) {
      const s = from + seg.index;
      const e = s + seg.segment.length;
      if (i >= s && i < e && seg.isWordLike) return { start: s, end: e };
    }
  }
  // 兜底：向两侧扩展到分隔符；单字模式下遇到其他字母也停
  let s = i;
  while (s > 0) {
    const p = charAt(text, alignStart(text, s - 1));
    if (isPunct(p) || (opts.oneChar && isOtherLetter(p))) break;
    s = alignStart(text, s - 1);
  }
  let e = i + ch.length;
  while (e < text.length) {
    const n = charAt(text, e);
    if (isPunct(n) || (opts.oneChar && isOtherLetter(n))) break;
    e += n.length;
  }
  return e > s ? { start: s, end: e } : null;
}

/** 没有坐标时（selection.start 不带 x,y）：选页首起的第一句，至多 limit 字符 */
export function firstSentenceFrom(text: string, from: number, limit = 120): { start: number; end: number } | null {
  let s = from;
  while (s < text.length && /[\s　]/.test(text[s])) s++;
  if (s >= text.length) return null;
  let e = s;
  const stop = '。！？；.!?;\n';
  while (e < text.length && e - s < limit) {
    e++;
    if (stop.includes(text[e - 1])) break;
  }
  return { start: s, end: e };
}
