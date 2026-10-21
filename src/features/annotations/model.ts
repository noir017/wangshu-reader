// 标注的纯逻辑：上下文截取、偏移失效后的模糊重定位、装饰生成、排序与筛选。不依赖 DOM/React，便于单测。
import type { TextRange } from '@/core/book';
import type { AnnotationRecord, HighlightStyle } from '@/core/library';
import type { Decoration } from '@/core/reader';

/** prefix/suffix 取多长（ANNO-009：前后各约 32 字） */
export const QUOTE_CONTEXT = 32;

export function quoteAround(text: string, start: number, end: number, n = QUOTE_CONTEXT): { prefix: string; suffix: string } {
  return { prefix: text.slice(Math.max(0, start - n), start), suffix: text.slice(end, end + n) };
}

export interface RelocateInput {
  range: TextRange;
  text: string;
  prefix?: string;
  suffix?: string;
}

export interface Relocated {
  start: number;
  end: number;
  /** 相对存储偏移是否移动过 */
  moved: boolean;
}

function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** 上下文吻合度：prefix 与命中前文的公共后缀 + suffix 与命中后文的公共前缀 */
function contextScore(text: string, start: number, end: number, a: RelocateInput): number {
  let score = 0;
  if (a.prefix) score += commonSuffixLen(text.slice(Math.max(0, start - a.prefix.length), start), a.prefix);
  if (a.suffix) score += commonPrefixLen(text.slice(end, end + a.suffix.length), a.suffix);
  return score;
}

/** 逐字相同的比例（简繁转换后长度不变、字不同时的兜底判断） */
function similarity(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let same = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  return same / Math.max(a.length, b.length);
}

/**
 * 校验并重定位一条标注。
 * 1) 存储偏移处文本与原文一致 → 原样返回；
 * 2) 在全文找原文的所有出现位置，按「前后文吻合度」优先、离原偏移近优先选一个；
 * 3) 原文被改写（简繁转换等）但前后文还在：用 prefix 尾 / suffix 头夹出区间；
 * 4) 长度没变且逐字相似度 ≥ 0.5：认为只是字形不同，保持原偏移；
 * 都不行返回 null（孤儿标注：列表里仍显示，正文不渲染）。
 */
export function relocate(sectionText: string, a: RelocateInput): Relocated | null {
  const { start, end } = a.range;
  const quote = a.text;
  if (!quote) {
    return start <= sectionText.length ? { start, end: Math.min(end, sectionText.length), moved: false } : null;
  }
  if (end <= sectionText.length && sectionText.slice(start, end) === quote) return { start, end, moved: false };

  const occ: number[] = [];
  for (let i = sectionText.indexOf(quote); i !== -1 && occ.length < 500; i = sectionText.indexOf(quote, i + 1)) occ.push(i);
  if (occ.length) {
    let best = occ[0];
    let bestScore = -Infinity;
    for (const i of occ) {
      // 上下文吻合度权重远大于距离：距离只用来在同分时取最近
      const score = contextScore(sectionText, i, i + quote.length, a) * 1e6 - Math.abs(i - start);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return { start: best, end: best + quote.length, moved: best !== start };
  }

  const pTail = a.prefix?.slice(-12);
  const sHead = a.suffix?.slice(0, 12);
  if (pTail && sHead) {
    let bestPair: { s: number; e: number; d: number } | undefined;
    for (let p = sectionText.indexOf(pTail); p !== -1; p = sectionText.indexOf(pTail, p + 1)) {
      const s = p + pTail.length;
      const e = sectionText.indexOf(sHead, s);
      if (e === -1) continue;
      const len = e - s;
      if (len < quote.length * 0.5 || len > quote.length * 1.5 + 4) continue;
      const d = Math.abs(s - start);
      if (!bestPair || d < bestPair.d) bestPair = { s, e, d };
    }
    if (bestPair) return { start: bestPair.s, end: bestPair.e, moved: bestPair.s !== start || bestPair.e !== end };
  }

  if (end <= sectionText.length && similarity(sectionText.slice(start, end), quote) >= 0.5) return { start, end, moved: false };
  return null;
}

/** 一条标注是否画成装饰（书签、已删除的不画） */
export function isRenderable(a: AnnotationRecord): boolean {
  return a.kind === 'highlight' && !a.deletedAt && a.range.end > a.range.start;
}

export const NOTE_MARK_SUFFIX = ':note';

/**
 * 标注 → 引擎装饰。带笔记的另加一个 note-mark（落在起点首字上，引擎在那里画笔图标），id = `<id>:note`。
 * overrides：重定位后的区间（id → 区间；null = 找不到，不画）。
 */
export function toDecorations(list: AnnotationRecord[], overrides?: Map<string, { start: number; end: number } | null>): Decoration[] {
  const out: Decoration[] = [];
  for (const a of list) {
    if (!isRenderable(a)) continue;
    const o = overrides?.get(a.id);
    if (o === null) continue; // 孤儿：位置已无法定位，正文里不画
    const start = o?.start ?? a.range.start;
    const end = o?.end ?? a.range.end;
    if (end <= start) continue;
    out.push({ id: a.id, range: { section: a.range.section, start, end }, style: a.style as HighlightStyle, color: a.color || undefined });
    if (a.note) out.push({ id: a.id + NOTE_MARK_SUFFIX, range: { section: a.range.section, start, end: start + 1 }, style: 'note-mark', color: a.color || undefined });
  }
  return out;
}

export function annotationIdOfDecoration(decorationId: string): string {
  return decorationId.endsWith(NOTE_MARK_SUFFIX) ? decorationId.slice(0, -NOTE_MARK_SUFFIX.length) : decorationId;
}

// ───────────── 列表：筛选与排序（ANNO-008） ─────────────

/** 0 全部 / 1 仅书签 / 2 仅标注（有笔记文字）/ 3 仅高亮（无笔记文字） */
export type AnnotFilter = 0 | 1 | 2 | 3;

export function matchFilter(a: AnnotationRecord, f: AnnotFilter): boolean {
  switch (f) {
    case 1:
      return a.kind === 'bookmark';
    case 2:
      return a.kind === 'highlight' && !!a.note;
    case 3:
      return a.kind === 'highlight' && !a.note;
    default:
      return true;
  }
}

/** 关键字（不区分大小写）匹配书签名或 笔记+原文 */
export function matchKeyword(a: AnnotationRecord, kw: string): boolean {
  if (!kw) return true;
  const k = kw.toLowerCase();
  const hay = a.kind === 'bookmark' ? (a.title ?? a.text) : `${a.note ?? ''}${a.text}`;
  return hay.toLowerCase().includes(k);
}

export function sortAnnotations(list: AnnotationRecord[], byTime: boolean, reversed: boolean): AnnotationRecord[] {
  const out = [...list];
  if (byTime) out.sort((a, b) => b.createdAt - a.createdAt);
  else out.sort((a, b) => a.range.section - b.range.section || a.range.start - b.range.start || a.createdAt - b.createdAt);
  return reversed ? out.reverse() : out;
}

/** 同一位置只存一条（ANNO-009）：书签按 (section,start)，高亮按 (section,start,end) */
export function findSamePosition(list: AnnotationRecord[], probe: { kind: AnnotationRecord['kind']; range: TextRange }): AnnotationRecord | undefined {
  return list.find(
    (a) =>
      !a.deletedAt &&
      a.kind === probe.kind &&
      a.range.section === probe.range.section &&
      a.range.start === probe.range.start &&
      (probe.kind === 'bookmark' || a.range.end === probe.range.end),
  );
}

/** 列表里出现过的颜色（颜色筛选用，去重保序） */
export function usedColors(list: AnnotationRecord[]): string[] {
  const seen = new Set<string>();
  for (const a of list) if (a.color) seen.add(a.color.toLowerCase());
  return [...seen];
}
