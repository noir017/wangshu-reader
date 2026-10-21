import { describe, expect, it } from 'vitest';
import { lineModePeriod, pageThreshold, pixelsPerSecond, rollingLinePeriod, rollingStep, scrollInterval } from './autoscroll';

describe('自动滚屏公式（§4.6 / AUTO-003）', () => {
  it('像素模式周期与步长：规格例子', () => {
    expect(scrollInterval(2, 0)).toBe(20); // speed=0 → 每 20ms 50px
    expect(pixelsPerSecond(2, 0)).toBe(1800); // 2500px/s 被上限截到 1800
    expect(scrollInterval(2, 49)).toBe(20);
    expect(pixelsPerSecond(2, 49)).toBeCloseTo(50, 5); // 49 → 20ms/1px
    expect(scrollInterval(2, 50)).toBe(30);
    expect(pixelsPerSecond(2, 50)).toBeCloseTo(33.33, 1);
    expect(scrollInterval(2, 100)).toBe(530); // 按公式 (100−49)·10+20；规格文字里的「520」是约数
    expect(pixelsPerSecond(2, 100)).toBeCloseTo(1.89, 1);
  });
  it('越慢越小、单调', () => {
    let prev = Infinity;
    for (let s = 0; s <= 100; s += 5) {
      const v = pixelsPerSecond(2, s);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
  it('逐行：周期 = ⌈speed/5⌉ × 100ms（speed=50 → 1 行/秒，100 → 2 秒）', () => {
    expect(lineModePeriod(50)).toBe(1000);
    expect(lineModePeriod(100)).toBe(2000);
    expect(lineModePeriod(0)).toBe(100);
  });
  it('逐页阈值随速度增大', () => {
    expect(pageThreshold(0)).toBeLessThan(pageThreshold(50));
    expect(pageThreshold(50)).toBeLessThan(pageThreshold(100));
    // speed=50：f=7，(49/12)×3000/100 = 122.5 个 100ms tick
    expect(pageThreshold(50)).toBeCloseTo(122.5, 1);
  });
  it('卷帘·像素：步进（整数除法）与周期', () => {
    expect(rollingStep(50)).toBe(1);
    expect(rollingStep(0)).toBe(Math.floor((11 * 55) / 5));
    expect(scrollInterval(0, 50)).toBe(40);
    expect(scrollInterval(0, 100)).toBe(190);
    expect(pixelsPerSecond(0, 50)).toBe(25);
  });
  it('卷帘·行：周期随速度', () => {
    expect(scrollInterval(1, 50)).toBeCloseTo(100, 5);
    expect(rollingLinePeriod(50)).toBeGreaterThan(rollingLinePeriod(10));
  });
});
