// CHM → EPUB（FMT-014）：用 7z 解包，按 #SYSTEM 里的目录文件(.hhc)/首页/语言信息生成 EPUB 3（附 NCX）。
// 页面用 parse5 重新序列化成良构 XHTML；链接按大小写不敏感重写（CHM 内部路径不区分大小写，zip 区分）。
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import { extractAll, listArchive, assertExtractable, walkRegularFiles, type ExtractedFile } from './archive';
import { ZipWriter } from './zipwriter';
import { encodePath, extOf } from '../util/http';
import { escapeXml, naturalCompare } from '../util/text';

// ───────────────────────── #SYSTEM / 编码 ─────────────────────────

export interface ChmSystemInfo {
  hhc?: string;
  hhk?: string;
  home?: string;
  title?: string;
  lcid?: number;
}

/** 解析 #SYSTEM：4 字节版本，之后是 (code u16, len u16, data) 序列 */
export function parseChmSystem(buf: Buffer): ChmSystemInfo {
  const info: ChmSystemInfo = {};
  let p = 4;
  const str = (b: Buffer) => b.toString('latin1').replace(/\0.*$/s, '');
  while (p + 4 <= buf.length) {
    const code = buf.readUInt16LE(p);
    const len = buf.readUInt16LE(p + 2);
    const data = buf.subarray(p + 4, p + 4 + len);
    p += 4 + len;
    if (data.length < len) break;
    if (code === 0) info.hhc = str(data);
    else if (code === 1) info.hhk = str(data);
    else if (code === 2) info.home = str(data);
    else if (code === 3) info.title = str(data);
    else if (code === 4 && len >= 4) info.lcid = data.readUInt32LE(0);
  }
  return info;
}

/** Windows 语言 ID → [文本编码, BCP-47 语言] */
const LANG_TABLE: Record<number, [string, string]> = {
  0x0804: ['gbk', 'zh-CN'],
  0x1004: ['gbk', 'zh-SG'],
  0x0404: ['big5', 'zh-TW'],
  0x0c04: ['big5', 'zh-HK'],
  0x1404: ['big5', 'zh-MO'],
  0x0411: ['shift_jis', 'ja'],
  0x0412: ['euc-kr', 'ko'],
  0x0419: ['windows-1251', 'ru'],
  0x0422: ['windows-1251', 'uk'],
  0x0402: ['windows-1251', 'bg'],
  0x0415: ['windows-1250', 'pl'],
  0x0405: ['windows-1250', 'cs'],
  0x040e: ['windows-1250', 'hu'],
  0x0418: ['windows-1250', 'ro'],
  0x041b: ['windows-1250', 'sk'],
  0x0408: ['windows-1253', 'el'],
  0x041f: ['windows-1254', 'tr'],
  0x040d: ['windows-1255', 'he'],
  0x0401: ['windows-1256', 'ar'],
  0x041e: ['windows-874', 'th'],
  0x042a: ['windows-1258', 'vi'],
  0x0407: ['windows-1252', 'de'],
  0x040c: ['windows-1252', 'fr'],
  0x0410: ['windows-1252', 'it'],
  0x0c0a: ['windows-1252', 'es'],
  0x040a: ['windows-1252', 'es'],
  0x0416: ['windows-1252', 'pt-BR'],
  0x0816: ['windows-1252', 'pt-PT'],
  0x0409: ['windows-1252', 'en-US'],
  0x0809: ['windows-1252', 'en-GB'],
};

export function chmEncoding(lcid: number | undefined): { encoding: string; lang: string } {
  const hit = lcid === undefined ? undefined : (LANG_TABLE[lcid] ?? LANG_TABLE[lcid & 0xffff]);
  return { encoding: hit?.[0] ?? 'windows-1252', lang: hit?.[1] ?? 'en' };
}

function tryDecoder(label: string): TextDecoder | null {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** 解码一个 HTML/CSS 文件：BOM → <meta charset>/@charset → 能严格按 UTF-8 解码就用 UTF-8 → CHM 头里的语言编码 */
export function decodeChmText(buf: Buffer, fallbackEncoding: string): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  const head = buf.subarray(0, 4096).toString('latin1');
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head) ?? /@charset\s+["']([\w.:-]+)["']/i.exec(head);
  if (m) {
    const label = m[1].toLowerCase();
    const dec = tryDecoder(label === 'utf8' ? 'utf-8' : label);
    if (dec) return dec.decode(buf);
  }
  if (isValidUtf8(buf)) return buf.toString('utf8');
  return (tryDecoder(fallbackEncoding) ?? new TextDecoder('windows-1252')).decode(buf);
}

// ───────────────────────── .hhc 目录 ─────────────────────────

export interface TocNode {
  title: string;
  /** hhc 里写的 Local 原文（相对路径，可能带 #锚点、百分号编码） */
  local?: string;
  children: TocNode[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', reg: '®', copy: '©', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', trade: '™', laquo: '«', raquo: '»', middot: '·', bull: '•',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const cp = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? all;
  });
}

/** 解析 HTML Help 的 sitemap（.hhc）：嵌套 <UL><LI><OBJECT type="text/sitemap"><param name=Name/Local> */
export function parseHhc(html: string): TocNode[] {
  const root: TocNode = { title: '', children: [] };
  const stack: TocNode[] = [root];
  let lastItem: TocNode | null = null;
  const re = /<(\/?)(ul|object)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'ul') {
      if (closing) {
        if (stack.length > 1) stack.pop();
        lastItem = null;
      } else {
        stack.push(lastItem ?? stack[stack.length - 1]);
        lastItem = null;
      }
      continue;
    }
    if (closing || !/text\/sitemap/i.test(m[3])) continue;
    const closeIdx = html.slice(re.lastIndex).search(/<\/object\s*>/i);
    const body = closeIdx < 0 ? html.slice(re.lastIndex) : html.slice(re.lastIndex, re.lastIndex + closeIdx);
    const params = new Map<string, string>();
    const pre = /<param\b[^>]*>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = pre.exec(body))) {
      const name = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(pm[0]);
      const value = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(pm[0]);
      if (!name) continue;
      const k = (name[1] ?? name[2] ?? name[3]).toLowerCase();
      const v = value ? (value[1] ?? value[2] ?? value[3] ?? '') : '';
      // 同一个条目可能有多个 Name/Local（索引文件常见），取第一个
      if (!params.has(k)) params.set(k, decodeEntities(v));
    }
    re.lastIndex += Math.max(closeIdx, 0);
    const item: TocNode = { title: (params.get('name') ?? '').trim(), local: params.get('local')?.trim() || undefined, children: [] };
    if (!item.title && !item.local) continue;
    stack[stack.length - 1].children.push(item);
    lastItem = item;
  }
  return root.children;
}

// ───────────────────────── HTML → XHTML ─────────────────────────

interface P5Node {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  value?: string;
  attrs?: { name: string; value: string; prefix?: string; namespace?: string }[];
  childNodes?: P5Node[];
  content?: P5Node;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const DROP = new Set(['script', 'noscript', 'iframe', 'object', 'embed', 'applet', 'frame', 'frameset', 'svg', 'math', 'template', 'meta', 'base', 'title']);
const XML_NAME = /^[A-Za-z_][\w.-]*$/;
const URL_ATTRS = new Set(['href', 'src', 'background']);

export interface LinkResolver {
  /** 把页面 pageRel 里出现的 url 改写成指向 EPUB 内真实文件的相对 URL；不是内部链接则原样返回 */
  (pageRel: string, url: string): string;
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

function findEl(node: P5Node, tag: string): P5Node | undefined {
  for (const c of node.childNodes ?? []) {
    if (c.tagName === tag) return c;
    const r = findEl(c, tag);
    if (r) return r;
  }
  return undefined;
}

function serializeNode(n: P5Node, pageRel: string, resolve: LinkResolver, out: string[]): void {
  if (n.nodeName === '#text') {
    // XML 不允许的控制字符丢掉
    // eslint-disable-next-line no-control-regex
    out.push(escText((n.value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, '')));
    return;
  }
  if (n.nodeName.startsWith('#')) return; // 注释等
  const tag = n.tagName!;
  if (DROP.has(tag) || n.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
  let attrs = '';
  const seen = new Set<string>();
  let nameAnchor: string | undefined;
  for (const a of n.attrs ?? []) {
    const name = a.name.toLowerCase();
    if (a.prefix || name.includes(':') || !XML_NAME.test(name) || /^on/.test(name) || seen.has(name)) continue;
    seen.add(name);
    let value = a.value;
    if (URL_ATTRS.has(name)) {
      if (/^\s*javascript:/i.test(value)) continue;
      value = resolve(pageRel, value);
    }
    if (tag === 'a' && name === 'name') nameAnchor = value;
    if (name === 'xmlns') continue;
    attrs += ` ${name}="${escAttr(value)}"`;
  }
  // HTML4 的 <a name=x> 在 XHTML5 里要用 id
  if (nameAnchor && !seen.has('id')) attrs += ` id="${escAttr(nameAnchor)}"`;
  if (VOID.has(tag)) {
    out.push(`<${tag}${attrs}/>`);
    return;
  }
  out.push(`<${tag}${attrs}>`);
  const kids = tag === 'template' ? (n.content?.childNodes ?? []) : (n.childNodes ?? []);
  for (const c of kids) serializeNode(c, pageRel, resolve, out);
  out.push(`</${tag}>`);
}

export interface XhtmlPage {
  xhtml: string;
  title: string;
}

/** 把一页 HTML 重新序列化成 EPUB 用的 XHTML；pageRel 是页面在包内的相对路径（解析相对链接用） */
export function htmlToXhtml(html: string, pageRel: string, resolve: LinkResolver, lang: string): XhtmlPage {
  const doc = parse(html) as unknown as P5Node;
  const root = findEl(doc, 'html') ?? doc;
  const head = findEl(root, 'head');
  const body = findEl(root, 'body');
  const titleEl = head ? findEl(head, 'title') : undefined;
  const title = (titleEl?.childNodes ?? [])
    .map((c) => c.value ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const headOut: string[] = [];
  headOut.push(`<title>${escText(title || path.posix.basename(pageRel, path.posix.extname(pageRel)))}</title>`);
  for (const c of head?.childNodes ?? []) {
    if (c.tagName === 'link' && /stylesheet/i.test(c.attrs?.find((a) => a.name === 'rel')?.value ?? '')) {
      const href = c.attrs?.find((a) => a.name === 'href')?.value;
      if (href) headOut.push(`<link rel="stylesheet" type="text/css" href="${escAttr(resolve(pageRel, href))}"/>`);
    } else if (c.tagName === 'style') {
      headOut.push(`<style type="text/css">${escText((c.childNodes ?? []).map((x) => x.value ?? '').join(''))}</style>`);
    }
  }
  const bodyOut: string[] = [];
  const bodyAttrs = body?.attrs?.find((a) => a.name === 'class');
  for (const c of body?.childNodes ?? []) serializeNode(c, pageRel, resolve, bodyOut);
  const xhtml =
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escAttr(lang)}" lang="${escAttr(lang)}">\n<head>\n${headOut.join('\n')}\n</head>\n` +
    `<body${bodyAttrs ? ` class="${escAttr(bodyAttrs.value)}"` : ''}>\n${bodyOut.join('')}\n</body>\n</html>\n`;
  return { xhtml, title };
}

// ───────────────────────── 总流程 ─────────────────────────

const HTML_EXT = new Set(['html', 'htm', 'xhtml']);
const SKIP_EXT = new Set(['js', 'hhc', 'hhk', 'hhp', 'chi', 'chm', 'chw', 'exe', 'dll', 'ico', 'db', 'url']);
const MEDIA: Record<string, string> = {
  css: 'text/css',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 构造链接改写器：相对链接 → 按大小写不敏感找到包内真实文件 → 以页面所在目录为基准的相对 URL */
export function makeLinkResolver(files: Iterable<string>): LinkResolver {
  const index = new Map<string, string>();
  for (const f of files) index.set(f.toLowerCase(), f);
  return (pageRel, url) => {
    const u = url.trim();
    if (!u || u.startsWith('#') || /^(https?:|mailto:|data:|ftp:|tel:)/i.test(u)) return url;
    let target = u;
    const its = /^(?:ms-its|mk):.*?::\/?(.*)$/i.exec(u);
    let fromRoot = false;
    if (its) {
      target = its[1];
      fromRoot = true;
    }
    const hashAt = target.indexOf('#');
    const frag = hashAt >= 0 ? target.slice(hashAt) : '';
    let p = safeDecode(hashAt >= 0 ? target.slice(0, hashAt) : target);
    const q = p.indexOf('?');
    if (q >= 0) p = p.slice(0, q);
    if (!p) return frag || url;
    const abs = p.startsWith('/') || fromRoot ? path.posix.normalize(p.replace(/^\/+/, '')) : path.posix.normalize(path.posix.join(path.posix.dirname(pageRel), p));
    const real = index.get(abs.toLowerCase());
    if (!real) return url;
    return encodePath(path.posix.relative(path.posix.dirname(pageRel), real) || path.posix.basename(real)) + frag;
  };
}

export interface ChmConvertResult {
  title: string;
  pages: number;
  tocEntries: number;
  encoding: string;
}

export async function convertChmToEpub(
  chmFile: string,
  outFile: string,
  workDir: string,
  opts: { fallbackTitle: string; maxExtractBytes: number },
): Promise<ChmConvertResult> {
  const listing = await listArchive(chmFile);
  assertExtractable(listing, opts.maxExtractBytes);
  await extractAll(chmFile, workDir, listing);
  const all = await walkRegularFiles(workDir);
  const byRel = new Map<string, ExtractedFile>();
  for (const f of all) {
    // #SYSTEM 之类的内部文件、$ 开头的索引文件、::DataSpace 都不是内容
    if (f.rel.split('/').some((seg) => seg.startsWith('#') || seg.startsWith('$') || seg.startsWith('::'))) continue;
    byRel.set(f.rel, f);
  }
  const lower = new Map<string, string>();
  for (const k of byRel.keys()) lower.set(k.toLowerCase(), k);
  const find = (p: string): string | undefined => lower.get(path.posix.normalize(safeDecode(p).replace(/^\/+/, '')).toLowerCase());

  const sysFile = all.find((f) => f.rel === '#SYSTEM');
  const sys = sysFile ? parseChmSystem(await readFile(sysFile.abs)) : {};
  const { encoding, lang } = chmEncoding(sys.lcid);

  // 目录文件：#SYSTEM 指定的；否则找第一个 .hhc
  let hhcRel = sys.hhc ? find(sys.hhc) : undefined;
  hhcRel ??= [...byRel.keys()].sort(naturalCompare).find((k) => extOf(k) === 'hhc');
  let toc: TocNode[] = [];
  if (hhcRel) toc = parseHhc(decodeChmText(await readFile(byRel.get(hhcRel)!.abs), encoding));
  const hhcDir = hhcRel ? path.posix.dirname(hhcRel) : '.';
  // Local 的基准：先试 hhc 所在目录，再试包根
  const locate = (local: string): string | undefined => {
    const noFrag = local.split('#')[0];
    if (!noFrag) return undefined;
    return find(path.posix.join(hhcDir, noFrag)) ?? find(noFrag);
  };

  const htmlFiles = [...byRel.keys()].filter((k) => HTML_EXT.has(extOf(k))).sort(naturalCompare);
  if (!htmlFiles.length) throw new Error('CHM 里没有找到 HTML 页面');

  // spine：首页 → 目录顺序（去重）→ 其余页面（linear=no）
  const spine: string[] = [];
  const inSpine = new Set<string>();
  const addSpine = (rel: string | undefined) => {
    if (rel && HTML_EXT.has(extOf(rel)) && !inSpine.has(rel)) {
      inSpine.add(rel);
      spine.push(rel);
    }
  };
  const tocHref = new Map<TocNode, string>(); // 目录项 → 包内路径(+锚点)
  const walkToc = (nodes: TocNode[]) => {
    for (const n of nodes) {
      const rel = n.local ? locate(n.local) : undefined;
      if (rel) {
        const frag = n.local!.includes('#') ? n.local!.slice(n.local!.indexOf('#')) : '';
        tocHref.set(n, rel + frag);
      }
      walkToc(n.children);
    }
  };
  walkToc(toc);
  const home = sys.home ? find(sys.home) : undefined;
  const firstToc = [...tocHref.values()][0]?.split('#')[0];
  if (home && home !== firstToc) addSpine(home);
  for (const href of tocHref.values()) addSpine(href.split('#')[0]);
  const tocCount = spine.length;
  for (const h of htmlFiles) addSpine(h);
  if (!spine.length) throw new Error('CHM 里没有可用的页面');

  const resolve = makeLinkResolver(byRel.keys());
  const zip = new ZipWriter(outFile);
  const ids = new Map<string, string>();
  const manifest: string[] = [];
  const spineItems: string[] = [];
  const pageTitles = new Map<string, string>();
  const used = new Set(byRel.keys());
  const navName = used.has('epub-nav.xhtml') ? `epub-nav-${randomUUID().slice(0, 8)}.xhtml` : 'epub-nav.xhtml';
  const ncxName = used.has('epub-toc.ncx') ? `epub-toc-${randomUUID().slice(0, 8)}.ncx` : 'epub-toc.ncx';
  try {
    await zip.add('mimetype', Buffer.from('application/epub+zip'), { compress: false });
    await zip.add(
      'META-INF/container.xml',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n`,
      ),
      { compress: true },
    );
    let n = 0;
    for (const rel of [...byRel.keys()].sort(naturalCompare)) {
      const ext = extOf(rel);
      if (SKIP_EXT.has(ext)) continue;
      const file = byRel.get(rel)!;
      const id = `r${++n}`;
      if (HTML_EXT.has(ext)) {
        const html = decodeChmText(await readFile(file.abs), encoding);
        const page = htmlToXhtml(html, rel, resolve, lang);
        pageTitles.set(rel, page.title);
        await zip.add(`OEBPS/${rel}`, Buffer.from(page.xhtml, 'utf8'), { compress: true });
        ids.set(rel, id);
        manifest.push(`<item id="${id}" href="${escapeXml(encodePath(rel))}" media-type="application/xhtml+xml"/>`);
      } else if (ext === 'css') {
        const css = decodeChmText(await readFile(file.abs), encoding);
        await zip.add(`OEBPS/${rel}`, Buffer.from(css, 'utf8'), { compress: true });
        manifest.push(`<item id="${id}" href="${escapeXml(encodePath(rel))}" media-type="text/css"/>`);
      } else if (MEDIA[ext]) {
        await zip.add(`OEBPS/${rel}`, await readFile(file.abs), { compress: ext === 'svg' || ext === 'bmp' });
        manifest.push(`<item id="${id}" href="${escapeXml(encodePath(rel))}" media-type="${MEDIA[ext]}"/>`);
      }
    }
    spine.forEach((rel, i) => {
      const id = ids.get(rel);
      if (id) spineItems.push(`<itemref idref="${id}"${i >= tocCount && !(home === rel) ? ' linear="no"' : ''}/>`);
    });

    // 目录：没有 hhc 时用页面 <title> 做平铺目录
    let navTree: TocNode[] = toc;
    const hrefOf = (nd: TocNode) => tocHref.get(nd);
    if (!tocHref.size) {
      navTree = spine.map((rel) => ({ title: pageTitles.get(rel) || path.posix.basename(rel, path.posix.extname(rel)), local: rel, children: [] }));
      for (const nd of navTree) tocHref.set(nd, nd.local!);
    }
    const title = (sys.title ? decodeChmText(Buffer.from(sys.title, 'latin1'), encoding) : '') || opts.fallbackTitle;
    const firstPage = encodePath(spine[0]);
    // 目录项 → 包内 href（路径部分编码，保留锚点）
    const hrefAttr = (nd: TocNode): string | undefined => {
      const t = tocHref.get(nd);
      if (!t) return undefined;
      const i = t.indexOf('#');
      return encodePath(i < 0 ? t : t.slice(0, i)) + (i < 0 ? '' : t.slice(i));
    };

    const navLi = (nodes: TocNode[]): string =>
      nodes.length
        ? `<ol>${nodes
            .map((nd) => {
              const h = hrefAttr(nd);
              const label = escapeXml(nd.title || pageTitles.get(hrefOf(nd)?.split('#')[0] ?? '') || '—');
              return `<li>${h ? `<a href="${escapeXml(h)}">${label}</a>` : `<span>${label}</span>`}${navLi(nd.children)}</li>`;
            })
            .join('')}</ol>`
        : '';
    await zip.add(
      `OEBPS/${navName}`,
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><title>${escapeXml(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>${escapeXml(title)}</h1>${navLi(navTree)}</nav></body></html>\n`,
      ),
      { compress: true },
    );
    let play = 0;
    const ncxPoints = (nodes: TocNode[]): string =>
      nodes
        .map((nd) => {
          const h = hrefAttr(nd) ?? firstPage;
          const id = ++play;
          return `<navPoint id="np${id}" playOrder="${id}"><navLabel><text>${escapeXml(nd.title || '—')}</text></navLabel><content src="${escapeXml(h)}"/>${ncxPoints(nd.children)}</navPoint>`;
        })
        .join('');
    const uid = `urn:uuid:${randomUUID()}`;
    await zip.add(
      `OEBPS/${ncxName}`,
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${escapeXml(title)}</text></docTitle><navMap>${ncxPoints(navTree)}</navMap></ncx>\n`,
      ),
      { compress: true },
    );
    manifest.push(`<item id="nav" href="${navName}" media-type="application/xhtml+xml" properties="nav"/>`);
    manifest.push(`<item id="ncx" href="${ncxName}" media-type="application/x-dtbncx+xml"/>`);
    await zip.add(
      'OEBPS/content.opf',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="bookid">${uid}</dc:identifier>\n<dc:title>${escapeXml(title)}</dc:title>\n<dc:language>${lang}</dc:language>\n<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>\n</metadata>\n<manifest>\n${manifest.join('\n')}\n</manifest>\n<spine toc="ncx">\n${spineItems.join('\n')}\n</spine>\n</package>\n`,
      ),
      { compress: true },
    );
    await zip.finish();
    return { title, pages: spine.length, tocEntries: tocHref.size, encoding };
  } catch (e) {
    zip.abort();
    throw e;
  }
}
