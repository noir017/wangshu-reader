import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appSettings } from '@/core/app-settings';
import { COOL_DOWN_MS, CoverSearchError, resetCoverCoolDown, searchCovers } from './covers';

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
const OL_OK = { docs: [{ key: '/works/1', title: 'Dune', cover_i: 42 }, { key: '/works/2', title: 'NoCover' }] };
const GB_OK = { items: [{ id: 'g1', volumeInfo: { title: 'Dune', imageLinks: { thumbnail: 'http://books.google.com/x?zoom=1' } } }] };

let calls: string[];
function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return handler(url);
    }),
  );
}

beforeEach(() => {
  calls = [];
  resetCoverCoolDown();
  appSettings.set({ serverUrl: '', serverToken: '' }); // 没有服务端：只走直连
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('searchCovers 限流处理', () => {
  it('Open Library 正常：返回有封面的条目', async () => {
    stubFetch(() => json(OL_OK));
    const r = await searchCovers('Dune', 'Frank Herbert');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'ol42', source: 'Open Library', full: 'https://covers.openlibrary.org/b/id/42-L.jpg' });
    expect(calls.every((u) => u.startsWith('https://openlibrary.org'))).toBe(true);
  });

  it('Open Library 没结果 → 换 Google Books', async () => {
    stubFetch((u) => (u.includes('openlibrary') ? json({ docs: [] }) : json(GB_OK)));
    const r = await searchCovers('Dune', '');
    expect(r.map((c) => c.source)).toEqual(['Google Books']);
    expect(r[0].thumb).toBe('https://books.google.com/x?zoom=1');
  });

  it('Google Books 429：按 Retry-After 退避重试一次，仍 429 就抛出「限流」错误（不是笼统的「搜索失败」）', async () => {
    stubFetch((u) => (u.includes('openlibrary') ? json({ docs: [] }) : new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })));
    const p = searchCovers('Dune', '', 'googlebooks');
    const assertion = expect(p).rejects.toMatchObject({ name: 'CoverSearchError', rateLimited: true, source: 'googlebooks' });
    await vi.advanceTimersByTimeAsync(2500);
    await assertion;
    expect(calls.filter((u) => u.includes('googleapis'))).toHaveLength(2); // 初次 + 退避后一次
  });

  it('退避后恢复就返回结果', async () => {
    let n = 0;
    stubFetch((u) => (u.includes('googleapis') ? (n++ === 0 ? new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }) : json(GB_OK)) : json({ docs: [] })));
    const p = searchCovers('Dune', '', 'googlebooks');
    await vi.advanceTimersByTimeAsync(1500);
    expect((await p).map((c) => c.id)).toEqual(['gbg1']);
  });

  it('被限流的来源进入冷却期：这段时间不再请求它，直接走另一个来源', async () => {
    stubFetch((u) => (u.includes('googleapis') ? new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }) : json(OL_OK)));
    // 首选 Google：429（Retry-After 太长不等）→ 回退 Open Library 成功
    const first = await searchCovers('Dune', '', 'googlebooks');
    expect(first[0].source).toBe('Open Library');
    const googleCalls = () => calls.filter((u) => u.includes('googleapis')).length;
    expect(googleCalls()).toBe(1);
    // 冷却期内再搜：不再碰 Google
    await searchCovers('Dune', '', 'googlebooks');
    expect(googleCalls()).toBe(1);
    // 冷却过后再试
    await vi.advanceTimersByTimeAsync(Math.max(COOL_DOWN_MS, 30_000) + 1000);
    await searchCovers('Dune', '', 'googlebooks');
    expect(googleCalls()).toBe(2);
  });

  it('两个来源都不行：限流的错误优先抛出；都没结果返回空数组', async () => {
    stubFetch((u) => (u.includes('openlibrary') ? new Response('boom', { status: 500 }) : new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })));
    const err = await searchCovers('Dune', '').catch((e) => e);
    expect(err).toBeInstanceOf(CoverSearchError);
    expect(err.rateLimited).toBe(true);
    resetCoverCoolDown();
    stubFetch(() => json({ docs: [], items: [] }));
    expect(await searchCovers('Dune', '')).toEqual([]);
  });
});
