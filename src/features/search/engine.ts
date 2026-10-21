// 书内搜索的纯逻辑（SRCH-001，spec 03 §4.8）：构造正则、在章节文本里找命中、生成结果摘要。

export interface SearchOptions {
  caseSensitive: boolean;
  /** 单词模式：命中两侧不能是字母/数字/下划线 */
  wholeWord: boolean;
  /** 关键词按正则解释（原版如此）；关掉则按字面 */
  regex: boolean;
}

export const MAX_RESULTS = 5000;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 构造全局正则；语法错误时抛 SyntaxError（调用方提示用户） */
export function buildRegExp(key: string, o: SearchOptions): RegExp {
  if (!key) throw new SyntaxError('empty');
  let src = o.regex ? key : escapeRe(key);
  // 用环视代替 \b：JS 的 \b 只认 ASCII 单词字符，对 CJK/重音字母没意义
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  const flags = 'gu' + (o.caseSensitive ? '' : 'i');
  try {
    return new RegExp(src, flags);
  } catch (e) {
    // 带 u 标志时语法更严格（如 \_ 非法）；整词模式必须有 u，其余退回无 u 再试
    if (o.wholeWord) throw e;
    return new RegExp(src, 'g' + (o.caseSensitive ? '' : 'i'));
  }
}

export interface Match {
  start: number;
  end: number;
}

/** 找出所有命中；零长度命中（如 ^、\b）跳过并前进，避免死循环 */
export function findMatches(text: string, re: RegExp, limit = MAX_RESULTS): Match[] {
  const out: Match[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m && out.length < limit; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** 摘要两侧各取多少字符：亚洲语言手机 30 / 平板 60；其他手机 60 / 平板 100 */
export function snippetRadius(asian: boolean, tablet: boolean): number {
  return asian ? (tablet ? 60 : 30) : tablet ? 100 : 60;
}

const PUNC = ',.;?"\':(){}[]!，。；＂”“：？（）、！\n';

const firstPunc = (s: string): number => {
  for (let i = 0; i < s.length; i++) if (PUNC.includes(s[i])) return i;
  return -1;
};
const lastPunc = (s: string): number => {
  for (let i = s.length - 1; i >= 0; i--) if (PUNC.includes(s[i])) return i;
  return -1;
};

export interface Snippet {
  pre: string;
  hit: string;
  post: string;
}

const tidy = (s: string) => s.replace(/\n　*/g, '').replace(/[\n\t]/g, '');

/**
 * 摘要（原 PrefSearch.getSentence）：命中前后各取 pl 字符，再向前/向后收缩到最近的标点（至少留 10 字符），
 * 找不到标点就退到空格，再不行取固定 15 字符；两端加 "..."。
 * 原实现的结尾判断把「命中后剩余长度」和下标混着比较（疑似笔误），这里按其意图用命中末尾的下标比较。
 */
export function makeSnippet(text: string, start: number, end: number, pl: number): Snippet {
  const from = Math.max(0, start - pl);
  const to = Math.min(text.length, end + pl);
  const ex = text.slice(from, to);
  const i = start - from;
  const j = end - from;

  let a = firstPunc(ex);
  if (a === -1 || a > i - 10) a = ex.indexOf(' ');
  if (a === -1 || a > i - 10) a = i < 15 ? 0 : i - 15;
  else a += 1; // 起点落在标点之后，不带这个标点

  let b = lastPunc(ex);
  if (b === -1 || b < j + 10) b = ex.lastIndexOf(' ');
  if (b === -1 || b < j + 10) b = ex.length - j < 15 ? ex.length : j + 15;
  else b += 1; // 终点含这个标点

  a = Math.min(a, i);
  b = Math.max(b, j);
  return {
    pre: '...' + tidy(ex.slice(a, i)).replace(/^\s+/, ''),
    hit: ex.slice(i, j).replace(/[\n\t]/g, ' '),
    post: tidy(ex.slice(j, b)).replace(/\s+$/, '') + '...',
  };
}
