import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationRecord } from '@/core/library';
import { appSettings } from '@/core/app-settings';
import { readwiseSettings } from '@/library/settings';
import { closeDbForTests, DB_NAME, putAnnotation, putBook } from './db';
import { postHighlights, ReadwiseError, sendTestHighlight, shareAnnotation, startReadwiseAutoShare, toReadwise } from './readwise';

const ann = (p: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  id: 'a1',
  bookId: 'b1',
  kind: 'highlight',
  range: { section: 0, start: 0, end: 5 },
  text: '被标注的原文',
  color: '#ff0',
  style: 'highlight',
  chapterTitle: '第一章',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...p,
});
const book = { title: '三体', authors: ['刘慈欣', '某译者'] };

beforeEach(async () => {
  await closeDbForTests();
  await new Promise<void>((r) => {
    const q = indexedDB.deleteDatabase(DB_NAME);
    q.onsuccess = q.onerror = () => r();
  });
  readwiseSettings.reset();
  appSettings.reset();
});
afterEach(() => vi.unstubAllGlobals());

describe('Readwise', () => {
  it('标注 → 高亮：书名/作者/原文/笔记/章节；书签、无原文、已删除的不分享', () => {
    expect(toReadwise(ann({ note: '我的想法' }), book, true)).toEqual({ title: '三体', author: '刘慈欣, 某译者', text: '被标注的原文', note: '我的想法', chapter: '第一章' });
    expect(toReadwise(ann(), book, false)).toEqual({ title: '三体', author: '刘慈欣, 某译者', text: '被标注的原文' });
    expect(toReadwise(ann({ kind: 'bookmark' }), book, true)).toBeNull();
    expect(toReadwise(ann({ text: '  ' }), book, true)).toBeNull();
    expect(toReadwise(ann({ deletedAt: 1 }), book, true)).toBeNull();
  });

  it('请求格式照原 app：POST、Token 头、{highlights:[…]}；测试高亮内容一致', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    await sendTestHighlight({ token: 'tk', url: '' }, fetchMock as unknown as typeof fetch);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://readwise.io/api/v2/highlights/');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Token tk', 'Content-Type': 'application/json;charset=UTF-8' });
    expect(JSON.parse(init.body as string)).toEqual({ highlights: [{ title: 'test', author: 'moonreader', text: 'test highlight', note: 'test note' }] });
  });

  it('非 200 抛出带状态码与服务端消息的错误', async () => {
    const f = (async () => new Response(JSON.stringify({ detail: 'Invalid token.' }), { status: 401 })) as unknown as typeof fetch;
    await expect(postHighlights([], { token: 'x', url: 'https://readwise.io/api/v2/highlights/' }, f)).rejects.toThrow('401 | Invalid token.');
    await expect(postHighlights([], { token: 'x', url: '' }, f)).rejects.toBeInstanceOf(ReadwiseError);
  });

  it('直连失败（CORS/离线）且没有服务端时给出错误，不崩溃', async () => {
    appSettings.set({ serverUrl: '' });
    const f = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(postHighlights([], { token: 'x', url: '' }, f)).rejects.toThrow('Failed to fetch');
  });

  it('直连失败时改走服务端代理，令牌放在 X-Proxy-Authorization', async () => {
    appSettings.set({ serverUrl: 'http://srv' });
    const seen: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, headers: Object.fromEntries([...new Headers(init.headers).entries()].map(([k, v]) => [k.toLowerCase(), v])) });
      return new Response('{}', { status: 200 });
    });
    const failing = (async () => {
      throw new TypeError('CORS');
    }) as unknown as typeof fetch;
    await postHighlights([{ title: 't', text: 'x', author: 'a' }], { token: 'tk', url: '' }, failing);
    expect(seen[0].url).toBe('http://srv/api/proxy?url=' + encodeURIComponent('https://readwise.io/api/v2/highlights/'));
    expect(seen[0].headers['x-proxy-authorization']).toBe('Token tk');
  });

  it('手动分享单条：没有 token 先提示；有 token 就发', async () => {
    await putBook({ id: 'b1', fileName: 'a.epub', format: 'epub', size: 1, title: '三体', authors: ['刘慈欣'], tags: [], addedAt: 1, onShelf: true, hasCover: false });
    await expect(shareAnnotation(ann())).rejects.toThrow('Readwise Token');
    readwiseSettings.set({ token: 'tk' });
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response('{}', { status: 200 });
    });
    await shareAnnotation(ann({ note: 'n' }));
    expect(JSON.parse(bodies[0]).highlights[0]).toMatchObject({ title: '三体', text: '被标注的原文', note: 'n' });
  });

  it('自动分享：只发「刚创建」的高亮，同一条不重复发', async () => {
    await putBook({ id: 'b1', fileName: 'a.epub', format: 'epub', size: 1, title: '三体', authors: ['刘慈欣'], tags: [], addedAt: 1, onShelf: true, hasCover: false });
    readwiseSettings.set({ token: 'tk', auto: true });
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).highlights[0].text);
      return new Response('{}', { status: 200 });
    });
    startReadwiseAutoShare();
    await putAnnotation(ann({ id: 'new1', text: '新高亮' }));
    await putAnnotation(ann({ id: 'new1', text: '新高亮', note: '后来加的笔记' })); // 同一条再次变更
    await putAnnotation(ann({ id: 'old1', text: '很久以前的', createdAt: Date.now() - 10 * 60_000 }));
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toEqual(['新高亮']);
  });
});
