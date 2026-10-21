// OPDS 请求与下载（全部经 /api/proxy）。NET-002/003/004/007。
import { proxyFetch, type ProxyInit } from '@/storage/http';
import { fillSearchTemplate, parseOpds, parseOpenSearchDescription, type OpdsFeed } from './opds';

export interface CatalogAuth {
  userAgent?: string;
  username?: string;
  password?: string;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('需要登录');
    this.name = 'AuthRequiredError';
  }
}

/** 返回的不是 OPDS（多半是网页）。title 为网页标题，供「当作网页书库」使用 */
export class NotOpdsError extends Error {
  constructor(
    public html: string,
    public finalUrl: string,
  ) {
    super('不是 OPDS 书库');
    this.name = 'NotOpdsError';
  }
  get pageTitle(): string {
    return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(this.html)?.[1]?.trim() ?? '';
  }
}

function proxyInit(a: CatalogAuth | undefined, signal?: AbortSignal): ProxyInit {
  return {
    signal,
    userAgent: a?.userAgent,
    auth: a?.username ? { user: a.username, password: a.password ?? '' } : undefined,
  };
}

export async function fetchFeed(url: string, a?: CatalogAuth, signal?: AbortSignal): Promise<OpdsFeed> {
  const res = await proxyFetch(url, { ...proxyInit(a, signal), headers: { Accept: 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' } });
  if (res.status === 401) throw new AuthRequiredError();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const text = await res.text();
  const finalUrl = res.headers.get('X-Proxy-Final-Url') || url;
  const feed = parseOpds(text, finalUrl);
  if (!feed) throw new NotOpdsError(text, finalUrl);
  return feed;
}

/** feed 里只给了 OpenSearch 描述文档时，再抓一次取模板（NET-003） */
export async function discoverSearch(feed: OpdsFeed, a?: CatalogAuth, signal?: AbortSignal): Promise<string | undefined> {
  if (feed.searchTemplate) return feed.searchTemplate;
  if (!feed.searchDescUrl) return undefined;
  try {
    const res = await proxyFetch(feed.searchDescUrl, proxyInit(a, signal));
    if (!res.ok) return undefined;
    return parseOpenSearchDescription(await res.text(), res.headers.get('X-Proxy-Final-Url') || feed.searchDescUrl);
  } catch {
    return undefined;
  }
}

export async function searchFeed(template: string, q: string, a?: CatalogAuth, signal?: AbortSignal): Promise<OpdsFeed> {
  return fetchFeed(fillSearchTemplate(template, q), a, signal);
}

/** 取文件大小：HEAD，失败再试 Range GET 的 Content-Range（NBI 的 getUrlFileSize） */
export async function probeSize(url: string, a?: CatalogAuth): Promise<number | undefined> {
  try {
    const r = await proxyFetch(url, { ...proxyInit(a), method: 'HEAD' });
    const n = Number(r.headers.get('Content-Length'));
    if (r.ok && n > 0) return n;
  } catch {
    /* 忽略 */
  }
  return undefined;
}

// ───────────── 下载 ─────────────
export interface DownloadResult {
  blob: Blob;
  /** 响应头 Content-Disposition 里的文件名 */
  fileName?: string;
  finalUrl: string;
  contentType: string;
}

export function parseContentDisposition(h: string | null): string | undefined {
  if (!h) return undefined;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(h);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* 落到普通 filename */
    }
  }
  const m = /filename\s*=\s*"?([^";]+)"?/i.exec(h);
  return m ? m[1].trim() : undefined;
}

export async function downloadFile(
  url: string,
  opts: { auth?: CatalogAuth; signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void; expectedSize?: number } = {},
): Promise<DownloadResult> {
  const res = await proxyFetch(url, proxyInit(opts.auth, opts.signal));
  if (res.status === 401) throw new AuthRequiredError();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('Content-Length')) || opts.expectedSize || 0;
  const contentType = res.headers.get('Content-Type') ?? '';
  const fileName = parseContentDisposition(res.headers.get('Content-Disposition'));
  const finalUrl = res.headers.get('X-Proxy-Final-Url') || url;
  let blob: Blob;
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as unknown as BlobPart);
      loaded += value.byteLength;
      opts.onProgress?.(loaded, total);
    }
    blob = new Blob(chunks, { type: contentType.split(';')[0] });
  } else {
    blob = await res.blob();
    opts.onProgress?.(blob.size, blob.size);
  }
  return { blob, fileName, finalUrl, contentType };
}

/** 文件头魔数 → 扩展名（T.getFileTypeFromBinary）。认不出返回 null */
export function sniffExt(head: Uint8Array): string | null {
  const s = (a: number, b: number) => String.fromCharCode(...head.slice(a, b));
  if (s(0, 4) === '%PDF') return 'pdf';
  if (s(0, 8) === 'AT&TFORM') return 'djvu';
  if (s(0, 4) === 'Rar!') return 'rar';
  if (s(0, 4) === 'PK\u0003\u0004') return 'zip';
  if (s(60, 68) === 'BOOKMOBI') return 'mobi';
  if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf) return '7z';
  if (/<FictionBook/i.test(s(0, 400))) return 'fb2';
  return null;
}

/** 以魔数为准修正声明的扩展名；zip 家族（epub/cbz/docx/fb2.zip）保持声明不变 */
export function correctExt(declared: string, head: Uint8Array): string {
  const sniffed = sniffExt(head);
  if (!sniffed) return declared;
  if (sniffed === 'zip') return ['epub', 'cbz', 'docx', 'odt', 'zip', 'fb2.zip', 'epub3'].includes(declared) ? declared : 'zip';
  if (sniffed === 'mobi') return declared === 'azw3' || declared === 'azw' || declared === 'prc' ? declared : 'mobi';
  if (sniffed === 'rar') return declared === 'cbr' ? 'cbr' : 'rar';
  return sniffed;
}
