// 朗读分句（TTS-002，spec 03 §4.7，原 A.getTtsLines）。
// 每句带原文区间 start/end（用于高亮）；要读出的文字 speak 另经过滤/替换（见 filter.ts）。

export type DivideMode = 0 | 1 | 2 | 3;

export interface TtsLine {
  /** 修剪后的原文（未做过滤替换） */
  text: string;
  /** 在章节文本里的区间，end 不含；含句末紧跟的标点（高亮用） */
  start: number;
  end: number;
}

/** 原 A.PUNCTUATIONS：单字符行是标点就不朗读 */
const PUNCTUATIONS = '　/ ,.;?"\':(){}[]!，。；＂”“：？《》（）、！’‘\n\t';

/**
 * 段首/段尾要修剪的字符。原 app：逗号级用较大的两组（段边界上的标点全部丢掉），
 * 句号级/整段用较小的两组（句内标点、句末的 。！？ 留在文本里，引擎读到会自然停顿）。
 * 注意：jadx 对这一段的分支条件反编译得很乱，这里按「逗号级=大集合」的语义还原，存疑。
 */
const PREFIX_SMALL = '\u3000 ,.;?:!，。；：？、！\t\n\r';
const SUFFIX_SMALL = '\u3000 ”\t\n\r';
const PREFIX_BIG = '\u3000 ,.;?"\':(){}[]「」『』!，。；＂”“：？（）、！\t\n\r';
const SUFFIX_BIG = '\u3000 ,.;:(){}[]「」『』，。；＂”“：（）、\'"\t\n\r';
/** 修剪后紧跟在原文里的这些标点要计入 end（高亮时把句号也框进去） */
const END_EXTEND = ',.;，。；?？!！';

const REGEX: Record<0 | 1 | 2, RegExp> = {
  0: /\(|\)|：|:|,|;|!|\. |\?|，|。|；|？|！|\t|\n|\r/g,
  1: /;|!|\. |\?|。|；|？|！|\t|\n|\r/g,
  2: /\n|\r/g,
};

/** 与原文等长的占位，保证偏移不变：Mr. / Mrs. / Dr. 里的句点不算句号 */
function maskAbbreviations(text: string): string {
  return text.replace(/\b(Mrs?|Dr)\./g, (m) => m.slice(0, -1) + '\u0001');
}

export function isAvailable(line: TtsLine): boolean {
  if (line.end <= line.start) return false;
  const t = line.text;
  if (t.length > 1) return true;
  return t.length === 1 && t !== '￼' && !PUNCTUATIONS.includes(t);
}

function makeLine(text: string, masked: string, from: number, to: number, mode: DivideMode): TtsLine | null {
  const prefix = mode === 0 ? PREFIX_BIG : PREFIX_SMALL;
  const suffix = mode === 0 ? SUFFIX_BIG : SUFFIX_SMALL;
  let s = from;
  let e = to;
  while (s < e && prefix.includes(masked[s])) s++;
  while (e > s && suffix.includes(masked[e - 1])) e--;
  if (e <= s) return null;
  const end = e < masked.length && END_EXTEND.includes(masked[e]) ? e + 1 : e;
  const line = { text: text.slice(s, e), start: s, end };
  return isAvailable(line) ? line : null;
}

/** 单条超过引擎上限（4000 字符）时截到 3950，免得被引擎吞掉 */
export const MAX_LINE_CHARS = 3950;

export function splitTtsLines(text: string, mode: DivideMode, base = 0): TtsLine[] {
  const out: TtsLine[] = [];
  const push = (l: TtsLine | null) => {
    if (!l) return;
    for (let at = 0; at < l.text.length; at += MAX_LINE_CHARS) {
      const part = l.text.slice(at, at + MAX_LINE_CHARS);
      out.push({ text: part, start: base + l.start + at, end: base + Math.min(l.end, l.start + at + MAX_LINE_CHARS) });
    }
  };
  if (mode === 3) {
    // 整页：不切句（整段文本一句，不高亮单句）
    if (text.trim()) push({ text, start: 0, end: text.length });
    return out;
  }
  const masked = maskAbbreviations(text);
  const re = new RegExp(REGEX[mode].source, 'g');
  let prevEnd = 0;
  let lastMatchEnd = -1;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    const iEnd = m.index + m[0].length;
    const line = makeLine(text, masked, prevEnd, iEnd, mode);
    push(line);
    // 下一段从修剪后的末尾继续（被修剪的句号等会在下一段的段首修剪里再被丢掉）
    prevEnd = line ? line.start + line.text.length : iEnd;
    lastMatchEnd = iEnd;
  }
  if (out.length === 0) push(makeLine(text, masked, 0, text.length, mode));
  else if (lastMatchEnd !== -1 && lastMatchEnd < text.length) push(makeLine(text, masked, lastMatchEnd, text.length, mode));
  return out;
}
