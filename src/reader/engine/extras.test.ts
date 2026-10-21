import { describe, expect, it } from 'vitest';
import { looksLikeNoteMarker } from './extras';

describe('注解标记识别', () => {
  it('短的数字/括号/上标是标记', () => {
    for (const t of ['1', '[12]', '(3)', '（4）', '*', '†', '²', '注', ' [1] ']) {
      // 「注」不是数字：应当不算
      expect(looksLikeNoteMarker(t), t).toBe(t !== '注');
    }
  });
  it('长文字不是标记；epub:type=noteref 一律是', () => {
    expect(looksLikeNoteMarker('点此查看详细说明')).toBe(false);
    expect(looksLikeNoteMarker('跳到第十段')).toBe(false);
    expect(looksLikeNoteMarker('下一章')).toBe(false);
    expect(looksLikeNoteMarker('说明', 'noteref')).toBe(true);
    expect(looksLikeNoteMarker('')).toBe(false);
  });
});
