import { describe, expect, it } from 'vitest';
import { DEFAULT_BAR, moveItem, normalizeBar, splitBar, toggleItem, type BarItem } from './toolbar-config';

describe('选择条配置', () => {
  it('出厂：前 7 项勾选，其余未勾；主按钮 4 个，其余进「更多」', () => {
    expect(DEFAULT_BAR.filter((i) => i.on).map((i) => i.id)).toEqual(['copy', 'highlight', 'note', 'dict', 'speak', 'share', 'search']);
    const { main, more } = splitBar(DEFAULT_BAR);
    expect(main).toEqual(['copy', 'highlight', 'note', 'dict']);
    expect(more).toEqual(['speak', 'share', 'search']);
  });

  it('损坏数据：补齐缺项、去重、丢弃未知项', () => {
    const bar = normalizeBar([{ id: 'search', on: true }, { id: 'search', on: false }, { id: 'zzz', on: true }, 5]);
    expect(bar).toHaveLength(11);
    expect(bar[0]).toEqual({ id: 'search', on: true });
    expect(new Set(bar.map((i) => i.id)).size).toBe(11);
    expect(normalizeBar(undefined)).toEqual(DEFAULT_BAR);
  });

  it('前 4 位强制勾选，不能取消', () => {
    const bar = normalizeBar(DEFAULT_BAR.map((i) => ({ ...i, on: false })));
    expect(bar.slice(0, 4).every((i) => i.on)).toBe(true);
    expect(bar.slice(4).every((i) => !i.on)).toBe(true);
    expect(toggleItem(DEFAULT_BAR, 0)).toBe(DEFAULT_BAR);
    expect(toggleItem(DEFAULT_BAR, 7)[7].on).toBe(true);
  });

  it('移动后新进入前 4 位的项被强制勾选', () => {
    const moved = moveItem(DEFAULT_BAR, 8, 0) as BarItem[]; // wiki（未勾选）移到最前
    expect(moved[0]).toEqual({ id: 'wiki', on: true });
    expect(splitBar(moved).main).toEqual(['wiki', 'copy', 'highlight', 'note']);
  });
});
