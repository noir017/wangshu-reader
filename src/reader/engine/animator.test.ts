import { describe, expect, it } from 'vitest';
import { flipDuration } from './animator';

describe('翻页时长（ANIM-005..009）', () => {
  it('水平切换/左右覆盖：(600 − speed×10)，按剩余距离折算，≥100ms；默认 30 → 300ms', () => {
    expect(flipDuration(3, 30)).toBe(300);
    expect(flipDuration(6, 30, 0.5)).toBe(150);
    expect(flipDuration(3, 50, 0.1)).toBe(100);
  });
  it('渐隐 = 900 − speed×10；上下滚动/覆盖 = (800 − speed×10)，剩余比例下限 0.3', () => {
    expect(flipDuration(5, 30)).toBe(600);
    expect(flipDuration(4, 30)).toBe(500);
    expect(flipDuration(7, 30, 0.1)).toBe(150);
  });
  it('仿真翻页：T0 = (60 − speed)×9（Google ×11）', () => {
    expect(flipDuration(1, 30)).toBe(270);
    expect(flipDuration(2, 30)).toBe(330);
    expect(flipDuration(1, 50)).toBe(100); // 90 → 下限 100
  });
});
