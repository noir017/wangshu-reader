// EPUB 2/3 解析器（FMT-007/008/009/010、FMT-018 封面与元数据、FMT-022 ISBN）
// 流程：zip → container.xml → OPF（元数据/manifest/spine/guide）→ 目录（NCX 与 nav 取条数多者，缺失则按 spine）→ 章节
// 章节 load()：读 XHTML → 抽样式 → DOMPurify → 资源（图片/字体/CSS 里的 url）改写成 blob:，同一资源只建一次，destroy() 统一回收。
import type { Book, BookMetadata, BookProbe, BookSection, FormatParser, OpenOptions, ReflowableBook, SectionContent, TocEntry } from '@/core/book';
import { DrmError, corrupt, UnsupportedFormatError } from './errors';
import { rewriteCss } from './lib/css';
import { extractFootnote } from './lib/footnote';
import { ascii, isZip, makeYielder } from './lib/bytes';
import { extOf, IMAGE_EXTS, mimeOf, sniffImageMime } from './lib/mime';
import { Lru, ResourceStore } from './lib/resources';
import { buildSectionContent, countHtmlChars, parseHtmlDocument } from './lib/section';
import { sha1 } from './lib/sha1';
import { extractIsbn, htmlToPlain, metaFromFileName } from './lib/text';
import { attr, childElements, descendants, firstChild, firstDescendant, localName, parseXml, textOfEl } from './lib/xml';
import { dirname, joinPath, normalizePath, openZip, safeDecodeURI, type ZipArchive } from './lib/zip';

interface ManifestItem {
  id: string;
  path: string; // zip 内规整路径
  mediaType: string;
  properties: string[];
  fallback?: string;
}

interface SpineEntry {
  item: ManifestItem;
  linear: boolean;
  kind: 'doc' | 'image';
}

interface Pkg {
  zip: ZipArchive;
  opfPath: string;
  opfText: string;
  version: string;
  meta: BookMetadata;
  manifest: Map<string, ManifestItem>;
  byPath: Map<string, ManifestItem>;
  spine: SpineEntry[];
  ppd?: string;
  tocId?: string;
  guide: { type: string; href: string }[];
  coverMetaId?: string;
  uniqueId: string;
  obfuscated: Map<string, 'idpf' | 'adobe'>;
}

const DRM_FILES = ['rights.xml', 'signatures.xml', 'zhangyue-expansion.xml'];
const ALGO_IDPF = 'http://www.idpf.org/2008/embedding';
const ALGO_ADOBE = 'http://ns.adobe.com/pdf/enc';

const isDocType = (t: string, path: string) =>
  t === 'application/xhtml+xml' || t === 'text/html' || t === 'application/x-dtbook+xml' || t === 'image/svg+xml' || (!t.startsWith('image/') && /\.(x?html?|svg)$/i.test(path));

/** 读 META-INF/encryption.xml：DRM 判定 + 字体混淆表 */
async function readEncryption(zip: ZipArchive): Promise<Map<string, 'idpf' | 'adobe'>> {
  const obf = new Map<string, 'idpf' | 'adobe'>();
  const encPath = zip.resolve('META-INF/encryption.xml');
  if (!encPath) return obf;
  const hasDrmFile = DRM_FILES.some((f) => zip.has(`META-INF/${f}`));
  let strongDrm = false;
  try {
    const doc = parseXml(await zip.text(encPath));
    for (const ed of descendants(doc, 'encrypteddata')) {
      const algo = attr(firstDescendant(ed, 'encryptionmethod'), 'Algorithm') ?? '';
      const uri = attr(firstDescendant(ed, 'cipherreference'), 'URI');
      if (algo === ALGO_IDPF || algo === ALGO_ADOBE) {
        if (uri) obf.set(normalizePath(safeDecodeURI(uri)), algo === ALGO_IDPF ? 'idpf' : 'adobe');
      } else if (/aes|rsa|xmlenc/i.test(algo)) {
        strongDrm = true;
      }
    }
  } catch {
    /* encryption.xml 解析失败：只看 DRM 文件是否存在 */
  }
  if (hasDrmFile || strongDrm) throw new DrmError();
  return obf;
}

async function readPackage(zip: ZipArchive): Promise<Pkg> {
  const obfuscated = await readEncryption(zip);

  let opfPath: string | null = null;
  const cpath = zip.resolve('META-INF/container.xml');
  if (cpath) {
    const doc = parseXml(await zip.text(cpath));
    const rf = descendants(doc, 'rootfile').find((r) => /opf|oebps-package/i.test(`${attr(r, 'media-type') ?? ''}${attr(r, 'full-path') ?? ''}`)) ?? firstDescendant(doc, 'rootfile');
    const fp = attr(rf, 'full-path');
    if (fp) opfPath = zip.resolve(safeDecodeURI(fp));
  }
  opfPath ??= zip.names.find((n) => /\.opf$/i.test(n)) ?? null;
  if (!opfPath) throw new UnsupportedFormatError('不是有效的 EPUB：找不到 OPF 包文件');

  const opfText = await zip.markup(opfPath);
  const opf = parseXml(opfText);
  const pkgEl = opf.documentElement;
  const opfDir = dirname(opfPath);
  const version = attr(pkgEl, 'version') ?? '2.0';
  const uniqueIdRef = attr(pkgEl, 'unique-identifier') ?? '';

  // ── 元数据
  const mdEl = firstDescendant(opf, 'metadata');
  const mdKids = mdEl ? childElements(mdEl) : [];
  const dc = (name: string) => mdKids.filter((e) => localName(e) === name);
  const metas = mdKids.filter((e) => localName(e) === 'meta');

  const title = textOfEl(dc('title')[0]) || '';
  const authors = dc('creator').map(textOfEl).filter(Boolean);
  const identifiers: Record<string, string> = {};
  let uniqueId = '';
  for (const idEl of dc('identifier')) {
    const v = textOfEl(idEl);
    if (!v) continue;
    if (attr(idEl, 'id') === uniqueIdRef) uniqueId = idEl.textContent ?? v;
    const scheme = (attr(idEl, 'scheme') ?? '').toLowerCase();
    let key = scheme || 'id';
    let val = v;
    const m = /^urn:([a-z]+):(.+)$/i.exec(v);
    if (m) {
      key = m[1].toLowerCase();
      val = m[2];
    } else if (/^isbn[:\s]/i.test(v)) {
      key = 'isbn';
      val = v.replace(/^isbn[:\s]*/i, '');
    }
    if (!(key in identifiers)) identifiers[key] = val;
  }
  if (!uniqueId && dc('identifier')[0]) uniqueId = dc('identifier')[0].textContent ?? '';
  const isbn = identifiers.isbn ?? extractIsbn(opfText);
  if (isbn) identifiers.isbn = isbn.replace(/[\s-]/g, '');

  const meta: BookMetadata = { title, authors, identifiers };
  const lang = textOfEl(dc('language')[0]);
  if (lang) meta.language = lang;
  const pub = textOfEl(dc('publisher')[0]);
  if (pub) meta.publisher = pub;
  const desc = htmlToPlain(dc('description')[0]?.textContent ?? '');
  if (desc) meta.description = desc;
  const subjects = dc('subject').map(textOfEl).filter((s) => s && s.length < 50 && !s.includes('<'));
  if (subjects.length) meta.subjects = subjects;
  const date = textOfEl(dc('date')[0]);
  if (date) meta.published = date;

  // 系列：calibre 风格与 EPUB3 belongs-to-collection
  let coverMetaId: string | undefined;
  for (const m of metas) {
    const name = attr(m, 'name');
    const content = attr(m, 'content');
    if (name === 'calibre:series' && content) meta.series = content;
    else if (name === 'calibre:series_index' && content && !Number.isNaN(Number(content))) meta.seriesIndex = Number(content);
    else if (name === 'cover' && content) coverMetaId = content;
    else if (attr(m, 'property') === 'belongs-to-collection' && !meta.series) {
      const id = attr(m, 'id');
      const type = id ? metas.find((x) => attr(x, 'refines') === `#${id}` && attr(x, 'property') === 'collection-type') : undefined;
      if (!type || textOfEl(type) === 'series') {
        meta.series = textOfEl(m);
        const pos = id ? metas.find((x) => attr(x, 'refines') === `#${id}` && attr(x, 'property') === 'group-position') : undefined;
        if (pos && !Number.isNaN(Number(textOfEl(pos)))) meta.seriesIndex = Number(textOfEl(pos));
      }
    }
  }

  // ── manifest / spine / guide
  const manifest = new Map<string, ManifestItem>();
  const byPath = new Map<string, ManifestItem>();
  const manifestEl = firstDescendant(opf, 'manifest');
  for (const it of manifestEl ? childElements(manifestEl, 'item') : []) {
    const id = attr(it, 'id');
    const href = attr(it, 'href');
    if (!id || !href) continue;
    const path = normalizePath(joinPath(opfDir, safeDecodeURI(href.split('#')[0].split('?')[0])));
    const item: ManifestItem = {
      id,
      path,
      mediaType: (attr(it, 'media-type') ?? '').toLowerCase(),
      properties: (attr(it, 'properties') ?? '').split(/\s+/).filter(Boolean),
      fallback: attr(it, 'fallback') ?? undefined,
    };
    manifest.set(id, item);
    byPath.set(path, item);
  }

  const spineEl = firstDescendant(opf, 'spine');
  const spine: SpineEntry[] = [];
  for (const ir of spineEl ? childElements(spineEl, 'itemref') : []) {
    let item = manifest.get(attr(ir, 'idref') ?? '');
    // 非文档项（如 spine 里直接放 jpg）若有 fallback 文档就用 fallback
    for (let guard = 0; item && guard < 4 && !isDocType(item.mediaType, item.path) && !item.mediaType.startsWith('image/') && item.fallback; guard++) item = manifest.get(item.fallback);
    if (!item || !zip.has(item.path)) continue;
    const kind = item.mediaType.startsWith('image/') && !/svg/.test(item.mediaType) ? 'image' : isDocType(item.mediaType, item.path) ? 'doc' : null;
    if (!kind) continue;
    spine.push({ item, linear: (attr(ir, 'linear') ?? 'yes').toLowerCase() !== 'no', kind });
  }
  const guide: { type: string; href: string }[] = [];
  const guideEl = firstDescendant(opf, 'guide');
  for (const r of guideEl ? childElements(guideEl, 'reference') : []) {
    const type = (attr(r, 'type') ?? '').toLowerCase();
    const href = attr(r, 'href');
    if (href) guide.push({ type, href: normalizePath(joinPath(opfDir, safeDecodeURI(href.split('#')[0]))) });
  }
  const ppd = spineEl ? (attr(spineEl, 'page-progression-direction') ?? undefined) : undefined;
  if (ppd === 'rtl' || ppd === 'ltr') meta.direction = ppd;
  else if (/^(ar|he|fa|ur|yi)\b/i.test(meta.language ?? '')) meta.direction = 'rtl';

  return { zip, opfPath, opfText, version, meta, manifest, byPath, spine, ppd, tocId: spineEl ? (attr(spineEl, 'toc') ?? undefined) : undefined, guide, coverMetaId, uniqueId, obfuscated };
}

// ───────────────────────── 封面（FMT-007 优先级） ─────────────────────────
async function findCoverPath(p: Pkg): Promise<{ path: string; type: string } | null> {
  const { zip, manifest } = p;
  const asImage = (it: ManifestItem | undefined) => (it && it.mediaType.startsWith('image/') && zip.has(it.path) ? { path: it.path, type: it.mediaType } : null);
  const fromDoc = async (path: string): Promise<{ path: string; type: string } | null> => {
    try {
      const doc = parseHtmlDocument(await zip.markup(path));
      const el = doc.querySelector('img[src]') ?? doc.querySelector('image');
      const ref = el?.getAttribute('src') ?? el?.getAttribute('xlink:href') ?? el?.getAttribute('href');
      if (!ref) return null;
      const target = normalizePath(joinPath(dirname(path), safeDecodeURI(ref.split('#')[0])));
      const real = zip.resolve(target);
      return real ? { path: real, type: mimeOf(real) } : null;
    } catch {
      return null;
    }
  };
  const tryItem = async (it: ManifestItem | undefined) => {
    if (!it) return null;
    const img = asImage(it);
    if (img) return img;
    if (isDocType(it.mediaType, it.path) && zip.has(it.path)) return fromDoc(it.path);
    return null;
  };

  const all = [...manifest.values()];
  let r = await tryItem(all.find((i) => i.properties.includes('cover-image')));
  if (r) return r;
  for (const type of ['cover', 'coverimagestandard', 'other.ms-coverimage-standard']) {
    const g = p.guide.find((x) => x.type === type);
    if (g && zip.has(g.href)) {
      const it = p.byPath.get(g.href);
      r = it ? await tryItem(it) : isImageName(g.href) ? { path: g.href, type: mimeOf(g.href) } : await fromDoc(g.href);
      if (r) return r;
    }
  }
  if (p.coverMetaId && (r = await tryItem(manifest.get(p.coverMetaId)))) return r;
  const spineCover = p.spine.find((s) => ['coverpage', 'cover'].includes(s.item.id));
  if (spineCover && (r = await tryItem(spineCover.item))) return r;
  for (const id of ['coverpage', 'cover']) if ((r = await tryItem(manifest.get(id)))) return r;
  if (p.spine[0] && (r = await tryItem(p.spine[0].item))) return r;
  const guess = zip.names.find((n) => /(^|\/)cover[^/]*\.(jpe?g|png|gif|webp)$/i.test(n));
  return guess ? { path: guess, type: mimeOf(guess) } : null;
}

function isImageName(n: string): boolean {
  return IMAGE_EXTS.includes(extOf(n));
}

async function readCover(p: Pkg): Promise<Blob | null> {
  const c = await findCoverPath(p);
  if (!c) return null;
  try {
    const bytes = await p.zip.bytes(c.path);
    return new Blob([bytes as BlobPart], { type: c.type.startsWith('image/') ? c.type : (sniffImageMime(bytes) ?? mimeOf(c.path)) });
  } catch {
    return null;
  }
}

// ───────────────────────── 目录 ─────────────────────────
type RawToc = { title: string; level: number; section: number; anchor?: string };

export function titleFromHtml(raw: string): string {
  const head = raw.slice(0, 20000);
  const h = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(head);
  const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (h) {
    const t = strip(h[2]);
    if (t) return t;
  }
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  return t ? strip(t[1]) : '';
}

/** 书内 section 路径 → 下标 */
function makeSpineIndex(p: Pkg) {
  const exact = new Map<string, number>();
  const lower = new Map<string, number>();
  p.spine.forEach((s, i) => {
    if (!exact.has(s.item.path)) exact.set(s.item.path, i);
    if (!lower.has(s.item.path.toLowerCase())) lower.set(s.item.path.toLowerCase(), i);
  });
  return (path: string): number | undefined => exact.get(path) ?? lower.get(path.toLowerCase());
}

function resolveTocRef(src: string, baseDir: string, indexOf: (p: string) => number | undefined): { section: number; anchor?: string } | null {
  const [pathPart, ...frag] = src.split('#');
  const anchor = frag.length ? safeDecodeURI(frag.join('#')) : undefined;
  const clean = pathPart.split('?')[0];
  if (!clean) return null;
  const idx = indexOf(normalizePath(joinPath(baseDir, safeDecodeURI(clean))));
  return idx === undefined ? null : { section: idx, anchor: anchor || undefined };
}

async function parseNcx(p: Pkg, indexOf: (p: string) => number | undefined): Promise<RawToc[]> {
  let item = p.tocId ? p.manifest.get(p.tocId) : undefined;
  item ??= [...p.manifest.values()].find((i) => i.mediaType === 'application/x-dtbncx+xml') ?? [...p.manifest.values()].find((i) => /\.ncx$/i.test(i.path));
  if (!item || !p.zip.has(item.path)) return [];
  const doc = parseXml(await p.zip.markup(item.path));
  const navMap = firstDescendant(doc, 'navmap');
  if (!navMap) return [];
  const base = dirname(item.path);
  const out: RawToc[] = [];
  const walk = (el: Element, level: number) => {
    for (const np of childElements(el, 'navpoint')) {
      const title = textOfEl(firstChild(firstChild(np, 'navlabel') ?? np, 'text'));
      const src = attr(firstChild(np, 'content'), 'src');
      const target = src ? resolveTocRef(src, base, indexOf) : null;
      if (target && title) out.push({ title, level, ...target });
      walk(np, level + 1);
    }
  };
  walk(navMap, 0);
  return out;
}

async function parseNav(p: Pkg, indexOf: (p: string) => number | undefined): Promise<RawToc[]> {
  const item = [...p.manifest.values()].find((i) => i.properties.includes('nav'));
  if (!item || !p.zip.has(item.path)) return [];
  const doc = parseHtmlDocument(await p.zip.markup(item.path));
  const navs = Array.from(doc.querySelectorAll('nav'));
  const nav = navs.find((n) => /\btoc\b/.test(n.getAttribute('epub:type') ?? '')) ?? navs.find((n) => !n.getAttribute('epub:type')) ?? null;
  if (!nav) return [];
  const base = dirname(item.path);
  const out: RawToc[] = [];
  const walkList = (ol: Element, level: number) => {
    for (const li of childElements(ol, 'li')) {
      const a = childElements(li).find((c) => ['a', 'span'].includes(localName(c)));
      const sub = childElements(li, 'ol')[0];
      const title = textOfEl(a);
      const href = a && localName(a) === 'a' ? a.getAttribute('href') : null;
      let target = href ? resolveTocRef(href, base, indexOf) : null;
      if (!target && sub) {
        // 纯分组标题（无链接）：指向第一个子项
        const firstA = sub.querySelector('a[href]');
        const h = firstA?.getAttribute('href');
        target = h ? resolveTocRef(h, base, indexOf) : null;
      }
      if (target && title) out.push({ title, level, ...target });
      if (sub) walkList(sub, level + 1);
    }
  };
  const top = Array.from(nav.children).find((c) => localName(c) === 'ol');
  if (top) walkList(top, 0);
  return out;
}

/** 只有 ≤1 条目录时：在最大那一章的头 40000/尾 10000 字符里按 href="#id" 链接表生成目录（>3 条才采用） */
function synthesizeTocFromLinks(raw: string, section: number): RawToc[] {
  for (const chunk of [raw.slice(0, 40000), raw.slice(Math.max(0, raw.length - 10000))]) {
    const seen = new Set<string>();
    const found: RawToc[] = [];
    const re = /<a\b[^>]*\bhref\s*=\s*["']#([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (let m = re.exec(chunk); m; m = re.exec(chunk)) {
      const id = safeDecodeURI(m[1]);
      const title = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (!title || title.length > 100 || seen.has(id)) continue;
      const exists = new RegExp(`\\b(?:id|name)\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(raw);
      if (!exists) continue;
      seen.add(id);
      found.push({ title, level: 0, section, anchor: id });
    }
    if (found.length > 3) return found;
  }
  return [];
}

// ───────────────────────── 字体反混淆 ─────────────────────────
function deobfuscate(bytes: Uint8Array, kind: 'idpf' | 'adobe', uniqueId: string): Uint8Array {
  let key: Uint8Array;
  let n: number;
  if (kind === 'idpf') {
    key = sha1(new TextEncoder().encode(uniqueId.replace(/[ \t\r\n]/g, '')));
    n = 1040;
  } else {
    const hex = uniqueId.replace(/^urn:uuid:/i, '').replace(/-/g, '').trim();
    key = new Uint8Array(16);
    for (let i = 0; i < 16; i++) key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
    n = 1024;
  }
  const out = bytes.slice();
  for (let i = 0; i < Math.min(n, out.length); i++) out[i] ^= key[i % key.length];
  return out;
}

// ───────────────────────── 打开整本 ─────────────────────────
export interface EpubBook extends ReflowableBook {
  format: 'epub';
}

export async function openEpub(file: Blob, opts: OpenOptions): Promise<EpubBook> {
  let zip: ZipArchive;
  try {
    zip = await openZip(file);
  } catch (e) {
    throw corrupt(e);
  }
  const p = await readPackage(zip);
  const fileMeta = metaFromFileName(opts.fileName);
  if (!p.meta.title) p.meta.title = fileMeta.title;
  if (!p.meta.authors.length) p.meta.authors = fileMeta.authors;

  const indexOf = makeSpineIndex(p);
  const store = new ResourceStore();
  const sectionCache = new Lru<number, SectionContent>(4);
  const mediaTypeOf = (path: string) => p.byPath.get(path)?.mediaType || mimeOf(path);

  const fileUrl = (zipPath: string): Promise<string | null> => {
    const real = zip.resolve(zipPath);
    if (!real) return Promise.resolve(null);
    return store.url(real, async () => {
      let bytes = await zip.bytes(real);
      const ob = p.obfuscated.get(real);
      if (ob) bytes = deobfuscate(bytes, ob, p.uniqueId);
      let type = mediaTypeOf(real);
      if (type === 'application/octet-stream') type = sniffImageMime(bytes) ?? type;
      return new Blob([bytes as BlobPart], { type });
    });
  };

  const refToPath = (baseDir: string, ref: string): string | null => {
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) return null;
    return normalizePath(joinPath(baseDir, safeDecodeURI(clean)));
  };

  const cssCache = new Map<string, Promise<string | null>>();
  const loadCss = (path: string, depth: number): Promise<string | null> => {
    const real = zip.resolve(path);
    if (!real) return Promise.resolve(null);
    let c = cssCache.get(real);
    if (!c) {
      c = (async () => {
        const text = await zip.markup(real);
        return rewriteCss(text, cssEnv(dirname(real), depth), depth);
      })().catch(() => null);
      cssCache.set(real, c);
    }
    return c;
  };
  const cssEnv = (baseDir: string, _depth = 0) => ({
    resolveUrl: (ref: string) => {
      const path = refToPath(baseDir, ref);
      return path ? fileUrl(path) : Promise.resolve(null);
    },
    importCss: (ref: string, d: number) => {
      const path = refToPath(baseDir, ref);
      return path ? loadCss(path, d) : Promise.resolve(null);
    },
  });

  const sectionsMeta = p.spine.map((s) => ({ ...s, dir: dirname(s.item.path) }));

  // 章节纯文本长度 + 无目录时的标题来源：读一遍全部文档（与 load() 同一套解析，保证偏移基准一致）
  const yieldUi = makeYielder(12);
  const charCounts: number[] = [];
  const heads: string[] = [];
  for (const s of p.spine) {
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (s.kind === 'image') {
      charCounts.push(0);
      heads.push('');
      continue;
    }
    try {
      const raw = await zip.markup(s.item.path);
      charCounts.push(countHtmlChars(raw));
      heads.push(titleFromHtml(raw));
    } catch {
      charCounts.push(0);
      heads.push('');
    }
    await yieldUi();
  }

  // 目录：NCX 与 nav 取条数多者（相等取 nav）；都没有则 spine 顺序
  const [ncx, nav] = await Promise.all([parseNcx(p, indexOf).catch(() => []), parseNav(p, indexOf).catch(() => [])]);
  let rawToc = nav.length >= ncx.length ? nav : ncx;
  if (rawToc.length <= 1 && p.spine.length) {
    // 单文件电子书：从行内链接表合成目录
    let big = 0;
    charCounts.forEach((c, i) => {
      if (c > charCounts[big]) big = i;
    });
    if (p.spine[big]?.kind === 'doc') {
      try {
        const synth = synthesizeTocFromLinks(await zip.markup(p.spine[big].item.path), big);
        if (synth.length > rawToc.length) rawToc = synth;
      } catch {
        /* ignore */
      }
    }
  }
  if (!rawToc.length) {
    rawToc = p.spine.flatMap((s, i) => (s.linear ? [{ title: heads[i] || String(i + 1), level: 0, section: i }] : []));
  }
  const toc: TocEntry[] = rawToc.map((t) => ({ title: t.title.length > 403 ? `${t.title.slice(0, 400)}...` : t.title, level: t.level, section: t.section, ...(t.anchor ? { anchor: t.anchor } : {}) }));

  const sectionTitle = new Map<number, string>();
  for (const t of toc) if (!t.anchor && !sectionTitle.has(t.section)) sectionTitle.set(t.section, t.title);
  for (const t of toc) if (!sectionTitle.has(t.section)) sectionTitle.set(t.section, t.title);

  const env = (i: number) => {
    const s = sectionsMeta[i];
    return {
      resolveResource: (ref: string) => {
        const path = refToPath(s.dir, ref);
        return path ? fileUrl(path) : Promise.resolve(null);
      },
      loadStylesheet: (href: string) => {
        const path = refToPath(s.dir, href);
        return path ? loadCss(path, 0) : Promise.resolve(null);
      },
      rewriteCss: (css: string) => rewriteCss(css, cssEnv(s.dir)),
      lang: p.meta.language,
      dir: p.meta.direction,
    };
  };

  const loadSection = async (i: number): Promise<SectionContent> => {
    const hit = sectionCache.get(i);
    if (hit) return hit;
    const s = sectionsMeta[i];
    let content: SectionContent;
    try {
      if (s.kind === 'image') {
        const name = s.item.path.split('/').pop() ?? '';
        content = await buildSectionContent(`<div class="mr-image-page"><img src="${encodeURI(name)}" alt=""></div>`, env(i), true);
        const url = await fileUrl(s.item.path);
        if (url) content.bodyHtml = content.bodyHtml.replace(/src="[^"]*"/, `src="${url}"`);
      } else {
        content = await buildSectionContent(await zip.markup(s.item.path), env(i));
      }
    } catch {
      content = { bodyHtml: '', styles: [] };
    }
    sectionCache.set(i, content);
    return content;
  };

  const sections: BookSection[] = p.spine.map((s, i) => ({
    id: s.item.id,
    title: sectionTitle.get(i),
    linear: s.linear,
    charCount: charCounts[i] ?? 0,
    load: () => loadSection(i),
  }));

  const resolveHref: ReflowableBook['resolveHref'] = (href, from) => {
    const h = href.trim();
    if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
    const [pathPart, ...frag] = h.split('#');
    const anchor = frag.length ? safeDecodeURI(frag.join('#')) || undefined : undefined;
    if (!pathPart) return from >= 0 && from < sections.length ? { section: from, anchor } : null;
    const base = sectionsMeta[from]?.dir ?? '';
    const path = refToPath(base, pathPart);
    const idx = path ? indexOf(path) : undefined;
    return idx === undefined ? null : { section: idx, anchor };
  };

  const getFootnote: NonNullable<ReflowableBook['getFootnote']> = async (href, from) => {
    const r = resolveHref(href, from);
    if (!r || !r.anchor) return null;
    return extractFootnote((await loadSection(r.section)).bodyHtml, r.anchor);
  };

  let coverPromise: Promise<Blob | null> | undefined;

  return {
    kind: 'reflowable',
    format: 'epub',
    metadata: p.meta,
    toc,
    sections,
    resolveHref,
    getFootnote,
    getCover: () => (coverPromise ??= readCover(p)),
    destroy() {
      store.destroy();
      sectionCache.clear();
      cssCache.clear();
    },
  };
}

/** 导入探测：元数据 + 封面 + 粗估字数（按 spine 文档解压后体积 × 0.45，不解析正文） */
export async function probeEpub(file: Blob, opts: OpenOptions): Promise<BookProbe> {
  let zip: ZipArchive;
  try {
    zip = await openZip(file);
  } catch (e) {
    throw corrupt(e);
  }
  const p = await readPackage(zip);
  const fileMeta = metaFromFileName(opts.fileName);
  if (!p.meta.title) p.meta.title = fileMeta.title;
  if (!p.meta.authors.length) p.meta.authors = fileMeta.authors;
  const bytes = p.spine.filter((s) => s.kind === 'doc').reduce((n, s) => n + zip.size(s.item.path), 0);
  return { format: 'epub', metadata: p.meta, cover: await readCover(p), size: { chars: Math.round(bytes * 0.45) } };
}

export const epubParser: FormatParser = {
  format: 'epub',
  extensions: ['epub', 'epub3'],
  sniff(head) {
    return isZip(head) && ascii(head, 30, 8) === 'mimetype' && ascii(head, 38, 20).startsWith('application/epub');
  },
  open: (file, opts): Promise<Book> => openEpub(file, opts),
  probe: probeEpub,
};

