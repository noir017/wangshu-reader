import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '@/core/emitter';
import type { ReaderEvents, ReaderLocation } from '@/core/reader';
import type { ReaderSession } from '@/core/reader-session';
import { getPosition, savePosition } from '@/storage/db';
import { usePositionSaving } from './session-persist';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loc = (section: number, offset: number, progress: number, extra: Partial<ReaderLocation> = {}): ReaderLocation => ({
  locator: { section, offset },
  progress,
  section,
  page: 1,
  pages: 1,
  visible: { section, start: offset, end: offset + 10 },
  atStart: false,
  atEnd: false,
  ...extra,
});

function mockSession(bookId: string) {
  const em = new Emitter<ReaderEvents & Record<string, unknown>>();
  let current: ReaderLocation | null = loc(0, 0, 0);
  const controller = {
    on: (type: keyof ReaderEvents, fn: (p: never) => void) => em.on(type, fn as never),
    getLocation: () => current,
  };
  const session = { bookId, controller } as unknown as ReaderSession;
  return {
    session,
    relocate: (l: ReaderLocation) => {
      current = l;
      em.emit('relocate', l);
    },
    setCurrent: (l: ReaderLocation) => (current = l),
  };
}

function Probe({ session }: { session: ReaderSession }) {
  usePositionSaving(session);
  return null;
}

let root: Root;
let host: HTMLElement;
const mount = (session: ReaderSession) => act(() => root.render(createElement(Probe, { session })));
const unmount = () => act(() => root.render(createElement('div')));
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(50)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('进度保存（usePositionSaving）', () => {
  it('relocate 后去抖 800ms 落盘，连续翻页只存最后一次', async () => {
    const m = mockSession('book-a');
    await mount(m.session);
    m.relocate(loc(0, 100, 0.1));
    m.relocate(loc(1, 200, 0.2));
    await act(async () => void (await vi.advanceTimersByTimeAsync(700)));
    expect(await getPosition('book-a')).toBeUndefined();
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    await flush();
    expect((await getPosition('book-a'))?.locator).toEqual({ section: 1, offset: 200 });
  });

  it('读到末尾时进度记 1', async () => {
    const m = mockSession('book-b');
    await mount(m.session);
    m.relocate(loc(3, 10, 0.97, { atEnd: true }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(900)));
    await flush();
    expect((await getPosition('book-b'))?.progress).toBe(1);
  });

  it('离开阅读页时立即以引擎当前位置落盘（不等去抖）', async () => {
    const m = mockSession('book-c');
    await mount(m.session);
    m.relocate(loc(2, 50, 0.3));
    await unmount();
    await flush();
    expect((await getPosition('book-c'))?.locator).toEqual({ section: 2, offset: 50 });
  });

  it('阅读期间别处（云同步）改写了进度：离开时不能用当前位置盖回去', async () => {
    const m = mockSession('book-d');
    await mount(m.session);
    m.relocate(loc(1, 10, 0.1));
    await act(async () => void (await vi.advanceTimersByTimeAsync(900)));
    await flush();
    // 云同步写入更新的进度
    await act(async () => {
      await savePosition({ bookId: 'book-d', locator: { section: 5, offset: 77 }, progress: 0.5 });
    });
    await unmount();
    await flush();
    expect((await getPosition('book-d'))?.locator).toEqual({ section: 5, offset: 77 });
  });

  it('外部改写之后用户又翻页：恢复正常保存', async () => {
    const m = mockSession('book-e');
    await mount(m.session);
    await act(async () => {
      await savePosition({ bookId: 'book-e', locator: { section: 5, offset: 77 }, progress: 0.5 });
    });
    m.relocate(loc(6, 1, 0.6));
    await act(async () => void (await vi.advanceTimersByTimeAsync(900)));
    await flush();
    expect((await getPosition('book-e'))?.locator).toEqual({ section: 6, offset: 1 });
  });
});
