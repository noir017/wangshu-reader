import { describe, expect, it, vi } from 'vitest';
import { appSettings } from '@/core/app-settings';
import { ReaderAction } from '@/reader/settings';
import { ALL_ACTIONS, actionForArea, actionLabel, actionOptions, decideTap, normalizeAction, performAction, type ActionHost } from './actions';

function mockHost() {
  const calls: string[] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push(args.length ? `${name}(${args.map((a) => JSON.stringify(a)).join(',')})` : name);
  const host: ActionHost = {
    pageUp: rec('pageUp'),
    pageDown: rec('pageDown'),
    adjacentFile: rec('adjacentFile'),
    command: rec('command'),
    bookInfo: rec('bookInfo'),
    changeTheme: rec('changeTheme'),
    optionsMenu: rec('optionsMenu'),
    navigateMenu: rec('navigateMenu'),
    fontSizeBar: rec('fontSizeBar'),
    chapter: rec('chapter'),
    backToShelf: rec('backToShelf'),
    autoScroll: rec('autoScroll'),
    brightnessPanel: rec('brightnessPanel'),
    openOptions: rec('openOptions'),
  };
  return { host, calls };
}

describe('动作分发 performAction（CTRL-002）', () => {
  const expected: [number, string][] = [
    [0, 'pageUp'],
    [1, 'pageDown'],
    [2, 'adjacentFile(-1)'],
    [3, 'adjacentFile(1)'],
    [4, 'command("search.open",{})'],
    [5, 'command("bookmarks.open",{})'],
    [6, 'bookInfo'],
    [7, 'changeTheme'],
    [8, 'optionsMenu'],
    [9, 'navigateMenu'],
    [10, 'fontSizeBar'],
    [11, 'command("toc.open",{})'],
    [12, 'chapter(-1)'],
    [13, 'chapter(1)'],
    [14, 'backToShelf'],
    [17, 'command("selection.start",{})'],
    [18, 'autoScroll'],
    [19, 'command("tts.toggle",{})'],
    [20, 'brightnessPanel'],
    [21, 'openOptions("visual")'],
    [22, 'openOptions("control")'],
    [23, 'openOptions("misc")'],
  ];
  it.each(expected)('动作 %i → %s', (id, call) => {
    const { host, calls } = mockHost();
    expect(performAction(id, host)).toBe(true);
    expect(calls).toEqual([call]);
  });

  // 旧设置里可能还存着已撤的编号：照撤之前的实际行为执行
  it.each([
    [16, 'backToShelf'],
    [24, 'pageUp'],
    [25, 'pageDown'],
  ] as [number, string][])('已撤的动作 %i → %s', (id, call) => {
    const { host, calls } = mockHost();
    expect(performAction(id, host)).toBe(true);
    expect(calls).toEqual([call]);
  });

  it('15 无 / 未知编号：返回 false、什么都不做', () => {
    const { host, calls } = mockHost();
    expect(performAction(ReaderAction.None, host)).toBe(false);
    expect(performAction(99, host)).toBe(false);
    expect(performAction(-1, host)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('文字摘录带长按坐标', () => {
    const { host, calls } = mockHost();
    performAction(ReaderAction.TextSelection, host, { x: 0.3, y: 0.7 });
    expect(calls).toEqual(['command("selection.start",{"x":0.3,"y":0.7})']);
  });

  it('属于 features 的动作（4 搜索、5 书签、11 目录、17 选择、19 朗读）都走 bus 命令', () => {
    for (const id of [4, 5, 11, 17, 19]) {
      const { host, calls } = mockHost();
      performAction(id, host);
      expect(calls[0].startsWith('command(')).toBe(true);
    }
  });

  it('可选的 23 项都有中文名称，与 values-zh 的 controls 一致；16/24/25 不在列表里', () => {
    appSettings.set({ language: 'zh' }); // happy-dom 的 navigator.language 是 en-US
    const opts = actionOptions();
    const labels = opts.map((o) => o.label);
    expect(labels).toHaveLength(23);
    expect(opts.map((o) => o.value)).toEqual(ALL_ACTIONS);
    expect(ALL_ACTIONS).not.toContain(16);
    expect(ALL_ACTIONS).not.toContain(24);
    expect(ALL_ACTIONS).not.toContain(25);
    expect(labels.slice(0, 5)).toEqual(['向上翻页', '向下翻页', '上一文件', '下一文件', '搜索']);
    expect(actionLabel(15)).toBe('无');
    expect(new Set(labels).size).toBe(23);
  });

  it('已撤编号显示为实际执行的动作', () => {
    appSettings.set({ language: 'zh' });
    expect([16, 24, 25].map(normalizeAction)).toEqual([ReaderAction.BackToShelf, ReaderAction.PageUp, ReaderAction.PageDown]);
    expect(actionLabel(16)).toBe('返回书库');
    expect(actionLabel(24)).toBe('向上翻页');
    expect(actionLabel(25)).toBe('向下翻页');
    expect(normalizeAction(15)).toBe(15);
    expect(normalizeAction(99)).toBe(99);
  });
});

describe('点击决策 decideTap（do_TapUp_Event）', () => {
  const bindings = { doTapScreenTop: 0, doTapScreenBottom: 1, doTapScreenLeft: 0, doTapScreenRight: 1 };

  it('菜单已显示：任意区域点击只收起菜单', () => {
    for (const area of [0, 1, 2, 3, 4] as const) expect(decideTap({ menuVisible: true, area, bindings }).kind).toBe('hide-menu');
  });
  it('菜单隐藏：中间区呼出菜单，其余执行绑定动作', () => {
    expect(decideTap({ menuVisible: false, area: 0, bindings }).kind).toBe('toggle-menu');
    expect(decideTap({ menuVisible: false, area: 3, bindings })).toMatchObject({ kind: 'action', action: 0 });
    expect(decideTap({ menuVisible: false, area: 4, bindings })).toMatchObject({ kind: 'action', action: 1 });
    expect(decideTap({ menuVisible: false, area: 1, bindings })).toMatchObject({ kind: 'action', action: 0 });
    expect(decideTap({ menuVisible: false, area: 2, bindings })).toMatchObject({ kind: 'action', action: 1 });
  });
  it('绑定为 None 的区域无动作', () => {
    expect(decideTap({ menuVisible: false, area: 3, bindings: { ...bindings, doTapScreenLeft: 15 } }).kind).toBe('none');
  });
  it('actionForArea', () => {
    expect(actionForArea(0, bindings)).toBeNull();
    expect(actionForArea(2, { ...bindings, doTapScreenBottom: 11 })).toBe(11);
  });
});

void vi;
