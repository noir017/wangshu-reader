import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderLocation } from '@/core/reader';
import { goLinkBack, goToProgress, parsePercentInput, percentText, saveLinkBack, sectionCount, stepChapter } from './ops';
import { resetReaderUi, useReaderUi } from './store';
import { seekValue } from './components/Bars';

const toast = vi.fn();
vi.mock('@/ui', async (orig) => ({ ...(await orig<typeof import('@/ui')>()), toast: (...a: unknown[]) => toast(...a) }));

function loc(section: number, offset = 0): ReaderLocation {
  return { locator: { section, offset }, progress: 0, section, page: 1, pages: 1, visible: { section, start: 0, end: 1 }, atStart: false, atEnd: false };
}

function install(sections: number, at: ReaderLocation) {
  const controller = { nextSection: vi.fn(), prevSection: vi.fn(), goTo: vi.fn(), getLocation: () => at, next: vi.fn(), prev: vi.fn() };
  useReaderUi.setState({ session: { book: { kind: 'reflowable', sections: Array.from({ length: sections }) }, controller } as never, loc: at });
  return controller;
}

beforeEach(() => {
  toast.mockClear();
  resetReaderUi();
});

describe('百分比（T.getPercentStr2 / do_go_percent）', () => {
  it('两位小数，读完显示 100%', () => {
    expect(percentText(0.3521, false)).toBe('35.21%');
    expect(percentText(0, false)).toBe('0.00%');
    expect(percentText(0.999, true)).toBe('100%');
    expect(percentText(2, false)).toBe('100.00%');
  });
  it('输入解析：可带 %，0–100，非法返回 null', () => {
    expect(parsePercentInput('35')).toBe(0.35);
    expect(parsePercentInput(' 12.5 % ')).toBe(0.125);
    expect(parsePercentInput('50％')).toBe(0.5);
    expect(parsePercentInput('101')).toBeNull();
    expect(parsePercentInput('abc')).toBeNull();
    expect(parsePercentInput('-3')).toBeNull();
    expect(parsePercentInput('')).toBeNull();
  });
  it('进度条值 0..1000：>0 取整为 0 时取 1，末页强制 1000', () => {
    expect(seekValue(0, false)).toBe(0);
    expect(seekValue(0.0001, false)).toBe(1);
    expect(seekValue(0.3521, false)).toBe(352);
    expect(seekValue(0.99, true)).toBe(1000);
  });
});

describe('换章与跳转', () => {
  it('stepChapter：到头时提示且不动；正常换章并记录回退位置', async () => {
    const c = install(3, loc(2));
    expect(await stepChapter(1)).toBe(false);
    expect(toast).toHaveBeenCalledOnce();
    expect(c.nextSection).not.toHaveBeenCalled();

    const c2 = install(3, loc(0, 0));
    expect(await stepChapter(-1)).toBe(false);
    expect(c2.prevSection).not.toHaveBeenCalled();

    const c3 = install(3, loc(1, 40));
    expect(await stepChapter(1)).toBe(true);
    expect(c3.nextSection).toHaveBeenCalledOnce();
    expect(useReaderUi.getState().linkBack).toEqual([{ section: 1, offset: 40 }]);
  });

  it('第一章中间往上换章 = 回到本章开头（prevSection）', async () => {
    const c = install(3, loc(0, 500));
    expect(await stepChapter(-1)).toBe(true);
    expect(c.prevSection).toHaveBeenCalledOnce();
  });

  it('回退栈：saveLinkBack 压栈（同位置不重复），goLinkBack 弹出并跳回', async () => {
    const c = install(5, loc(1, 10));
    saveLinkBack();
    saveLinkBack();
    expect(useReaderUi.getState().linkBack).toHaveLength(1);
    await goLinkBack();
    expect(c.goTo).toHaveBeenCalledWith({ section: 1, offset: 10 });
    expect(useReaderUi.getState().linkBack).toHaveLength(0);
    await goLinkBack(); // 空栈：什么都不做
    expect(c.goTo).toHaveBeenCalledOnce();
  });

  it('goToProgress 夹在 0..1；固定版式章数 = 页数', async () => {
    const c = install(4, loc(0));
    await goToProgress(1.7);
    expect(c.goTo).toHaveBeenLastCalledWith({ progress: 1 });
    await goToProgress(-1);
    expect(c.goTo).toHaveBeenLastCalledWith({ progress: 0 });
    expect(sectionCount()).toBe(4);
    useReaderUi.setState({ session: { book: { kind: 'fixed', pageCount: 24 }, controller: c } as never });
    expect(sectionCount()).toBe(24);
  });
});
