import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appSettings } from '@/core/app-settings';
import { AuthRequiredError, NotOpdsError, correctExt, downloadFile, fetchFeed, parseContentDisposition, sniffExt } from './opds-client';

const FEED = `<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><entry><title>e</title><link rel="subsection" type="application/atom+xml" href="/x"/></entry></feed>`;

describe('opds-client', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let handler: (url: string, init: RequestInit) => Response;
  beforeEach(() => {
    calls.length = 0;
    appSettings.set({ serverUrl: 'http://srv', serverToken: 'tok' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return handler(url, init);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('经代理请求：URL 编码、服务端令牌与站点认证分开传', async () => {
    handler = () => new Response(FEED, { headers: { 'X-Proxy-Final-Url': 'http://final/opds' } });
    const feed = await fetchFeed('http://site/opds?a=1', { username: 'u', password: 'p', userAgent: 'UA1' });
    expect(feed.entries[0].href).toBe('http://final/x');
    const { url, init } = calls[0];
    expect(url).toBe('http://srv/api/proxy?url=' + encodeURIComponent('http://site/opds?a=1'));
    const h = new Headers(init.headers);
    expect(h.get('Authorization')).toBe('Bearer tok');
    expect(h.get('X-Proxy-Authorization')).toBe('Basic ' + btoa('u:p'));
    expect(h.get('X-Proxy-User-Agent')).toBe('UA1');
  });
  it('401 → 需要登录；返回网页 → NotOpdsError 带标题', async () => {
    handler = () => new Response('no', { status: 401 });
    await expect(fetchFeed('http://s/')).rejects.toBeInstanceOf(AuthRequiredError);
    handler = () => new Response('<html><head><title> My Site </title></head></html>');
    const e = await fetchFeed('http://s/').catch((x) => x);
    expect(e).toBeInstanceOf(NotOpdsError);
    expect(e.pageTitle).toBe('My Site');
  });
  it('下载：读取流并报告进度，解析 Content-Disposition', async () => {
    handler = () => new Response(new Uint8Array(1000), { headers: { 'Content-Length': '1000', 'Content-Type': 'application/epub+zip', 'Content-Disposition': `attachment; filename*=UTF-8''%E4%B9%A6.epub` } });
    const seen: number[] = [];
    const r = await downloadFile('http://s/b', { onProgress: (l) => seen.push(l) });
    expect(r.blob.size).toBe(1000);
    expect(r.fileName).toBe('书.epub');
    expect(seen.at(-1)).toBe(1000);
  });
  it('文件头魔数与扩展名纠正', () => {
    const pdf = new TextEncoder().encode('%PDF-1.7');
    expect(sniffExt(pdf)).toBe('pdf');
    expect(correctExt('epub', pdf)).toBe('pdf');
    const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
    expect(correctExt('epub', zip)).toBe('epub');
    expect(correctExt('txt', zip)).toBe('zip');
    expect(correctExt('epub', new Uint8Array(8))).toBe('epub');
    expect(parseContentDisposition('attachment; filename="a b.pdf"')).toBe('a b.pdf');
  });
});
