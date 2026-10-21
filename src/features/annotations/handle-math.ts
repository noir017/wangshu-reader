// 选择手柄的区间计算（纯逻辑，便于单测）。
import type { TextRange } from '@/core/book';

export type Which = 'start' | 'end';

/** 拖动后的新区间：不能反转/塌缩，保持同一章；跨章时返回 null（忽略这次移动） */
export function dragRange(cur: TextRange, which: Which, hit: { section: number; offset: number }): TextRange | null {
  if (hit.section !== cur.section) return null;
  if (which === 'start') return { ...cur, start: Math.max(0, Math.min(hit.offset, cur.end - 1)) };
  return { ...cur, end: Math.max(cur.start + 1, hit.offset) };
}
