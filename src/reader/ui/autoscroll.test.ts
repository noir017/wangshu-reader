import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoScrollMode, autoScrollSettings } from '@/reader/settings';
import { isAutoActive, pauseOrResume, speedPct, startAutoScroll, stopAutoScroll, toggleAutoScroll, changeSpeed } from './autoscroll';
import { resetReaderUi, useReaderUi } from './store';
import { uiSettings } from './ui-settings';

const toast = vi.fn();
const openOverlay = vi.fn();
vi.mock('@/ui', async (orig) => ({
  ...(await orig<typeof import('@/ui')>()),
  toast: (...a: unknown[]) => toast(...a),
  openOverlay: (...a: unknown[]) => openOverlay(...a),
}));

function install() {
  let running = false;
  const controller = {
    startAutoScroll: vi.fn(() => void (running = true)),
    stopAutoScroll: vi.fn(() => void (running = false)),
    isAutoScrolling: () => running,
  };
  useReaderUi.setState({ session: { controller } as never });
  return controller;
}

beforeEach(() => {
  toast.mockClear();
  openOverlay.mockClear();
  resetReaderUi();
  autoScrollSettings.reset();
  uiSettings.reset();
});

describe('自动滚屏控制（AUTO-001）', () => {
  it('速度百分比 = 100 − speed', () => {
    expect(speedPct(50)).toBe(50);
    expect(speedPct(0)).toBe(100);
  });

  it('开始：关菜单与面板、通知引擎、首次给手势提示', () => {
    const c = install();
    useReaderUi.getState().setMenu(true);
    startAutoScroll();
    expect(c.startAutoScroll).toHaveBeenCalledOnce();
    expect(useReaderUi.getState()).toMatchObject({ autoRunning: true, menu: false });
    expect(toast).toHaveBeenCalledOnce();
    expect(uiSettings.get().askAutoScrollTip).toBe(false);
    stopAutoScroll({ silent: true });
    startAutoScroll();
    expect(toast).toHaveBeenCalledOnce(); // 提示只给一次
  });

  it('速读模式：打开速读界面，不启动引擎滚屏', () => {
    const c = install();
    autoScrollSettings.set({ autoScrollMode: AutoScrollMode.SpeedRead });
    startAutoScroll();
    expect(useReaderUi.getState().speedRead).toBe(true);
    expect(c.startAutoScroll).not.toHaveBeenCalled();
    expect(isAutoActive()).toBe(true);
  });

  it('停止：引擎停下、状态清空，非静默时提示「已取消」', () => {
    const c = install();
    startAutoScroll();
    stopAutoScroll();
    expect(c.stopAutoScroll).toHaveBeenCalledOnce();
    expect(isAutoActive()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(expect.any(String));
  });

  it('引擎 stop 抛错（尚未 open）时不影响状态清理', () => {
    const c = install();
    c.isAutoScrolling = () => {
      throw new Error('not opened');
    };
    useReaderUi.getState().setAuto({ running: true });
    expect(() => stopAutoScroll({ silent: true })).not.toThrow();
    expect(useReaderUi.getState().autoRunning).toBe(false);
  });

  it('toggleAutoScroll：运行中 = 停止；首次询问 = 弹对话框；关了询问 = 直接开始', () => {
    const c = install();
    toggleAutoScroll();
    expect(openOverlay).toHaveBeenCalledOnce();
    expect(c.startAutoScroll).not.toHaveBeenCalled();
    uiSettings.set({ askForScrollEvent: false });
    toggleAutoScroll();
    expect(c.startAutoScroll).toHaveBeenCalledOnce();
    toggleAutoScroll();
    expect(useReaderUi.getState().autoRunning).toBe(false);
  });

  it('暂停/继续：暂停 = 停引擎并标记，继续 = 重新开始', () => {
    const c = install();
    startAutoScroll();
    pauseOrResume();
    expect(useReaderUi.getState()).toMatchObject({ autoPaused: true });
    expect(c.stopAutoScroll).toHaveBeenCalledOnce();
    pauseOrResume();
    expect(c.startAutoScroll).toHaveBeenCalledTimes(2);
    expect(useReaderUi.getState()).toMatchObject({ autoPaused: false, autoRunning: true });
  });

  it('调速：delta>0 加快；改设置并提示', () => {
    changeSpeed(10);
    expect(autoScrollSettings.get().autoScrollSpeed).toBe(40);
    expect(toast).toHaveBeenCalled();
    changeSpeed(1000);
    expect(autoScrollSettings.get().autoScrollSpeed).toBe(0);
    toast.mockClear();
    changeSpeed(1); // 已到最快，不再变化
    expect(toast).not.toHaveBeenCalled();
  });
});
