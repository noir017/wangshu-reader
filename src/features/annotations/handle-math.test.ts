import { describe, expect, it } from 'vitest';
import { dragRange } from './handle-math';

describe('选择手柄区间', () => {
  const cur = { section: 2, start: 10, end: 20 };
  it('拖终点：向后扩、向前缩，但至少留一个字', () => {
    expect(dragRange(cur, 'end', { section: 2, offset: 30 })).toEqual({ section: 2, start: 10, end: 30 });
    expect(dragRange(cur, 'end', { section: 2, offset: 14 })).toEqual({ section: 2, start: 10, end: 14 });
    expect(dragRange(cur, 'end', { section: 2, offset: 3 })).toEqual({ section: 2, start: 10, end: 11 });
  });
  it('拖起点：向前扩、向后缩，不越过终点，不小于 0', () => {
    expect(dragRange(cur, 'start', { section: 2, offset: 4 })).toEqual({ section: 2, start: 4, end: 20 });
    expect(dragRange(cur, 'start', { section: 2, offset: 50 })).toEqual({ section: 2, start: 19, end: 20 });
    expect(dragRange(cur, 'start', { section: 2, offset: -5 })).toEqual({ section: 2, start: 0, end: 20 });
  });
  it('命中别的章：忽略', () => {
    expect(dragRange(cur, 'end', { section: 3, offset: 30 })).toBeNull();
  });
});
