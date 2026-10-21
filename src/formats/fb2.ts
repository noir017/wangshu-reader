// FB2 / FB2.ZIP（FMT-012）：XML → 自己的 HTML 转换 + 自己的样式（不使用 apk 里的 fb2.css）。
// 章节 = 嵌套 <section> 树（每节一个 BookSection，父节自身的标题/题词/简介单独成段），<body name="notes"> 转成末尾「脚注」章并供 getFootnote 使用。
import type { Book, BookMetadata, BookProbe, BookSection, FormatParser, OpenOptions, ReflowableBook, SectionContent, TocEntry } from '@/core/book';
import { textSettings } from '@/reader/settings';
import { decodeMarkup } from './encoding';
import { UnsupportedFormatError, corrupt, fmtMsg } from './errors';
import { fromBase64, isZip, readBytes } from './lib/bytes';
import { extractFootnote } from './lib/footnote';
import { sniffImageMime } from './lib/mime';
import { ResourceStore } from './lib/resources';
import { buildSectionContent, countHtmlChars } from './lib/section';
import { countWords, escapeAttr, escapeHtml, metaFromFileName } from './lib/text';
import { attr, childElements, descendants, firstChild, firstDescendant, localName, parseXml, textOfEl } from './lib/xml';
import { openZip } from './lib/zip';

/** 默认样式：只用 fb2-* 类名，不碰 p/body 等基础元素，用户的排版设置不受影响 */
export const FB2_CSS = `
.fb2-title{text-align:center;font-weight:bold}
.fb2-subtitle{text-align:center;font-weight:bold;text-indent:0}
.fb2-epigraph{margin:1em 0 1em 25%;font-style:italic}
.fb2-author{text-align:right;font-style:italic;text-indent:0}
.fb2-annotation{margin:1em 0 1em 2em;font-size:.95em}
.fb2-cite{margin:1em 0 1em 2em}
.fb2-poem{margin:1em 0 1em 2em}
.fb2-stanza{margin:.8em 0}
.fb2-v{margin:0;text-indent:0}
.fb2-empty{margin:0;text-indent:0;min-height:1em}
.fb2-image{text-align:center;text-indent:0}
.fb2-image img,img.fb2-inline{max-width:100%}
a.fb2-note{vertical-align:super;font-size:.75em;text-decoration:none}
.fb2-notes-item{margin:.6em 0}
table.fb2-table{border-collapse:collapse}
table.fb2-table td,table.fb2-table th{border:1px solid;padding:.2em .5em}
`;

interface Binary {
  type: string;
  b64: string;
}

interface Built {
  meta: BookMetadata;
  coverId?: string;
  binaries: Map<string, Binary>;
  sections: { id: string; title?: string; html: string }[];
  toc: { title: string; level: number; section: number; anchor?: string }[];
  idToSection: Map<string, number>;
  notes: Map<string, string>;
}

function personName(el: Element): string {
  const parts = ['first-name', 'middle-name', 'last-name'].map((n) => textOfEl(firstChild(el, n))).filter(Boolean);
  return parts.length ? parts.join(' ') : textOfEl(firstChild(el, 'nickname'));
}

export async function readFb2Xml(file: Blob, opts: OpenOptions): Promise<string> {
  let bytes = await readBytes(file);
  // fb2.zip，或扩展名是 .fb2 却是 zip：取里面第一个 .fb2（再不行取嵌套的 .fb2.zip）
  for (let depth = 0; depth < 3 && isZip(bytes); depth++) {
    const zip = await openZip(bytes);
    const inner = zip.names.find((n) => /\.fb2$/i.test(n)) ?? zip.names.find((n) => /\.zip$/i.test(n));
    if (!inner) throw new UnsupportedFormatError(fmtMsg('emptyArchive'));
    bytes = await zip.bytes(inner);
  }
  const hint = opts.encoding ?? textSettings.get().textEncode;
  return decodeMarkup(bytes, hint && hint !== 'auto' ? hint : undefined).text;
}

function build(xml: string, opts: OpenOptions): Built {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (!root || !/fictionbook/i.test(root.localName || root.tagName)) {
    if (!firstDescendant(doc, 'fictionbook')) throw new UnsupportedFormatError();
  }
  const desc = firstDescendant(doc, 'description');
  const ti = desc ? firstChild(desc, 'title-info') : null;
  const pi = desc ? firstChild(desc, 'publish-info') : null;
  const fm = metaFromFileName(opts.fileName);
  const meta: BookMetadata = {
    title: textOfEl(ti && firstChild(ti, 'book-title')) || fm.title,
    authors: ti ? childElements(ti, 'author').map(personName).filter(Boolean) : [],
  };
  if (!meta.authors.length) meta.authors = fm.authors;
  if (ti) {
    const lang = textOfEl(firstChild(ti, 'lang'));
    if (lang) meta.language = lang;
    const ann = firstChild(ti, 'annotation');
    if (ann) {
      const text = childElements(ann).map((p) => textOfEl(p)).filter(Boolean).join('\n');
      if (text) meta.description = text;
    }
    const genres = childElements(ti, 'genre').map(textOfEl).filter(Boolean);
    if (genres.length) meta.subjects = genres;
    const seq = firstChild(ti, 'sequence');
    if (seq) {
      const name = attr(seq, 'name');
      if (name) meta.series = name;
      const num = Number(attr(seq, 'number'));
      if (!Number.isNaN(num) && attr(seq, 'number')) meta.seriesIndex = num;
    }
    const date = firstChild(ti, 'date');
    if (date) meta.published = attr(date, 'value') ?? textOfEl(date);
  }
  if (pi) {
    const publisher = textOfEl(firstChild(pi, 'publisher'));
    if (publisher) meta.publisher = publisher;
    const isbn = textOfEl(firstChild(pi, 'isbn')).replace(/[\s-]/g, '');
    if (isbn) meta.identifiers = { isbn };
    if (!meta.published) {
      const y = textOfEl(firstChild(pi, 'year'));
      if (y) meta.published = y;
    }
  }
  const coverRef = ti ? attr(firstDescendant(firstChild(ti, 'coverpage') ?? ti, 'image'), 'href') : null;
  const coverId = coverRef?.replace(/^#/, '') || undefined;

  const binaries = new Map<string, Binary>();
  for (const b of descendants(doc, 'binary')) {
    const id = attr(b, 'id');
    if (id) binaries.set(id, { type: attr(b, 'content-type') ?? '', b64: b.textContent ?? '' });
  }

  const out: Built = { meta, coverId, binaries, sections: [], toc: [], idToSection: new Map(), notes: new Map() };

  // ── 内联
  const inline = (node: Node): string => {
    let s = '';
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === 3) {
        s += escapeHtml((c.nodeValue ?? '').replace(/\s+/g, ' '));
        continue;
      }
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      switch (localName(el)) {
        case 'strong':
          s += `<strong>${inline(el)}</strong>`;
          break;
        case 'emphasis':
          s += `<em>${inline(el)}</em>`;
          break;
        case 'strikethrough':
          s += `<s>${inline(el)}</s>`;
          break;
        case 'sub':
          s += `<sub>${inline(el)}</sub>`;
          break;
        case 'sup':
          s += `<sup>${inline(el)}</sup>`;
          break;
        case 'code':
          s += `<code>${inline(el)}</code>`;
          break;
        case 'style':
          s += `<span class="fb2-style-${escapeAttr(attr(el, 'name') ?? '')}">${inline(el)}</span>`;
          break;
        case 'a': {
          const href = attr(el, 'href') ?? '';
          if (href.startsWith('#')) {
            const isNote = (attr(el, 'type') ?? '') === 'note';
            s += `<a href="${escapeAttr(href)}"${isNote ? ' epub:type="noteref" class="fb2-note"' : ''}>${inline(el)}</a>`;
          } else if (/^(https?|mailto):/i.test(href)) s += `<a href="${escapeAttr(href)}">${inline(el)}</a>`;
          else s += inline(el);
          break;
        }
        case 'image': {
          const id = (attr(el, 'href') ?? '').replace(/^#/, '');
          if (id) s += `<img class="fb2-inline" src="fb2img/${encodeURIComponent(id)}" alt="">`;
          break;
        }
        default:
          s += inline(el);
      }
    }
    return s;
  };

  // ── 块级
  const block = (el: Element, depth: number): string => {
    const name = localName(el);
    const idAttr = attr(el, 'id');
    const id = idAttr ? ` id="${escapeAttr(idAttr)}"` : '';
    switch (name) {
      case 'p':
        return `<p${id}>${inline(el)}</p>`;
      case 'empty-line':
        return '<p class="fb2-empty"><br></p>';
      case 'subtitle':
        return `<p class="fb2-subtitle"${id}>${inline(el)}</p>`;
      case 'text-author':
        return `<p class="fb2-author">${inline(el)}</p>`;
      case 'date':
        return `<p class="fb2-author">${inline(el)}</p>`;
      case 'v':
        return `<p class="fb2-v"${id}>${inline(el)}</p>`;
      case 'title': {
        const lines = childElements(el).map((c) => (localName(c) === 'p' ? inline(c) : localName(c) === 'empty-line' ? '' : '')).filter(Boolean);
        const h = Math.min(6, Math.max(1, depth + 1));
        return `<h${h} class="fb2-title"${id}>${lines.join('<br>') || inline(el)}</h${h}>`;
      }
      case 'epigraph':
        return `<blockquote class="fb2-epigraph"${id}>${childElements(el).map((c) => block(c, depth)).join('')}</blockquote>`;
      case 'annotation':
        return `<div class="fb2-annotation"${id}>${childElements(el).map((c) => block(c, depth)).join('')}</div>`;
      case 'cite':
        return `<blockquote class="fb2-cite"${id}>${childElements(el).map((c) => block(c, depth)).join('')}</blockquote>`;
      case 'poem':
        return `<div class="fb2-poem"${id}>${childElements(el).map((c) => block(c, depth)).join('')}</div>`;
      case 'stanza':
        return `<div class="fb2-stanza">${childElements(el).map((c) => block(c, depth)).join('')}</div>`;
      case 'image': {
        const ref = (attr(el, 'href') ?? '').replace(/^#/, '');
        return ref ? `<div class="fb2-image"${id}><img src="fb2img/${encodeURIComponent(ref)}" alt="${escapeAttr(attr(el, 'alt') ?? '')}"></div>` : '';
      }
      case 'table': {
        const rows = childElements(el, 'tr')
          .map((tr) => `<tr>${childElements(tr).map((c) => `<${localName(c) === 'th' ? 'th' : 'td'}${attr(c, 'colspan') ? ` colspan="${escapeAttr(attr(c, 'colspan')!)}"` : ''}${attr(c, 'rowspan') ? ` rowspan="${escapeAttr(attr(c, 'rowspan')!)}"` : ''}>${inline(c)}</${localName(c) === 'th' ? 'th' : 'td'}>`).join('')}</tr>`)
          .join('');
        return `<table class="fb2-table"${id}>${rows}</table>`;
      }
      case 'section':
        return '';
      default:
        return '';
    }
  };

  const bodies = descendants(doc, 'body').filter((b) => b.parentElement === root || localName(b.parentElement!) === 'fictionbook');
  const noteBodies = bodies.filter((b, i) => /^(notes|footnotes|comments)$/i.test(attr(b, 'name') ?? '') || (i > 0 && /note/i.test(attr(b, 'name') ?? '')));
  const isNoteBody = (b: Element) => noteBodies.includes(b);

  const addSection = (title: string | undefined, html: string, level: number, tocTitle: string | undefined, anchor?: string) => {
    if (!html.trim()) return;
    const idx = out.sections.length;
    out.sections.push({ id: `s${idx + 1}`, title, html });
    if (tocTitle) out.toc.push({ title: tocTitle.length > 403 ? `${tocTitle.slice(0, 400)}...` : tocTitle, level, section: idx, ...(anchor ? { anchor } : {}) });
  };

  const titleText = (el: Element | null) => (el ? childElements(el).map((p) => textOfEl(p)).filter(Boolean).join(' ') || textOfEl(el) : '');

  const walkSection = (sec: Element, depth: number) => {
    const secId = attr(sec, 'id');
    const kids = childElements(sec);
    const own: string[] = [];
    const subs: Element[] = [];
    let title: Element | null = null;
    for (const k of kids) {
      const n = localName(k);
      if (n === 'section') subs.push(k);
      else {
        if (n === 'title' && !title) title = k;
        own.push(block(k, depth));
      }
    }
    const tt = titleText(title);
    const wrapper = `<div class="fb2-section"${secId ? ` id="${escapeAttr(secId)}"` : ''}>${own.join('')}</div>`;
    addSection(tt || undefined, wrapper, depth, tt || undefined, secId ?? undefined);
    for (const s of subs) walkSection(s, depth + 1);
  };

  bodies.forEach((body, bi) => {
    if (isNoteBody(body)) return;
    const kids = childElements(body);
    const pre = kids.filter((k) => localName(k) !== 'section');
    if (pre.length) {
      const t = pre.find((k) => localName(k) === 'title') ?? null;
      const tt = titleText(t);
      addSection(tt || (bi === 0 ? meta.title : undefined), pre.map((k) => block(k, 0)).join(''), 0, tt || undefined);
    }
    for (const k of kids) if (localName(k) === 'section') walkSection(k, 0);
  });

  // 脚注：note body 里每个 section 一条
  const noteItems: string[] = [];
  for (const nb of noteBodies) {
    for (const sec of descendants(nb, 'section')) {
      const id = attr(sec, 'id');
      if (!id) continue;
      const kids = childElements(sec);
      const titleEl = kids.find((k) => localName(k) === 'title') ?? null;
      const body = kids.filter((k) => localName(k) !== 'title' && localName(k) !== 'section').map((k) => block(k, 1)).join('');
      const label = titleText(titleEl);
      const html = `${label ? `<p><strong>${escapeHtml(label)}</strong></p>` : ''}${body}`;
      out.notes.set(id, html);
      noteItems.push(`<div class="fb2-notes-item" epub:type="footnote" id="${escapeAttr(id)}">${html}</div>`);
    }
  }
  if (noteItems.length) {
    const title = fmtMsg('footnotes');
    addSection(title, `<h1 class="fb2-title">${escapeHtml(title)}</h1>${noteItems.join('')}`, 0, title);
  }
  if (!out.sections.length) out.sections.push({ id: 's1', html: '' });

  // 锚点 → 章节
  out.sections.forEach((s, i) => {
    for (const m of s.html.matchAll(/\sid="([^"]+)"/g)) {
      const id = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      if (!out.idToSection.has(id)) out.idToSection.set(id, i);
    }
  });
  return out;
}

export interface Fb2Book extends ReflowableBook {
  format: 'fb2';
}

async function binaryBlob(b: Binary | undefined): Promise<Blob | null> {
  if (!b) return null;
  const bytes = fromBase64(b.b64);
  return new Blob([bytes as BlobPart], { type: b.type.startsWith('image/') ? b.type : (sniffImageMime(bytes) ?? 'application/octet-stream') });
}

export async function openFb2(file: Blob, opts: OpenOptions): Promise<Fb2Book> {
  let built: Built;
  try {
    built = build(await readFb2Xml(file, opts), opts);
  } catch (e) {
    if (e instanceof UnsupportedFormatError) throw e;
    throw corrupt(e);
  }
  const store = new ResourceStore();
  const resolveResource = (ref: string) => {
    const m = /^fb2img\/(.+)$/.exec(ref);
    if (!m) return Promise.resolve(null);
    const id = decodeURIComponent(m[1]);
    return store.url(`b:${id}`, () => binaryBlob(built.binaries.get(id)));
  };

  const sections: BookSection[] = built.sections.map((s, i) => ({
    id: s.id,
    title: s.title,
    linear: true,
    charCount: s.html ? countHtmlChars(s.html, true) : 0,
    load: async (): Promise<SectionContent> => (s.html ? buildSectionContent(s.html, { resolveResource, extraStyles: [FB2_CSS], lang: built.meta.language }, true) : { bodyHtml: '', styles: [FB2_CSS] }),
  }));

  const toc: TocEntry[] = built.toc;
  const resolveHref: ReflowableBook['resolveHref'] = (href) => {
    if (!href.startsWith('#')) return null;
    const id = href.slice(1);
    const s = built.idToSection.get(id);
    return s === undefined ? null : { section: s, anchor: id };
  };

  return {
    kind: 'reflowable',
    format: 'fb2',
    metadata: built.meta,
    toc,
    sections,
    resolveHref,
    async getFootnote(href) {
      if (!href.startsWith('#')) return null;
      const id = href.slice(1);
      const note = built.notes.get(id);
      if (note) return note;
      const s = built.idToSection.get(id);
      return s === undefined ? null : extractFootnote(built.sections[s].html, id);
    },
    getCover: async () => (built.coverId ? binaryBlob(built.binaries.get(built.coverId)) : null),
    destroy() {
      store.destroy();
    },
  };
}

export async function probeFb2(file: Blob, opts: OpenOptions): Promise<BookProbe> {
  let built: Built;
  try {
    built = build(await readFb2Xml(file, opts), opts);
  } catch (e) {
    if (e instanceof UnsupportedFormatError) throw e;
    throw corrupt(e);
  }
  const chars = countWords(built.sections.map((s) => s.html.replace(/<[^>]*>/g, ' ')).join(' '));
  return { format: 'fb2', metadata: built.meta, cover: built.coverId ? await binaryBlob(built.binaries.get(built.coverId)) : null, size: { chars } };
}

export const fb2Parser: FormatParser = {
  format: 'fb2',
  extensions: ['fb2', 'fb2.zip'],
  sniff(head) {
    return new TextDecoder('latin1').decode(head.subarray(0, 1024)).includes('<FictionBook');
  },
  open: (file, opts): Promise<Book> => openFb2(file, opts),
  probe: probeFb2,
};
