// MOBI / AZW / AZW3 / PRC（FMT-011）：MOBI6（PalmDOC/HUFF-CDIC 压缩）与 KF8（AZW3）。
// 底层解析用 vendor/foliate-mobi（foliate-js 的 mobi.js，MIT，见该目录 LICENSE 与改动清单），这里负责：
//   章节 HTML 走本项目统一的清洗流水线（DOMPurify）、资源（recindex / kindle:embed|flow）改写成 blob:、书内链接（filepos / kindle:pos）解析、目录、元数据、封面。
// 有 DRM（PalmDOC 头 encryption≠0）→ DrmError。纯 PalmDOC（TEXtREAd）按文本书打开。
import { unzlibSync } from 'fflate';
import type { Book, BookMetadata, BookProbe, BookSection, FormatParser, OpenOptions, ReflowableBook, SectionContent, TocEntry } from '@/core/book';
import { decodeAuto } from './encoding';
import { BookOpenError, DrmError, UnsupportedFormatError, corrupt } from './errors';
import { KF8, MOBI, MOBI6, type Kf8Book, type Mobi6Book, type MobiBookBase, type MobiTocItem } from './vendor/foliate-mobi/mobi.js';
import { ascii, makeYielder, readBytes, toBase64 } from './lib/bytes';
import { extractFootnote } from './lib/footnote';
import { sniffImageMime } from './lib/mime';
import { Lru, ResourceStore } from './lib/resources';
import { buildSectionContent, countHtmlChars, emptySection } from './lib/section';
import { extractIsbn, htmlToPlain, metaFromFileName } from './lib/text';
import { buildTxtBook } from './txt';

interface RawToc {
  title: string;
  level: number;
  section: number;
  anchor?: string;
}

/** 一种内部格式（MOBI6 / KF8）的适配：给公共装配代码提供章节原文、资源与链接改写 */
interface Flavor {
  /** 章节原文是片段（MOBI6）还是完整文档（KF8） */
  fragment: boolean;
  count: number;
  linear(i: number): boolean;
  /** 章节原始 HTML；空章返回 null */
  raw(i: number): Promise<string | null>;
  prepare(doc: Document): Promise<void>;
  resolveResource(ref: string): Promise<string | null>;
  loadStylesheet?(href: string): Promise<string | null>;
  rewriteCss?(css: string): Promise<string>;
  extraStyles: string[];
  toc(): Promise<RawToc[]>;
  resolveHref(href: string): { section: number; anchor?: string } | null;
}

// ───────────────────────── 公共小件 ─────────────────────────
const MOBI_ERR_UNSUPPORTED = /Missing MOBI header|Unknown compression/;

function fontMime(b: Uint8Array): string {
  const m = ascii(b, 0, 4);
  if (m === 'OTTO') return 'font/otf';
  if (m === 'wOFF') return 'font/woff';
  if (m === 'wOF2') return 'font/woff2';
  if (m === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'font/ttf';
  return '';
}

function toBlob(raw: ArrayBuffer | Uint8Array, mime?: string): Blob {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const type = (mime && mime !== 'application/octet-stream' ? mime : '') || sniffImageMime(bytes) || fontMime(bytes) || 'application/octet-stream';
  return new Blob([bytes as BlobPart], { type });
}

async function coverOf(mobi: { getCover(): Promise<Blob | undefined> }): Promise<Blob | null> {
  try {
    const c = await mobi.getCover();
    if (!c || !c.size) return null;
    const bytes = new Uint8Array(await c.arrayBuffer());
    return new Blob([bytes as BlobPart], { type: sniffImageMime(bytes) ?? 'image/jpeg' });
  } catch {
    return null;
  }
}

async function replaceAsync(src: string, re: RegExp, fn: (m: RegExpExecArray) => Promise<string>): Promise<string> {
  const jobs: { m: RegExpExecArray; out: Promise<string> }[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) jobs.push({ m, out: fn(m) });
  if (!jobs.length) return src;
  let out = '';
  let last = 0;
  for (const { m, out: p } of jobs) {
    out += src.slice(last, m.index) + (await p);
    last = m.index + m[0].length;
  }
  return out + src.slice(last);
}

function metaOf(m: MobiBookBase['metadata'], mobi: MOBI, fileName: string): BookMetadata {
  const fm = metaFromFileName(fileName);
  const clean = (s?: unknown) => String(s ?? '').replace(/\0/g, '').trim();
  const authors = (m.author ?? []).map(clean).filter(Boolean);
  const meta: BookMetadata = { title: clean(m.title) || fm.title, authors: authors.length ? authors : fm.authors };
  // EXTH 的语言是数组（可重复记录），MOBI 头里的是字符串
  const lang = clean(Array.isArray(m.language) ? m.language[0] : m.language);
  if (lang) meta.language = lang;
  const pub = clean(m.publisher);
  if (pub) meta.publisher = pub;
  const desc = htmlToPlain(m.description ?? '');
  if (desc) meta.description = desc;
  const subjects = (m.subject ?? []).map(clean).filter((s) => s && s.length < 50 && !s.includes('<'));
  if (subjects.length) meta.subjects = subjects;
  if (m.published) meta.published = clean(m.published);
  const exth = mobi.headers.exth;
  const identifiers: Record<string, string> = {};
  const isbn = typeof exth?.isbn === 'string' ? exth.isbn.replace(/[\s-]/g, '') : '';
  if (isbn) identifiers.isbn = isbn;
  if (typeof exth?.asin === 'string' && exth.asin) identifiers.asin = exth.asin;
  if (Object.keys(identifiers).length) meta.identifiers = identifiers;
  const ppd = exth?.pageProgressionDirection;
  if (ppd === 'rtl' || ppd === 'ltr') meta.direction = ppd;
  else if (/^(ar|he|fa|ur|yi)\b/i.test(lang)) meta.direction = 'rtl';
  return meta;
}

function flattenToc(items: MobiTocItem[] | undefined, level: number, out: { item: MobiTocItem; level: number }[] = []) {
  for (const it of items ?? []) {
    out.push({ item: it, level });
    flattenToc(it.subitems, level + 1, out);
  }
  return out;
}

// ───────────────────────── MOBI6 ─────────────────────────
const MOBI6_CSS = 'blockquote{margin-block-start:0;margin-block-end:0;margin-inline-start:1em;margin-inline-end:0}';

/** 去掉 <head>/<guide>（第 0 节才有）与 html/body 外壳：整个文件被切成片段后它们没有意义，还会把 <title> 文字混进正文 */
export function cleanMobi6(html: string): string {
  return html
    .replace(/<head\b[\s\S]*?<\/head>/i, '')
    .replace(/<guide\b[\s\S]*?<\/guide>/i, '')
    .replace(/<\/?(?:html|body)\b[^>]*>/gi, '');
}

function mobi6Flavor(book: Mobi6Book, mobi: MOBI, store: ResourceStore): Flavor {
  const sizes = book.sections.map((s) => s.size ?? 0);
  const ends: number[] = [];
  sizes.reduce((acc, n, i) => (ends[i] = acc + n), 0);
  const sectionOfPos = (n: number) => {
    const i = ends.findIndex((e) => e > n);
    return i < 0 ? Math.max(0, ends.length - 1) : i;
  };
  const res = (index: number) =>
    store.url(`r${index}`, async () => toBlob(await mobi.loadResource(index)));

  return {
    fragment: true,
    count: book.sections.length,
    linear: () => true,
    async raw(i) {
      const t = await book.sections[i].loadText?.();
      return t === undefined ? null : cleanMobi6(t);
    },
    async prepare(doc) {
      doc.querySelectorAll('img[recindex]').forEach((img) => {
        const n = Number(img.getAttribute('recindex'));
        img.removeAttribute('recindex');
        if (n > 0) img.setAttribute('src', `mobires/${n - 1}`);
      });
      doc.querySelectorAll('a[filepos]').forEach((a) => {
        const pos = (a.getAttribute('filepos') ?? '').trim();
        a.removeAttribute('filepos');
        if (/^\d+$/.test(pos)) a.setAttribute('href', `mobipos/${pos}`);
      });
      doc.querySelectorAll('a[name]').forEach((a) => {
        if (!a.getAttribute('id')) a.setAttribute('id', a.getAttribute('name')!);
      });
    },
    resolveResource: async (ref) => {
      const m = /^mobires\/(\d+)$/.exec(ref);
      return m ? res(Number(m[1])) : null;
    },
    extraStyles: [MOBI6_CSS],
    async toc() {
      const out: RawToc[] = [];
      for (const { item, level } of flattenToc(book.toc, 0)) {
        const m = /^filepos:(\d+)$/.exec(item.href);
        if (!m || !item.label) continue;
        out.push({ title: item.label, level, section: sectionOfPos(Number(m[1])), anchor: `filepos${m[1]}` });
      }
      return out;
    },
    resolveHref(href) {
      const m = /^mobipos\/(\d+)$/.exec(href);
      return m ? { section: sectionOfPos(Number(m[1])), anchor: `filepos${m[1]}` } : null;
    },
  };
}

// ───────────────────────── KF8 ─────────────────────────
const KINDLE_REF = /kindle:(flow|embed):(\w+)(?:\?mime=(\w+\/[-+.\w]+))?/g;
const KF8_RES = /^kf8res\/(embed|flow)\/(\w+)(?:\?mime=(.*))?$/;
const TABLEISH = new Set(['table', 'tbody', 'thead', 'tfoot', 'tr', 'colgroup']);

/** foliate 的片段选择器 [id|name|aid="值"] → 我们 DOM 里存在的 id（aid 在 prepare 里被改写成 id="aid-值"） */
function anchorOfSelector(selector?: string): string | undefined {
  const m = selector ? /^\[(id|name|aid)="((?:[^"\\]|\\.)*)"\]$/.exec(selector) : null;
  if (!m) return undefined;
  const value = m[2].replace(/\\(.)/g, '$1');
  return m[1] === 'aid' ? `aid-${value}` : value;
}

function kf8Flavor(book: Kf8Book, mobi: MOBI, store: ResourceStore): Flavor {
  const res = (index: number) => store.url(`r${index}`, async () => toBlob(await mobi.loadResource(index)));

  // SVG 当 <img> 加载时不能再引用外部（blob:）资源：里面的 kindle:embed 图片要内联成 data URI
  const flow = (id: number, mime?: string) =>
    store.url(`f${id}:${mime ?? ''}`, async () => {
      const raw = await book.loadFlow(id);
      if (!raw) return null;
      if (mime && /svg/.test(mime)) {
        const text = await replaceAsync(mobi.decode(raw), new RegExp(KINDLE_REF.source, 'g'), async (m) => {
          if (m[1] !== 'embed') return m[0];
          const data = new Uint8Array(await mobi.loadResource(parseInt(m[2], 32) - 1));
          return `data:${sniffImageMime(data) ?? 'image/jpeg'};base64,${toBase64(data)}`;
        });
        return new Blob([text], { type: 'image/svg+xml' });
      }
      return toBlob(raw, mime);
    });

  const resolveRef = (ref: string): Promise<string | null> => {
    const m = KF8_RES.exec(ref);
    if (!m) return Promise.resolve(null);
    const id = parseInt(m[2], 32);
    const mime = m[3] ? decodeURIComponent(m[3]) : undefined;
    return m[1] === 'embed' ? res(id - 1) : flow(id, mime);
  };

  const rewriteCss = (css: string) =>
    replaceAsync(css, new RegExp(KINDLE_REF.source, 'g'), async (m) => {
      const id = parseInt(m[2], 32);
      const url = m[1] === 'embed' ? await res(id - 1) : await flow(id, m[3]);
      return url ?? 'data:,';
    });

  const cssFlows = new Map<string, Promise<string | null>>();
  const loadStylesheet = (href: string) => {
    const m = KF8_RES.exec(href);
    if (!m || m[1] !== 'flow') return Promise.resolve(null);
    const id = parseInt(m[2], 32);
    let p = cssFlows.get(String(id));
    if (!p) {
      p = (async () => {
        const raw = await book.loadFlow(id);
        return raw ? rewriteCss(mobi.decode(raw)) : null;
      })().catch(() => null);
      cssFlows.set(String(id), p);
    }
    return p;
  };

  const linkTarget = async (href: string): Promise<string> => {
    const r = await book.resolveHref(href).catch(() => undefined);
    if (!r || r.index < 0) return '';
    return `kf8link/${r.index}/${encodeURIComponent(anchorOfSelector(r.selector) ?? '')}`;
  };

  return {
    fragment: false,
    count: book.sections.length,
    linear: (i) => book.sections[i].linear !== 'no',
    async raw(i) {
      const s = book.sections[i];
      return s.loadText ? s.loadText() : null;
    },
    async prepare(doc) {
      const jobs: Promise<void>[] = [];
      for (const el of Array.from(doc.getElementsByTagName('*'))) {
        for (const name of ['src', 'href', 'xlink:href', 'poster', 'data']) {
          const v = el.getAttribute(name);
          if (!v || !v.startsWith('kindle:')) continue;
          const em = /^kindle:(embed|flow):(\w+)(?:\?mime=(\S+))?$/.exec(v.trim());
          if (em) {
            el.setAttribute(name, `kf8res/${em[1]}/${em[2]}${em[3] ? `?mime=${encodeURIComponent(em[3])}` : ''}`);
          } else if (v.startsWith('kindle:pos:')) {
            jobs.push(
              linkTarget(v.trim()).then((target) => {
                if (target) el.setAttribute(name, target);
                else el.removeAttribute(name);
              }),
            );
          } else el.removeAttribute(name);
        }
        const aid = el.getAttribute('aid');
        if (aid && el.localName !== 'body') {
          const id = `aid-${aid}`;
          if (!el.getAttribute('id')) el.setAttribute('id', id);
          else if (!TABLEISH.has(el.localName) && el.parentNode) {
            const mark = doc.createElement('a');
            mark.setAttribute('id', id);
            el.parentNode.insertBefore(mark, el);
          }
        }
        if (el.localName === 'a' && !el.getAttribute('id') && el.getAttribute('name')) el.setAttribute('id', el.getAttribute('name')!);
      }
      await Promise.all(jobs);
    },
    resolveResource: resolveRef,
    loadStylesheet,
    rewriteCss,
    extraStyles: [],
    async toc() {
      const out: RawToc[] = [];
      for (const { item, level } of flattenToc(book.toc, 0)) {
        if (!item.label) continue;
        const r = await book.resolveHref(item.href).catch(() => undefined);
        if (!r || r.index < 0 || !book.sections[r.index]?.loadText) continue;
        out.push({ title: item.label, level, section: r.index, anchor: anchorOfSelector(r.selector) });
      }
      return out;
    },
    resolveHref(href) {
      const m = /^kf8link\/(\d+)\/(.*)$/.exec(href);
      if (!m) return null;
      const anchor = decodeURIComponent(m[2]);
      return { section: Number(m[1]), ...(anchor ? { anchor } : {}) };
    },
  };
}

// ───────────────────────── 装配 ─────────────────────────
function makeMobi(): MOBI {
  return new MOBI({ unzlib: (d) => unzlibSync(d) });
}

function mapOpenError(e: unknown): never {
  if (e instanceof BookOpenError) throw e;
  if (e instanceof Error && MOBI_ERR_UNSUPPORTED.test(e.message)) throw new UnsupportedFormatError(`不支持的 MOBI 类型：${e.message}`);
  throw corrupt(e);
}

export interface MobiBook extends ReflowableBook {
  format: 'mobi';
}

export async function openMobi(file: Blob, opts: OpenOptions): Promise<Book> {
  const head = new Uint8Array(await file.slice(60, 68).arrayBuffer());
  if (ascii(head, 0, 8) === 'TEXtREAd') return openPalmDoc(file, opts);
  const mobi = makeMobi();
  let raw: Mobi6Book | Kf8Book;
  try {
    const isKF8 = await mobi.openHeaders(file);
    if (mobi.encryption) throw new DrmError();
    raw = await (isKF8 ? new KF8(mobi) : new MOBI6(mobi)).init();
  } catch (e) {
    return mapOpenError(e);
  }
  const store = new ResourceStore();
  const flavor = mobi.isKF8 ? kf8Flavor(raw as Kf8Book, mobi, store) : mobi6Flavor(raw as Mobi6Book, mobi, store);
  const meta = metaOf(raw.metadata, mobi, opts.fileName);

  // 全部章节的纯文本长度（与 load() 同一套解析）；顺便在前两节里找 ISBN、给无目录书取标题
  const yieldUi = makeYielder(12);
  const charCounts: number[] = [];
  const heads: string[] = [];
  for (let i = 0; i < flavor.count; i++) {
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    let n = 0;
    let h = '';
    try {
      const html = await flavor.raw(i);
      if (html) {
        n = countHtmlChars(html, flavor.fragment);
        const hm = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html.slice(0, 20000));
        h = hm ? hm[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
        if (i < 2 && !meta.identifiers?.isbn) {
          const isbn = extractIsbn(html.replace(/<[^>]*>/g, ' '));
          if (isbn) meta.identifiers = { ...meta.identifiers, isbn };
        }
      }
    } catch {
      /* 坏章节：当空章 */
    }
    charCounts.push(n);
    heads.push(h);
    await yieldUi();
  }

  let rawToc: RawToc[] = [];
  try {
    rawToc = await flavor.toc();
  } catch {
    /* 目录损坏：退化为按章节 */
  }
  if (!rawToc.length) {
    rawToc = Array.from({ length: flavor.count }, (_, i) => i)
      .filter((i) => flavor.linear(i) && charCounts[i] > 0)
      .map((i) => ({ title: heads[i] || String(i + 1), level: 0, section: i }));
  }
  const toc: TocEntry[] = rawToc.map((t) => ({ title: t.title.length > 403 ? `${t.title.slice(0, 400)}...` : t.title, level: t.level, section: t.section, ...(t.anchor ? { anchor: t.anchor } : {}) }));
  const sectionTitle = new Map<number, string>();
  for (const t of toc) if (!t.anchor && !sectionTitle.has(t.section)) sectionTitle.set(t.section, t.title);
  for (const t of toc) if (!sectionTitle.has(t.section)) sectionTitle.set(t.section, t.title);

  const cache = new Lru<number, SectionContent>(4);
  const loadSection = async (i: number): Promise<SectionContent> => {
    const hit = cache.get(i);
    if (hit) return hit;
    let content: SectionContent;
    try {
      const html = await flavor.raw(i);
      content = html
        ? await buildSectionContent(
            html,
            {
              prepare: (doc) => flavor.prepare(doc),
              resolveResource: flavor.resolveResource,
              loadStylesheet: flavor.loadStylesheet,
              rewriteCss: flavor.rewriteCss,
              extraStyles: flavor.extraStyles,
              lang: meta.language,
              dir: meta.direction,
            },
            flavor.fragment,
          )
        : emptySection();
    } catch {
      content = emptySection();
    }
    cache.set(i, content);
    return content;
  };

  const sections: BookSection[] = Array.from({ length: flavor.count }, (_, i) => ({
    id: `m${i}`,
    title: sectionTitle.get(i),
    linear: flavor.linear(i),
    charCount: charCounts[i] ?? 0,
    load: () => loadSection(i),
  }));

  const resolveHref: ReflowableBook['resolveHref'] = (href, from) => {
    const h = href.trim();
    if (h.startsWith('#')) {
      let id = h.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* 保持原样 */
      }
      return id && from >= 0 && from < sections.length ? { section: from, anchor: id } : null;
    }
    return flavor.resolveHref(h);
  };

  const book: MobiBook = {
    kind: 'reflowable',
    format: 'mobi',
    metadata: meta,
    toc,
    sections,
    resolveHref,
    async getFootnote(href, from) {
      const r = resolveHref(href, from);
      return r?.anchor ? extractFootnote((await loadSection(r.section)).bodyHtml, r.anchor) : null;
    },
    getCover: () => coverOf(raw),
    destroy() {
      store.destroy();
      cache.clear();
      try {
        raw.destroy();
      } catch {
        /* 已释放 */
      }
    },
  };
  return book;
}

export async function probeMobi(file: Blob, opts: OpenOptions): Promise<BookProbe> {
  const head = new Uint8Array(await file.slice(60, 68).arrayBuffer());
  if (ascii(head, 0, 8) === 'TEXtREAd') {
    const fm = metaFromFileName(opts.fileName);
    return { format: 'mobi', metadata: { title: fm.title, authors: fm.authors }, cover: null, size: { chars: Math.round(file.size * 0.9) } };
  }
  const mobi = makeMobi();
  try {
    await mobi.openHeaders(file);
  } catch (e) {
    return mapOpenError(e);
  }
  // DRM 书照样入库（元数据与封面通常不加密），打开时才报 DRM
  const meta = metaOf(mobi.getMetadata(), mobi, opts.fileName);
  const { numTextRecords, recordSize } = mobi.headers.palmdoc;
  return { format: 'mobi', metadata: meta, cover: await coverOf(mobi), size: { chars: Math.round(numTextRecords * recordSize * 0.5) } };
}

// ───────────────────────── 纯 PalmDOC（TEXtREAd，.prc/.pdb） ─────────────────────────
export function decompressPalmDoc(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === 0 || (c >= 9 && c <= 0x7f)) out.push(c);
    else if (c <= 8) {
      for (let k = 0; k < c && i + 1 < src.length; k++) out.push(src[++i]);
    } else if (c <= 0xbf) {
      const pair = (c << 8) | (src[++i] ?? 0);
      const dist = (pair & 0x3fff) >> 3;
      const len = (pair & 7) + 3;
      if (dist === 0) continue;
      for (let k = 0; k < len; k++) out.push(out[out.length - dist] ?? 0);
    } else out.push(0x20, c ^ 0x80);
  }
  return Uint8Array.from(out);
}

async function openPalmDoc(file: Blob, opts: OpenOptions): Promise<Book> {
  const bytes = await readBytes(file);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const n = dv.getUint16(76, false);
    const offs = Array.from({ length: n }, (_, i) => dv.getUint32(78 + i * 8, false));
    const rec = (i: number) => bytes.subarray(offs[i], i + 1 < n ? offs[i + 1] : bytes.length);
    const r0 = rec(0);
    const compression = new DataView(r0.buffer, r0.byteOffset).getUint16(0, false);
    const encryption = new DataView(r0.buffer, r0.byteOffset).getUint16(12, false);
    const textRecords = new DataView(r0.buffer, r0.byteOffset).getUint16(8, false);
    if (encryption) throw new DrmError();
    if (compression !== 1 && compression !== 2) throw new UnsupportedFormatError('不支持的 PalmDOC 压缩方式');
    const parts: Uint8Array[] = [];
    for (let i = 1; i <= textRecords && i < n; i++) parts.push(compression === 2 ? decompressPalmDoc(rec(i)) : rec(i));
    const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
    const r = decodeAuto(all, opts.encoding);
    const text = r.text.replace(/\r\n?/g, '\n');
    return buildTxtBook(text, opts, { encoding: r.encoding, detected: r.detected }, { format: 'mobi' });
  } catch (e) {
    if (e instanceof BookOpenError) throw e;
    throw corrupt(e);
  }
}

export const mobiParser: FormatParser = {
  format: 'mobi',
  extensions: ['mobi', 'azw', 'azw3', 'prc'],
  sniff: (head) => head.length >= 68 && (ascii(head, 60, 8) === 'BOOKMOBI' || ascii(head, 60, 8) === 'TEXtREAd'),
  open: openMobi,
  probe: probeMobi,
};

