import { beforeEach, describe, expect, it, vi } from 'vitest';

const syncOnOpen = vi.fn(async (_bookId: string, _ui: unknown) => ({ position: false, annotations: false }));
const syncOnClose = vi.fn(async () => undefined);
vi.mock('@/storage/sync', () => ({
  clientFor: vi.fn(),
  downloadRecent: vi.fn(async () => []),
  loadSyncConfig: vi.fn(async () => ({ showMsg: false })),
  pullBook: vi.fn(),
  pushBook: vi.fn(),
  syncOnClose,
  syncOnOpen,
}));

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('同步触发时机（SYNC-006）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
  });

  it('阅读中切到后台上传；回到前台（间隔超过 30 秒）重新拉云端进度，频繁切换不重复请求', async () => {
    location.hash = '#/read/book-1';
    const { startSyncService } = await import('./sync-service');
    startSyncService();
    await vi.advanceTimersByTimeAsync(10);
    const opens = syncOnOpen.mock.calls.length; // 直接打开阅读页地址时的那次
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(10);
    expect(syncOnClose).toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 31_000);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(10);
    expect(syncOnOpen.mock.calls.length).toBe(opens + 1);
    expect(syncOnOpen.mock.calls.at(-1)?.[0]).toBe('book-1');
    // 马上又切回来：不再请求
    setVisibility('hidden');
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(10);
    expect(syncOnOpen.mock.calls.length).toBe(opens + 1);
  });
});
