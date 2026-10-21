import { describe, expect, it } from 'vitest';
import { defaultWpm, pickSpeed, remainingMinutes, remainingText } from './remaining';

describe('剩余阅读时间（STATUS-003）', () => {
  it('默认速度：中日韩 400 字/分，其他 220 词/分', () => {
    expect(defaultWpm('zh-CN')).toBe(400);
    expect(defaultWpm('ja')).toBe(400);
    expect(defaultWpm('en')).toBe(220);
    expect(defaultWpm(undefined)).toBe(220);
  });

  it('本书累计阅读 >10 分钟才用本书速度，否则全局统计，否则默认值', () => {
    const min = 60_000;
    expect(pickSpeed({ usedMs: 20 * min, words: 8000 }, [], 'en')).toBe(400);
    expect(pickSpeed({ usedMs: 5 * min, words: 8000 }, [{ usedMs: 100 * min, words: 20000 }], 'en')).toBe(200);
    expect(pickSpeed({ usedMs: 5 * min, words: 8000 }, [{ usedMs: 5 * min, words: 1 }], 'zh')).toBe(400);
    expect(pickSpeed(undefined, [], 'en')).toBe(220);
  });

  it('剩余字数 → 分钟（非 CJK 书按 ≈5.5 字符/词折算），向上取整', () => {
    expect(remainingMinutes(4000, 400, true)).toBe(10);
    expect(remainingMinutes(4001, 400, true)).toBe(11);
    expect(remainingMinutes(5500, 100, false)).toBe(10);
    expect(remainingMinutes(0, 400, true)).toBe(0);
  });

  it('文案：整书剩余折成「小时+分钟」', () => {
    expect(remainingText(3, 135)).toContain('3');
    expect(remainingText(3, 135)).toContain('2');
  });
});
