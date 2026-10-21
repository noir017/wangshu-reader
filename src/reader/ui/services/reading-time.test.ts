import { describe, expect, it, vi } from 'vitest';
import { ReadingTracker, countWords } from './reading-time';

function tracker(opts: { visible?: () => boolean; flushMs?: number } = {}) {
  let now = 1_000_000;
  const save = vi.fn();
  const tr = new ReadingTracker({ save, now: () => now, isVisible: opts.visible, flushMs: opts.flushMs ?? 30_000 });
  const advance = (ms: number, step = 1000) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      tr.tick();
    }
  };
  return { tr, save, advance, at: () => now, set: (n: number) => (now = n) };
}

describe('countWords（T.getWordsCount）', () => {
  it('中日韩按字，其余按词', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('山不在高')).toBe(4);
    expect(countWords('Hello, world! 你好')).toBe(4);
    expect(countWords('it\'s 3.5 ok')).toBeGreaterThanOrEqual(4);
  });
});

describe('阅读时长采集（STAT-001）', () => {
  it('有操作期间每秒累计；定时与退出时写库并清零', () => {
    const { tr, save, advance } = tracker({ flushMs: 5000 });
    advance(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBeGreaterThanOrEqual(4000);
    tr.addWords(120);
    tr.addWords(-5); // 负数忽略
    advance(1000);
    tr.flush();
    expect(save.mock.calls.at(-1)).toEqual([1000, 120]);
    tr.flush();
    expect(save).toHaveBeenCalledTimes(2); // 没有新数据不再写
  });

  it('页面不可见时不计时', () => {
    let visible = false;
    const { tr, save, advance } = tracker({ visible: () => visible });
    advance(10_000);
    tr.flush();
    expect(save).not.toHaveBeenCalled();
    visible = true;
    advance(3000);
    tr.flush();
    expect(save.mock.calls[0][0]).toBe(3000);
  });

  it('10 分钟无操作后停止计时；再次操作补记 1 分钟', () => {
    const { tr, save, advance } = tracker({ flushMs: 1e12 });
    advance(11 * 60_000);
    tr.flush();
    const idle = save.mock.calls[0][0] as number;
    expect(idle).toBeLessThanOrEqual(10 * 60_000 + 10_000);
    advance(60_000); // 空闲中，不再累计
    tr.touch();
    tr.flush();
    expect(save.mock.calls[1][0]).toBe(60_000);
  });

  it('自动滚屏/朗读期间（exempt）不判空闲，也不计入「连续阅读」', () => {
    const { tr, save, advance } = tracker({ flushMs: 1e12 });
    tr.setExempt(true);
    advance(15 * 60_000);
    tr.flush();
    expect(save.mock.calls[0][0]).toBeGreaterThan(14 * 60_000);
    expect(tr.sessionMs).toBe(0);
  });

  it('连续阅读计时可重置（健康提醒后）', () => {
    const { tr, advance } = tracker({ flushMs: 1e12 });
    advance(20_000);
    expect(tr.sessionMs).toBeGreaterThanOrEqual(19_000);
    tr.resetSession();
    expect(tr.sessionMs).toBe(0);
  });
});
