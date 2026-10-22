import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '@/core/emitter';
import type { ReaderLocation } from '@/core/reader';
import type { ReaderCommands } from '@/core/reader-session';
import { clearLinkBack, useLinkBack } from '@/features/common/linkback';
import { goLinkBack, goToProgress, parsePercentInput, percentText, saveLinkBack, sectionCount, stepChapter } from './ops';
import { resetReaderUi, useReaderUi } from './store';
import { seekValue } from './components/Bars';

const toast = vi.fn();
vi.mock('@/ui', async (orig) => ({ ...(await orig<typeof import('@/ui')>()), toast: (...a: unknown[]) => toast(...a) }));

function loc(section: number, offset = 0): ReaderLocation {
  return { locator: { section, offset }, progress: 0, section, page: 1, pages: 1, visible: { section, start: 0, end: 1 }, atStart: false, atEnd: false };
}

function install(sections: number, at: ReaderLocation) {
  const controller = { nextSection: vi.fn(), prevSection: vi.fn(), goTo: vi.fn(), getLocation: () => at, next: vi.fn(), prev: vi.fn(), getSectionText: vi.fn(async () => '正文'.repeat(50)) };
  const bus = new Emitter<ReaderCommands>();
  useReaderUi.setState({ session: { book: { kind: 'reflowable', sections: Array.from({ length: sections }) }, controller, bus } as never, loc: at });
  return Object.assign(controller, { bus });
}

beforeEach(() => {
  toast.mockClear();
  resetReaderUi();
  clearLinkBack();
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
    expect(useLinkBack.getState().stack.map((e) => e.locator)).toEqual([{ section: 1, offset: 40 }]);
  });

  it('第一章中间往上换章 = 回到本章开头（prevSection）', async () => {
    const c = install(3, loc(0, 500));
    expect(await stepChapter(-1)).toBe(true);
    expect(c.prevSection).toHaveBeenCalledOnce();
  });

  it('回退栈只有 features 那一份：saveLinkBack 压栈（同位置不重复，标题随后补成当前行前若干字），goLinkBack 发 linkback.back', async () => {
    const c = install(5, loc(1, 10));
    saveLinkBack();
    saveLinkBack();
    expect(useLinkBack.getState().stack).toHaveLength(1);
    await vi.waitFor(() => expect(useLinkBack.getState().stack[0].title).toContain('正文'));
    const got: unknown[] = [];
    c.bus.on('linkback.back', (p) => got.push(p));
    goLinkBack();
    expect(got).toHaveLength(1);
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
