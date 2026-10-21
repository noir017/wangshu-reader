import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '@/core/emitter';
import type { ReaderEvents } from '@/core/reader';
import { autoScrollSettings, controlSettings, screenSettings, textSettings } from '@/reader/settings';
import type { ActionHost } from './actions';
import { bindController, createInputHandlers, edgeKindAt, handledKeys, toPx } from './input';
import { resetReaderUi, useReaderUi } from '../store';
import { uiSettings } from '../ui-settings';

vi.mock('@/ui', async (orig) => ({ ...(await orig<typeof import('@/ui')>()), toast: vi.fn() }));

function mockHost() {
  const calls: string[] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push(args.length ? `${name}(${args.map((a) => JSON.stringify(a)).join(',')})` : name);
  const host: ActionHost = {
    pageUp: rec('pageUp'),
    pageDown: rec('pageDown'),
    lineUp: rec('lineUp'),
    lineDown: rec('lineDown'),
    adjacentFile: rec('adjacentFile'),
    command: rec('command'),
    bookInfo: rec('bookInfo'),
    changeTheme: rec('changeTheme'),
    optionsMenu: rec('optionsMenu'),
    navigateMenu: rec('navigateMenu'),
    fontSizeBar: rec('fontSizeBar'),
    chapter: rec('chapter'),
    backToShelf: rec('backToShelf'),
    exitReader: rec('exitReader'),
    autoScroll: rec('autoScroll'),
    brightnessPanel: rec('brightnessPanel'),
    openOptions: rec('openOptions'),
  };
  return { host, calls };
}

const SIZE = { w: 400, h: 800 };

function setup(extra: Partial<Parameters<typeof createInputHandlers>[0]> = {}) {
  const m = mockHost();
  const h = createInputHandlers({ host: m.host, size: () => SIZE, ...extra });
  return { ...m, h };
}

beforeEach(() => {
  resetReaderUi();
  controlSettings.reset();
  textSettings.reset();
  screenSettings.reset();
  autoScrollSettings.reset();
  uiSettings.reset();
});
afterEach(() => resetReaderUi());

describe('tap：点击区 → 动作（CTRL-001）', () => {
  it('默认（tapMode 1 左右模式）：左/上 = 上一页，右/下 = 下一页，中间 = 菜单', () => {
    const { h, calls } = setup();
    h.tap({ x: 0.1, y: 0.5 });
    h.tap({ x: 0.9, y: 0.5 });
    h.tap({ x: 0.9, y: 0.9 });
    expect(calls).toEqual(['pageUp', 'pageDown', 'pageDown']);
    expect(useReaderUi.getState().menu).toBe(false);
    h.tap({ x: 0.5, y: 0.5 });
    expect(useReaderUi.getState().menu).toBe(true);
  });

  it('菜单已显示：任意点击只收起菜单，不执行动作', () => {
    const { h, calls } = setup();
    useReaderUi.getState().setMenu(true);
    h.tap({ x: 0.9, y: 0.5 });
    expect(calls).toEqual([]);
    expect(useReaderUi.getState().menu).toBe(false);
  });

  it('字号/亮度面板开着：点正文先关面板', () => {
    const { h, calls } = setup();
    useReaderUi.getState().setPanel('font');
    h.tap({ x: 0.9, y: 0.5 });
    expect(calls).toEqual([]);
    expect(useReaderUi.getState().panel).toBeNull();
  });

  it('区域绑定为「无」(15)：不翻页也不弹菜单', () => {
    const { h, calls } = setup();
    controlSettings.set({ doTapScreenRight: 15 });
    h.tap({ x: 0.9, y: 0.5 });
    expect(calls).toEqual([]);
    expect(useReaderUi.getState().menu).toBe(false);
  });

  it('改绑：右侧 = 下一章节、上下模式 = 上/下', () => {
    const { h, calls } = setup();
    controlSettings.set({ doTapScreenRight: 13 });
    h.tap({ x: 0.9, y: 0.5 });
    controlSettings.set({ toggleTapMode: false, doTapScreenTop: 4 });
    h.tap({ x: 0.5, y: 0.05 });
    expect(calls).toEqual(['chapter(1)', 'command("search.open",{})']);
  });

  it('防误触：边缘带内的点击忽略', () => {
    const { h, calls } = setup();
    controlSettings.set({ disableEdgeTouch: true, rightEdge: 20 });
    h.tap({ x: 395 / 400, y: 0.5 }); // 距右边 5px
    expect(calls).toEqual([]);
    h.tap({ x: 0.9, y: 0.5 });
    expect(calls).toEqual(['pageDown']);
  });

  it('像素坐标（>1）也能识别', () => {
    const { h, calls } = setup();
    h.tap({ x: 360, y: 400 });
    expect(calls).toEqual(['pageDown']);
  });
});

describe('longPress / swipe（CTRL-003、CTRL-004）', () => {
  it('长按默认 = 页面文字摘录，带坐标', () => {
    const { h, calls } = setup();
    h.longPress({ x: 0.3, y: 0.6 });
    expect(calls).toEqual(['command("selection.start",{"x":0.3,"y":0.6})']);
  });

  it('菜单/面板开着时长按忽略', () => {
    const { h, calls } = setup();
    useReaderUi.getState().setMenu(true);
    h.longPress({ x: 0.3, y: 0.6 });
    expect(calls).toEqual([]);
  });

  it('划动手势：距离不够不触发，够了按方向绑定执行', async () => {
    const { h, calls } = setup();
    controlSettings.set({ doSwipeLeftToRight: 12, doSwipeRightToLeft: 13 });
    await h.swipe({ dir: 'right', startX: 10, startY: 400, dist: 100 });
    expect(calls).toEqual([]);
    await h.swipe({ dir: 'right', startX: 10, startY: 400, dist: 250 }); // 阈值 min(W/2, 400) = 200
    await h.swipe({ dir: 'left', startX: 390, startY: 400, dist: 250 });
    expect(calls).toEqual(['chapter(-1)', 'chapter(1)']);
  });

  it('绑到上/下一文件：首次确认；取消则两个横向手势都重置为无', async () => {
    const confirmSwipe = vi.fn(async () => false);
    const { h, calls } = setup({ confirmSwipe });
    controlSettings.set({ doSwipeLeftToRight: 2, doSwipeRightToLeft: 3 });
    await h.swipe({ dir: 'right', startX: 10, startY: 400, dist: 300 });
    expect(confirmSwipe).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
    expect(controlSettings.get().doSwipeLeftToRight).toBe(15);
    expect(controlSettings.get().doSwipeRightToLeft).toBe(15);
  });

  it('确认后执行并不再询问', async () => {
    const confirmSwipe = vi.fn(async () => true);
    const { h, calls } = setup({ confirmSwipe });
    controlSettings.set({ doSwipeLeftToRight: 2 });
    await h.swipe({ dir: 'right', startX: 10, startY: 400, dist: 300 });
    await h.swipe({ dir: 'right', startX: 10, startY: 400, dist: 300 });
    expect(confirmSwipe).toHaveBeenCalledOnce();
    expect(calls).toEqual(['adjacentFile(-1)', 'adjacentFile(-1)']);
    expect(uiSettings.get().askForSwipeEvent).toBe(false);
  });
});

describe('key：键盘映射与返回键优先级（CTRL-005）', () => {
  it('默认映射：PageDown / 空格 / 方向键 / Ctrl+F', () => {
    const { h, calls } = setup();
    expect(h.key({ key: 'PageDown' })).toBe(true);
    expect(h.key({ key: ' ' })).toBe(true);
    expect(h.key({ key: 'ArrowLeft' })).toBe(true);
    expect(h.key({ key: 'f', ctrlKey: true })).toBe(true);
    expect(h.key({ key: 'q' })).toBe(false);
    expect(calls).toEqual(['pageDown', 'pageDown', 'pageUp', 'command("search.open",{})']);
  });

  it('Shift+空格 = 上一页', () => {
    const { h, calls } = setup();
    h.key({ key: ' ', shiftKey: true });
    expect(calls).toEqual(['pageUp']);
  });

  it('输入控件里的按键不处理', () => {
    const { h, calls } = setup();
    expect(h.key({ key: 'PageDown', target: document.createElement('input') })).toBe(false);
    expect(calls).toEqual([]);
  });

  it('Esc 优先级：面板 → 菜单栏 → 自动滚屏 → 返回书库', () => {
    const { h, calls } = setup();
    const ui = useReaderUi.getState();
    ui.setMenu(true);
    expect(h.key({ key: 'Escape' })).toBe(true);
    expect(useReaderUi.getState().menu).toBe(false);
    useReaderUi.getState().setPanel('brightness');
    h.key({ key: 'Escape' });
    expect(useReaderUi.getState().panel).toBeNull();
    expect(calls).toEqual([]);
    h.key({ key: 'Escape' });
    expect(calls).toEqual(['backToShelf']);
  });

  it('键映射改绑与「无」', () => {
    const { h, calls } = setup();
    controlSettings.set({ keyMap: { ...controlSettings.get().keyMap, Home: 11, End: 15 } });
    h.key({ key: 'Home' });
    expect(h.key({ key: 'End' })).toBe(false);
    expect(calls).toEqual(['command("toc.open",{})']);
  });

  it('速读界面打开时不处理按键', () => {
    const { h, calls } = setup();
    useReaderUi.getState().setSpeedRead(true);
    expect(h.key({ key: 'PageDown' })).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('verticalDrag / pinch：边缘调亮度与字号、双指缩放（CTRL-006/007）', () => {
  it('toPx / edgeKindAt', () => {
    expect(toPx(0.5, 400)).toBe(200);
    expect(toPx(30, 400)).toBe(30);
    controlSettings.set({ adjustFontSizeAtSlide: true });
    expect(edgeKindAt(10, 400)).toBe('brightness');
    expect(edgeKindAt(390, 400)).toBe('fontsize');
    expect(edgeKindAt(200, 400)).toBeNull();
  });

  it('左边缘上滑变亮、下滑变暗（每 20px 一档），并唤出精简亮度面板', () => {
    let t = 0;
    const { h } = setup({ now: () => (t += 100) });
    screenSettings.set({ brightnessValue: 50 });
    h.verticalDrag({ startX: 10, dy: -30, phase: 'move' });
    expect(screenSettings.get().brightnessValue).toBeGreaterThan(50);
    expect(useReaderUi.getState().panel).toBe('brightness-mini');
    const up = screenSettings.get().brightnessValue;
    h.verticalDrag({ startX: 10, dy: 0, phase: 'end' });
    h.verticalDrag({ startX: 10, dy: 40, phase: 'move' });
    expect(screenSettings.get().brightnessValue).toBeLessThan(up);
  });

  it('自动(-100)时从 100 起算往下调', () => {
    let t = 0;
    const { h } = setup({ now: () => (t += 1000) });
    screenSettings.set({ brightnessValue: -100 });
    h.verticalDrag({ startX: 10, dy: 25, phase: 'move' });
    const v = screenSettings.get().brightnessValue;
    expect(v).toBeLessThan(100);
    expect(v).toBeGreaterThan(-100);
  });

  it('不在边缘带内的竖向拖动不改亮度', () => {
    const { h } = setup();
    screenSettings.set({ brightnessValue: 50 });
    h.verticalDrag({ startX: 200, dy: -100, phase: 'move' });
    expect(screenSettings.get().brightnessValue).toBe(50);
  });

  it('右边缘调字号：上滑变大、每 40px 一档', () => {
    const { h } = setup();
    controlSettings.set({ adjustFontSizeAtSlide: true, adjustBrightness: false });
    textSettings.set({ fontSize: 20 });
    h.verticalDrag({ startX: 390, dy: -85, phase: 'move' });
    expect(textSettings.get().fontSize).toBe(22);
  });

  it('双指缩放：multTouch 关闭时忽略，开启后按 scale 改字号并夹在范围内', () => {
    const { h } = setup();
    textSettings.set({ fontSize: 20 });
    h.pinch({ scale: 1.5, phase: 'move' });
    expect(textSettings.get().fontSize).toBe(20);
    controlSettings.set({ multTouch: true });
    h.pinch({ scale: 1.5, phase: 'move' });
    expect(textSettings.get().fontSize).toBe(30);
    h.pinch({ scale: 1, phase: 'end' });
    h.pinch({ scale: 20, phase: 'move' });
    expect(textSettings.get().fontSize).toBe(100);
  });
});

describe('自动滚屏中的输入（AUTO-001）', () => {
  function withAuto() {
    const stop = vi.fn();
    const start = vi.fn();
    useReaderUi.setState({ session: { controller: { stopAutoScroll: stop, startAutoScroll: start, isAutoScrolling: () => false } } as never, autoRunning: true });
    return { stop, start };
  }

  it('单击 = 暂停，再单击 = 继续（不翻页、不弹菜单）', () => {
    const { stop, start } = withAuto();
    const { h, calls } = setup();
    h.tap({ x: 0.9, y: 0.5 });
    expect(stop).toHaveBeenCalledOnce();
    expect(useReaderUi.getState().autoPaused).toBe(true);
    h.tap({ x: 0.9, y: 0.5 });
    expect(start).toHaveBeenCalledOnce();
    expect(useReaderUi.getState().autoPaused).toBe(false);
    expect(calls).toEqual([]);
    expect(useReaderUi.getState().menu).toBe(false);
  });

  it('横向划动 > 80px = 停止', async () => {
    withAuto();
    const { h } = setup();
    await h.swipe({ dir: 'left', startX: 300, startY: 400, dist: 120 });
    expect(useReaderUi.getState().autoRunning).toBe(false);
  });

  it('Esc 停止自动滚屏，不退出阅读页', () => {
    withAuto();
    const { h, calls } = setup();
    h.key({ key: 'Escape' });
    expect(useReaderUi.getState().autoRunning).toBe(false);
    expect(calls).toEqual([]);
  });

  it('翻页键翻一页但不终止滚屏', () => {
    withAuto();
    const { h, calls } = setup();
    h.key({ key: 'PageDown' });
    expect(calls).toEqual(['pageDown']);
    expect(useReaderUi.getState().autoRunning).toBe(true);
  });

  it('引擎 autoScroll 事件同步界面状态：滚屏中引擎说停了 = 暂停；界面自己停止则清空', () => {
    const { h } = setup();
    h.onAutoScroll({ running: true, speed: 50 });
    expect(useReaderUi.getState().autoRunning).toBe(true);
    h.onAutoScroll({ running: false, speed: 50 });
    expect(useReaderUi.getState().autoRunning).toBe(false);
    expect(useReaderUi.getState().autoPaused).toBe(true);
    h.onAutoScroll({ running: true, speed: 50 });
    expect(useReaderUi.getState()).toMatchObject({ autoRunning: true, autoPaused: false });
    // 界面自己停止：先清状态再通知引擎，之后引擎回报的 running:false 不能被当成暂停
    useReaderUi.getState().setAuto({ running: false, paused: false });
    h.onAutoScroll({ running: false, speed: 50 });
    expect(useReaderUi.getState().autoPaused).toBe(false);
  });

  it('调速：delta>0 加快（autoScrollSpeed 变小），夹在 0..100', () => {
    const { h } = setup();
    h.speed(5);
    expect(autoScrollSettings.get().autoScrollSpeed).toBe(45);
    h.speed(-100);
    expect(autoScrollSettings.get().autoScrollSpeed).toBe(100);
  });
});

describe('bindController：事件接线', () => {
  it('引擎事件派发到对应处理器，解绑后不再响应；同一个 KeyboardEvent 只处理一次', () => {
    const em = new Emitter<ReaderEvents & Record<string, unknown>>();
    const controller = { on: (type: keyof ReaderEvents, fn: (p: never) => void) => em.on(type, fn as never) };
    const { h, calls } = setup();
    const onEnd = vi.fn();
    const unbind = bindController(controller as never, h, { onEndOfBook: onEnd });
    em.emit('tap', { x: 0.9, y: 0.5 });
    em.emit('longPress', { x: 0.2, y: 0.2 });
    em.emit('endOfBook', undefined);
    expect(calls).toEqual(['pageDown', 'command("selection.start",{"x":0.2,"y":0.2})']);
    expect(onEnd).toHaveBeenCalledOnce();

    const ev = new KeyboardEvent('keydown', { key: 'PageDown', cancelable: true });
    em.emit('key', { key: 'PageDown', code: 'PageDown', event: ev });
    em.emit('key', { key: 'PageDown', code: 'PageDown', event: ev });
    expect(calls.filter((c) => c === 'pageDown')).toHaveLength(2); // 一次来自 tap，一次来自按键（重复事件被去重）
    expect(ev.defaultPrevented).toBe(true);
    expect(handledKeys.has(ev)).toBe(true);

    unbind();
    em.emit('tap', { x: 0.9, y: 0.5 });
    expect(calls).toHaveLength(3); // 解绑后的 tap 没有再触发
  });
});
