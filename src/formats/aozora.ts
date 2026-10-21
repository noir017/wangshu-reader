// 青空文库注音（MISC-003 / spec §4.10）：汉字《かな》→ <ruby>汉字<rt>かな</rt></ruby>。
// 底文取《前连续汉字，最多与读音等长（原版行为）；另支持青空文库的「｜底文《读音》」明示写法（原版未处理）。
// 注意偏移：《》（及 ｜）从文本里消失，读音文字进入 <rt>，charCount 要按 lineTextLength 计。
import { escapeHtml } from './lib/text';

const KANJI = /[一-鿿㐀-䶿々〆ヶ豈-﫿]/;

export function hasAozoraRuby(text: string): boolean {
  const i = text.indexOf('《');
  return i >= 0 && text.indexOf('》', i) > i;
}

interface Piece {
  /** 普通文本起点（含）与终点（不含） */
  from: number;
  to: number;
  base?: string;
  rt?: string;
}

function scan(line: string): { pieces: Piece[]; removed: number } {
  const pieces: Piece[] = [];
  let removed = 0;
  let cursor = 0;
  let i = line.indexOf('《');
  while (i >= 0) {
    const j = line.indexOf('》', i + 1);
    if (j < 0) break;
    const rt = line.slice(i + 1, j);
    if (rt.length < 1 || rt.length > 10 || rt.includes('《')) {
      i = line.indexOf('《', i + 1);
      continue;
    }
    // 明示底文：｜ 与《之间不含其他注音括号
    let k = -1;
    let piped = false;
    const bar = Math.max(line.lastIndexOf('｜', i - 1), line.lastIndexOf('|', i - 1));
    if (bar >= cursor && i - bar - 1 >= 1 && i - bar - 1 <= 20 && !/[《》]/.test(line.slice(bar + 1, i))) {
      k = bar + 1;
      piped = true;
    } else {
      k = i;
      while (k > cursor && i - k < rt.length && KANJI.test(line[k - 1])) k--;
    }
    if (k >= i) {
      i = line.indexOf('《', j + 1);
      continue;
    }
    const baseStart = k;
    const plainEnd = piped ? k - 1 : k;
    pieces.push({ from: cursor, to: plainEnd, base: line.slice(baseStart, i), rt });
    removed += 2 + (piped ? 1 : 0);
    cursor = j + 1;
    i = line.indexOf('《', cursor);
  }
  pieces.push({ from: cursor, to: line.length });
  return { pieces, removed };
}

/** 这一行转成 HTML 后的纯文本长度（= 原长 − 被删掉的《》与｜） */
export function lineTextLength(line: string): number {
  if (!line.includes('《')) return line.length;
  return line.length - scan(line).removed;
}

export function renderRubyLine(line: string): string {
  if (!line.includes('《')) return escapeHtml(line);
  let out = '';
  for (const p of scan(line).pieces) {
    out += escapeHtml(line.slice(p.from, p.to));
    if (p.base !== undefined) out += `<ruby>${escapeHtml(p.base)}<rt>${escapeHtml(p.rt!)}</rt></ruby>`;
  }
  return out;
}
