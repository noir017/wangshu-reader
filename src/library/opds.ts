// OPDS / Atom 解析（NET-002..004，spec 01 §4.6）。解析是纯函数；请求走 /api/proxy（opds-client 部分）。
import { child, childText, childrenOf, innerXml, parseXml, textOf, type XNode } from '@/storage/xml';

export interface OpdsLink {
  rel: string;
  type: string;
  href: string;
  title?: string;
  length?: number;
}

export interface OpdsDownload {
  href: string;
  type: string;
  /** 小写扩展名（epub/pdf/mobi/azw3/txt/fb2/cbz/cbr/djvu/zip） */
  ext: string;
  title?: string;
  size?: number;
  isZip: boolean;
}

export type EntryKind = 'book' | 'dir' | 'web';

export interface OpdsEntry {
  id: string;
  title: string;
  updated?: string;
  authors: string[];
  /** 简介（HTML，显示前需清洗） */
  summaryHtml: string;
  kind: EntryKind;
  downloads: OpdsDownload[];
  cover?: string;
  thumb?: string;
  /** 子目录/网页链接 */
  href?: string;
  related: OpdsLink[];
  alternate?: string;
  language?: string;
  published?: string;
}

export interface OpdsFeed {
  title: string;
  subtitle: string;
  id: string;
  baseUrl: string;
  selfUrl?: string;
  nextUrl?: string;
  prevUrl?: string;
  firstUrl?: string;
  startUrl?: string;
  /** 带 {searchTerms} 的模板 */
  searchTemplate?: string;
  /** OpenSearch 描述文档地址（需再抓取一次才能拿到模板） */
  searchDescUrl?: string;
  totalResults?: number;
  itemsPerPage?: number;
  startIndex?: number;
  entries: OpdsEntry[];
}

/** 解析相对链接。data: 原样返回；合不成合法 URL 时返回空串 */
export function resolveHref(base: string, href: string): string {
  const h = href.trim();
  if (!h) return '';
  if (h.startsWith('data:')) return h;
  try {
    return new URL(h, base).href;
  } catch {
    return '';
  }
}

const TYPE_EXT: [RegExp, string][] = [
  [/epub/i, 'epub'],
  [/pdf/i, 'pdf'],
  [/x-mobi8|vnd\.amazon\.(ebook|mobi8)|azw3/i, 'azw3'],
  [/mobipocket|x-mobi|azw/i, 'mobi'],
  [/fb2|fictionbook/i, 'fb2'],
  [/cbz|comicbook\+zip/i, 'cbz'],
  [/cbr|comicbook-rar/i, 'cbr'],
  [/djvu/i, 'djvu'],
  [/^text\/plain/i, 'txt'],
  [/application\/zip|x-zip/i, 'zip'],
];

const URL_EXT = /\.(epub3?|pdf|mobi|azw3?|prc|fb2(?:\.zip)?|cbz|cbr|djvu?|txt|zip|kindle(?:\.noimages|\.images)?)(?:$|[?#])/i;

/** 由 type 与 href 推断下载格式；不是书文件返回 null */
export function downloadExt(type: string, href: string): string | null {
  const t = type.split(';')[0].trim();
  for (const [re, ext] of TYPE_EXT) if (re.test(t)) return ext;
  const m = URL_EXT.exec(href.split('?')[0] + '?');
  if (m) {
    const e = m[1].toLowerCase();
    if (e.startsWith('epub')) return 'epub';
    if (e.startsWith('kindle') || e === 'prc' || e === 'azw') return 'mobi';
    if (e === 'azw3') return 'azw3';
    if (e === 'djv') return 'djvu';
    return e;
  }
  return null;
}

const isImageRel = (rel: string) => /opds-spec\.org\/(image|cover|thumbnail|.*thumbnail)|opds-cover-image-thumbnail|image\/thumbnail/i.test(rel);
const isThumbRel = (rel: string) => /thumbnail/i.test(rel);

function parseEntry(e: XNode, base: string, selfLang?: string): OpdsEntry {
  const links = childrenOf(e, 'link').map((l) => ({
    rel: l.attrs.rel ?? '',
    type: l.attrs.type ?? '',
    href: resolveHref(base, l.attrs.href ?? ''),
    title: l.attrs.title,
    length: l.attrs.length ? Number(l.attrs.length) || undefined : undefined,
  }));
  const downloads: OpdsDownload[] = [];
  let cover: string | undefined;
  let thumb: string | undefined;
  let nav: OpdsLink | undefined;
  let alternate: string | undefined;
  const related: OpdsLink[] = [];
  for (const l of links) {
    if (!l.href) continue;
    if (/^related$/i.test(l.rel)) {
      related.push(l);
      continue;
    }
    if (isImageRel(l.rel)) {
      if (isThumbRel(l.rel)) thumb ??= l.href;
      else cover ??= l.href;
      continue;
    }
    if (/opds-spec\.org\/acquisition/i.test(l.rel) || (/^application\//i.test(l.type) && downloadExt(l.type, l.href) && !/atom\+xml/i.test(l.type))) {
      // 买/借/订阅/试读不是可直接下载的全本
      if (/acquisition\/(buy|borrow|subscribe|sample)/i.test(l.rel)) continue;
      const ext = downloadExt(l.type, l.href);
      if (ext) downloads.push({ href: l.href, type: l.type, ext, title: l.title, size: l.length, isZip: ext === 'zip' || /\+zip/i.test(l.type) });
      continue;
    }
    if (/^alternate$/i.test(l.rel)) {
      alternate ??= l.href;
      continue;
    }
    // 子目录 / 导航：无 rel、subsection、排序等
    if (!l.rel || /subsection|opds-spec\.org\/(sort|crawlable|facet)|^(first|next|previous|start|up)$/i.test(l.rel) || /atom\+xml/i.test(l.type)) nav ??= l;
    else if (!nav) nav = l;
  }
  const contentNode = child(e, 'content');
  const summaryNode = child(e, 'summary');
  let summaryHtml = '';
  const render = (n: XNode | undefined) => {
    if (!n) return '';
    const ty = (n.attrs.type ?? 'text').toLowerCase();
    if (ty === 'xhtml') return innerXml(n);
    const raw = textOf(n);
    if (ty === 'html') return raw;
    return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
  };
  summaryHtml = render(contentNode);
  // content 太短而有 summary 时用 summary（原行为）
  if (summaryHtml.replace(/<[^>]+>/g, '').trim().length < 10 && summaryNode) {
    const s2 = render(summaryNode);
    if (s2.length > summaryHtml.length) summaryHtml = s2;
  }
  // 有下载链接 = 书；子目录链接（atom / subsection / 无类型）= 目录；其余当网页
  const navIsDir = !!nav && (/atom/i.test(nav.type) || /subsection|opds-spec\.org\/(sort|crawlable|facet)/i.test(nav.rel) || (!nav.type && !/^alternate$/i.test(nav.rel)));
  const kind: EntryKind = downloads.length ? 'book' : navIsDir ? 'dir' : 'web';
  return {
    id: childText(e, 'id'),
    title: childText(e, 'title') || '(无标题)',
    updated: childText(e, 'updated') || undefined,
    authors: childrenOf(e, 'author')
      .map((a) => childText(a, 'name'))
      .filter(Boolean),
    summaryHtml,
    kind,
    downloads,
    cover,
    thumb,
    href: nav?.href ?? alternate,
    related,
    alternate,
    language: childText(e, 'language') || selfLang,
    published: childText(e, 'published') || undefined,
  };
}

/** 解析 OPDS/Atom feed。xml 不是 feed（HTML 错误页等）返回 null */
export function parseOpds(xml: string, requestUrl: string): OpdsFeed | null {
  const root = parseXml(xml);
  if (!root || root.local !== 'feed') return null;
  const xmlBase = root.attrs['xml:base'];
  let base = requestUrl;
  const feedLinks = childrenOf(root, 'link');
  const selfLink = feedLinks.find((l) => l.attrs.rel === 'self')?.attrs.href;
  if (xmlBase && /^https?:/i.test(xmlBase)) base = xmlBase;
  else if (selfLink && /^https?:/i.test(selfLink)) base = selfLink;
  const href = (rel: string) => {
    const l = feedLinks.find((x) => (x.attrs.rel ?? '') === rel);
    return l?.attrs.href ? resolveHref(base, l.attrs.href) : undefined;
  };
  // search：含 {searchTerms} 的直接用；否则当 OpenSearch 描述文档
  let searchTemplate: string | undefined;
  let searchDescUrl: string | undefined;
  for (const l of feedLinks.filter((x) => (x.attrs.rel ?? '') === 'search')) {
    const h = l.attrs.href ?? '';
    if (!h) continue;
    if (h.includes('{searchTerms}') || decodeURIComponent(h).includes('{searchTerms}')) searchTemplate ??= resolveHrefKeepTemplate(base, h);
    else searchDescUrl ??= resolveHref(base, h);
  }
  const num = (n: string) => {
    const v = parseInt(
      root.children
        .filter((c): c is XNode => typeof c !== 'string' && c.local === n)
        .map((c) => textOf(c))
        .join('')
        .trim(),
      10,
    );
    return Number.isFinite(v) ? v : undefined;
  };
  const lang = childText(root, 'language') || undefined;
  return {
    title: childText(root, 'title'),
    subtitle: childText(root, 'subtitle'),
    id: childText(root, 'id'),
    baseUrl: base,
    selfUrl: selfLink ? resolveHref(base, selfLink) : undefined,
    nextUrl: href('next'),
    prevUrl: href('previous') ?? href('prev'),
    firstUrl: href('first'),
    startUrl: href('start'),
    searchTemplate,
    searchDescUrl,
    totalResults: num('totalresults'),
    itemsPerPage: num('itemsperpage'),
    startIndex: num('startindex'),
    entries: childrenOf(root, 'entry').map((e) => parseEntry(e, base, lang)),
  };
}

/** 模板里的 {searchTerms} 会被 URL 解析器编码成 %7BsearchTerms%7D，要还原 */
export function resolveHrefKeepTemplate(base: string, href: string): string {
  return resolveHref(base, href.replace(/\{/g, '%7B').replace(/\}/g, '%7D'))
    .replace(/%7B/gi, '{')
    .replace(/%7D/gi, '}');
}

/** 从 OpenSearch 描述文档里取 application/atom+xml 的搜索模板（XmlHandler.getSearchUrl） */
export function parseOpenSearchDescription(xml: string, requestUrl: string): string | undefined {
  const root = parseXml(xml);
  if (!root) return undefined;
  const urls = childrenOf(root, 'url').filter((u) => u.attrs.template?.includes('{searchTerms}'));
  const pick = urls.find((u) => /atom\+xml/i.test(u.attrs.type ?? '')) ?? urls.find((u) => !/html/i.test(u.attrs.type ?? '')) ?? urls[0];
  return pick?.attrs.template ? resolveHrefKeepTemplate(requestUrl, pick.attrs.template) : undefined;
}

/** 填搜索模板：{searchTerms} → URL 编码关键字；{startPage?} 之类可选参数去掉 */
export function fillSearchTemplate(tpl: string, q: string): string {
  return tpl
    .replace(/\{searchTerms\??\}/g, encodeURIComponent(q))
    .replace(/\{startPage\??\}/g, '1')
    .replace(/\{startIndex\??\}/g, '1')
    .replace(/\{count\??\}/g, '25')
    .replace(/\{[a-zA-Z:]+\?\}/g, '');
}

/** 上一页地址：已知总数与每页条数时可推算（NET-002），否则返回 undefined 由调用方用历史栈 */
export function guessPrevUrl(feed: OpdsFeed): string | undefined {
  if (feed.prevUrl) return feed.prevUrl;
  const per = feed.itemsPerPage;
  const start = feed.startIndex ?? 1;
  const self = feed.selfUrl;
  if (!per || start <= 1 || !self) return undefined;
  try {
    const u = new URL(self);
    for (const k of ['start_index', 'startIndex', 'start-index']) {
      if (u.searchParams.has(k)) {
        u.searchParams.set(k, String(Math.max(1, start - per)));
        return u.href;
      }
    }
  } catch {
    /* 非法 URL */
  }
  return undefined;
}

export function pageInfo(feed: OpdsFeed): { page: number; pages: number } | null {
  const per = feed.itemsPerPage;
  const total = feed.totalResults;
  if (!per || !total || per <= 0) return null;
  return { page: Math.floor(((feed.startIndex ?? 1) - 1) / per) + 1, pages: Math.ceil(total / per) };
}

/** 保存下载文件时的文件名：{书名 - 作者}.{ext}（getDownloadTo） */
export function downloadName(title: string, author: string, ext: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  let base = clean(author ? `${title} - ${author}` : title);
  if (base.length > 100) base = base.slice(0, 100).trim() + String(Math.floor(Math.random() * 900 + 100));
  return `${base || 'book'}.${ext === 'zip' ? 'zip' : ext}`;
}
