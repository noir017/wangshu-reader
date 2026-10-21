import { describe, expect, it } from 'vitest';
import { bookSpeed, computeStatCards, dateRange, dayToDate } from './stats';
import { dayNumber } from '@/storage/db';

describe('统计卡片', () => {
  const stats = [
    { bookId: 'a', usedMs: 3_600_000, words: 6000, pages: 60, days: { 100: { ms: 1_800_000, words: 3000 }, 101: { ms: 1_800_000, words: 3000 } } },
    { bookId: 'b', usedMs: 1_800_000, words: 3000, pages: 30, days: { 101: { ms: 1_800_000, words: 3000 } } },
  ];
  it('按 STAT-003 口径计算', () => {
    const c = computeStatCards([{ onShelf: true }, { onShelf: false }, { onShelf: true }], stats, 5);
    expect(c.books).toBe(2);
    expect(c.readBooks).toBe(5);
    expect(c.hours).toBeCloseTo(1.5);
    expect(c.pages).toBe(90);
    expect(c.hoursPerDay).toBeCloseTo(0.75); // 2 个不同的日子
    expect(c.secPerPage).toBeCloseTo(60);
    expect(c.pagesPerHour).toBeCloseTo(60);
    expect(c.wordsPerMinute).toBeCloseTo(100);
  });
  it('没有数据时不除零', () => {
    const c = computeStatCards([], [], 0);
    expect(c).toMatchObject({ hours: 0, pages: 0, secPerPage: 0, pagesPerHour: 0, wordsPerMinute: 0, empty: true });
    expect(Number.isFinite(c.hoursPerDay)).toBe(true);
  });
  it('单书速度与日期范围', () => {
    expect(bookSpeed(stats[0])).toBe(100);
    expect(bookSpeed(undefined)).toBe(0);
    const d = dayNumber(Date.UTC(2026, 9, 21, 12));
    expect(dayToDate(d)).toMatch(/^2026-10-2[01]$/);
    expect(dateRange({ days: { [d]: { ms: 1, words: 1 } } })).toBe(dayToDate(d));
    expect(dateRange({ days: { [d]: { ms: 1, words: 1 }, [d + 3]: { ms: 1, words: 1 } } })).toContain(' - ');
  });
});
