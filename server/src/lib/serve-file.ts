// 文件响应：Range（单区间）、ETag/Last-Modified 条件请求、HEAD；用户上传的内容一律加沙箱与 nosniff，防止同源 XSS。
import type { Context } from 'hono';
import { createReadStream, type Stats } from 'node:fs';
import { Readable } from 'node:stream';
import { contentDisposition, extOf, mimeOf, parseRange } from '../util/http';

/** 浏览器会当文档执行脚本的类型：强制下载 */
const ACTIVE_TYPES = new Set(['html', 'htm', 'xhtml', 'svg', 'xml']);

export function etagOf(st: Pick<Stats, 'size' | 'mtimeMs'>): string {
  return `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
}

export const SAFE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' } as const;

export interface ServeOptions {
  name: string;
  /** null = 不带 Content-Disposition（DAV） */
  disposition?: 'inline' | 'attachment' | null;
  cacheControl?: string;
}

export function serveFile(c: Context, file: string, st: Stats, opts: ServeOptions): Response {
  const head = c.req.method === 'HEAD';
  const etag = etagOf(st);
  const headers: Record<string, string> = {
    'Content-Type': mimeOf(opts.name),
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    ...SAFE_HEADERS,
  };
  const disp = opts.disposition === undefined ? (ACTIVE_TYPES.has(extOf(opts.name)) ? 'attachment' : 'inline') : opts.disposition;
  if (disp) headers['Content-Disposition'] = contentDisposition(disp, opts.name);
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl;

  const inm = c.req.header('If-None-Match');
  if (inm && inm.split(',').some((t) => t.trim() === etag || t.trim() === '*')) return new Response(null, { status: 304, headers });
  const ims = c.req.header('If-Modified-Since');
  if (!inm && ims && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(ims) / 1000)) return new Response(null, { status: 304, headers });

  // If-Range 与当前版本不符时忽略 Range，整文件返回
  const ifRange = c.req.header('If-Range');
  const useRange = !ifRange || ifRange === etag || Date.parse(ifRange) === Math.floor(st.mtimeMs / 1000) * 1000;
  const range = useRange ? parseRange(c.req.header('Range'), st.size) : null;
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${st.size}` } });
  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${st.size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
    if (head) return new Response(null, { status: 206, headers });
    return new Response(Readable.toWeb(createReadStream(file, { start: range.start, end: range.end })) as ReadableStream, { status: 206, headers });
  }
  headers['Content-Length'] = String(st.size);
  if (head || st.size === 0) return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers });
}
