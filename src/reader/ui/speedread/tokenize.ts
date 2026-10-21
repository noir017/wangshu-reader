// 速读（RSVP）分词与节奏（AUTO-004，PrefSpeedRead）。纯函数，便于测试。
export interface Token {
  text: string;
  /** 在源文本里的起始偏移（退出速读时把阅读位置推进到这里） */
  start: number;
}

/** 结尾标点：粘到前一词上；开头引号/括号：粘到后一词上 */
const OPENERS = new Set(['“', '‘', '„', '(', '[', '{', '«', '‹', '¿', '¡', '《', '〈', '（', '「', '『', '【', '〔', '"', "'"]);

/** 逐词切分：CJK 用 Intl.Segmenter（逐字/词），英文按空格；孤立标点合并到邻近词 */
export function tokenize(text: string, lang?: string): Token[] {
  const out: Token[] = [];
  let pendingOpen = '';
  let pendingStart = -1;
  const push = (t: string, start: number) => {
    out.push({ text: pendingOpen + t, start: pendingStart >= 0 ? pendingStart : start });
    pendingOpen = '';
    pendingStart = -1;
  };
  const SegCtor = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }> } }).Segmenter;
  if (SegCtor) {
    const seg = new SegCtor(lang, { granularity: 'word' });
    for (const s of seg.segment(text)) {
      if (s.isWordLike) push(s.segment, s.index);
      else attachPunct(s.segment, s.index);
    }
  } else {
    // 没有 Segmenter：按空白切，CJK 逐字
    const re = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
    for (const m of text.matchAll(re)) {
      if (/^[\p{P}\p{S}]+$/u.test(m[0])) attachPunct(m[0], m.index ?? 0);
      else push(m[0], m.index ?? 0);
    }
  }

  function attachPunct(s: string, index: number): void {
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (/\s/.test(ch)) continue;
      if (OPENERS.has(ch) || !out.length) {
        if (pendingStart < 0) pendingStart = index + i;
        pendingOpen += ch;
      } else out[out.length - 1].text += ch;
    }
  }
  return out;
}

function needsSpace(a: string, b: string): boolean {
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  return !cjk.test(a.slice(-1)) && !cjk.test(b.charAt(0));
}

export function joinWords(ws: string[]): string {
  return ws.reduce((acc, w, i) => (i === 0 ? w : acc + (needsSpace(acc, w) ? ' ' : '') + w), '');
}

export interface Chunk {
  text: string;
  start: number;
  /** 第一个词在 tokens 里的下标 */
  index: number;
  words: number;
}

/** 按「每次显示词数」分组 */
export function chunkTokens(tokens: Token[], perChunk: number): Chunk[] {
  const n = Math.max(1, Math.floor(perChunk));
  const out: Chunk[] = [];
  for (let i = 0; i < tokens.length; i += n) {
    const group = tokens.slice(i, i + n);
    out.push({ text: joinWords(group.map((g) => g.text)), start: group[0].start, index: i, words: group.length });
  }
  return out;
}

const SENTENCE_END = /[.;?!。；？！]['"”’)）]*$/;

/**
 * 一个 chunk 的显示时长（毫秒）：词数 × (60000/WPM)；
 * 单词模式下词长 >10 或以句末标点结尾各额外 + min(基准/2, 100)ms（停顿）。
 */
export function chunkDelay(chunk: Chunk, wpm: number): number {
  const base = chunk.words * (60000 / Math.max(wpm, 1));
  if (chunk.words !== 1) return base;
  const extra = Math.min(base / 2, 100);
  let d = base;
  if (chunk.text.length > 10) d += extra;
  if (SENTENCE_END.test(chunk.text)) d += extra;
  return d;
}
