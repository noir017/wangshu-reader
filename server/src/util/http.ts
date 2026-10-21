// HTTP 相关的小工具：错误、文件名头、MIME、路径编码。
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import path from 'node:path';

export function httpError(status: ContentfulStatusCode, message: string): HTTPException {
  return new HTTPException(status, { message });
}

/** Content-Disposition：ASCII 回退名 + RFC 5987 的 UTF-8 名（响应头只能是 latin1） */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
  const star = encodeURIComponent(filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${star}`;
}

const MIME: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/vnd.amazon.ebook',
  azw3: 'application/vnd.amazon.ebook',
  prc: 'application/x-mobipocket-ebook',
  fb2: 'application/x-fictionbook+xml',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml',
  xml: 'application/xml',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  rtf: 'application/rtf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  cbz: 'application/vnd.comicbook+zip',
  cbr: 'application/vnd.comicbook-rar',
  cb7: 'application/x-cb7',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  chm: 'application/vnd.ms-htmlhelp',
  djvu: 'image/vnd.djvu',
  djv: 'image/vnd.djvu',
  umd: 'application/octet-stream',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  ttf: 'font/ttf',
  otf: 'font/otf',
  ttc: 'font/collection',
  otc: 'font/collection',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function mimeOf(name: string): string {
  return MIME[extOf(name)] ?? 'application/octet-stream';
}

/** 逐段 encodeURIComponent，保留 '/'（用于 DAV href） */
export function encodePath(p: string): string {
  return p
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

export function baseName(p: string): string {
  return path.posix.basename(p.replace(/\\/g, '/'));
}

/** 去掉路径分隔符与控制字符，得到可安全落盘的单段文件名；不可用时返回空串 */
export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  let s = name.replace(/[\x00-\x1f\x7f]/g, '').replace(/[/\\]/g, '_').trim();
  if (s === '.' || s === '..') s = '';
  // 文件名最长 255 字节
  while (Buffer.byteLength(s) > 255) s = s.slice(0, -1);
  return s;
}

/** 单个区间的 Range 解析；返回 null = 没带 Range，'invalid' = 不可满足 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)(?:\s*,.*)?$/i.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start: number;
  let end: number;
  if (a === '') {
    const n = Number(b);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}
