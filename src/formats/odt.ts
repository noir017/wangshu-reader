// ODT（FMT-015）：content.xml → HTML（标题、列表、表格、粗斜体下划线上下标、超链接、图片、脚注），meta.xml 取元数据，封面取 Thumbnails/thumbnail.png。
import type { Book, BookMetadata, BookProbe, FormatParser, OpenOptions } from '@/core/book';
import { UnsupportedFormatError, corrupt } from './errors';
import { buildFlowBook } from './lib/flow';
import { mimeOf } from './lib/mime';
import { ResourceStore } from './lib/resources';
import { buildSectionContent } from './lib/section';
import { countWords, escapeAttr, escapeHtml, metaFromFileName } from './lib/text';
import { attr, childElements, descendants, firstChild, firstDescendant, localName, parseXml, textOfEl } from './lib/xml';
import { openZip, type ZipArchive } from './lib/zip';
import { htmlSettings } from './settings';

interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
}

interface Converted {
  html: string;
  meta: BookMetadata;
  zip: ZipArchive;
  words: number;
}

async function convert(file: Blob, opts: OpenOptions): Promise<Converted> {
  let zip: ZipArchive;
  try {
    zip = await openZip(file);
  } catch (e) {
    throw corrupt(e);
  }
  if (!zip.has('content.xml')) throw new UnsupportedFormatError('不是有效的 ODT：缺少 content.xml');
  const doc = parseXml(await zip.markup('content.xml'));

  // 自动样式：名称 → 字符属性
  const styles = new Map<string, TextStyle>();
  const auto = firstDescendant(doc, 'automatic-styles');
  for (const st of auto ? childElements(auto, 'style') : []) {
    const name = attr(st, 'name');
    const tp = firstChild(st, 'text-properties');
    if (!name || !tp) continue;
    const pos = attr(tp, 'text-position') ?? '';
    styles.set(name, {
      bold: /bold|[6-9]00/.test(attr(tp, 'font-weight') ?? ''),
      italic: (attr(tp, 'font-style') ?? '') === 'italic',
      underline: !!attr(tp, 'text-underline-style') && attr(tp, 'text-underline-style') !== 'none',
      strike: !!attr(tp, 'text-line-through-style') && attr(tp, 'text-line-through-style') !== 'none',
      sup: /^super/.test(pos),
      sub: /^sub/.test(pos),
    });
  }
  const wrapStyle = (name: string | null, inner: string): string => {
    const s = name ? styles.get(name) : undefined;
    if (!s || !inner) return inner;
    let out = inner;
    if (s.bold) out = `<strong>${out}</strong>`;
    if (s.italic) out = `<em>${out}</em>`;
    if (s.underline) out = `<u>${out}</u>`;
    if (s.strike) out = `<s>${out}</s>`;
    if (s.sup) out = `<sup>${out}</sup>`;
    if (s.sub) out = `<sub>${out}</sub>`;
    return out;
  };

  const notes: { id: string; html: string }[] = [];
  const imgSrc = (href: string | null) => (href && !/^[a-z]+:/i.test(href) ? `odt-media/${encodeURIComponent(href)}` : null);

  const inline = (node: Element): string => {
    let s = '';
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === 3) {
        s += escapeHtml((c.nodeValue ?? '').replace(/\s+/g, ' '));
        continue;
      }
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      switch (localName(el)) {
        case 'span':
          s += wrapStyle(attr(el, 'style-name'), inline(el));
          break;
        case 's':
          s += ' '.repeat(Math.max(1, Number(attr(el, 'c') ?? 1)));
          break;
        case 'tab':
          s += ' ';
          break;
        case 'line-break':
          s += '<br>';
          break;
        case 'a': {
          const href = attr(el, 'href') ?? '';
          const inner = inline(el);
          if (href.startsWith('#')) s += `<a href="${escapeAttr(href)}">${inner}</a>`;
          else if (/^(https?|mailto):/i.test(href)) s += `<a href="${escapeAttr(href)}">${inner}</a>`;
          else s += inner;
          break;
        }
        case 'bookmark':
        case 'bookmark-start': {
          const name = attr(el, 'name');
          if (name) s += `<a id="${escapeAttr(name)}"></a>`;
          break;
        }
        case 'frame':
        case 'image': {
          const im = localName(el) === 'image' ? el : firstDescendant(el, 'image');
          const src = imgSrc(attr(im, 'href'));
          if (src) s += `<img src="${src}" alt="${escapeAttr(textOfEl(firstDescendant(el, 'title') ?? null))}">`;
          break;
        }
        case 'note': {
          const id = `odtn${notes.length + 1}`;
          const body = firstChild(el, 'note-body');
          notes.push({ id, html: body ? blocks(body) : '' });
          s += `<sup><a epub:type="noteref" id="r${id}" href="#${id}">${notes.length}</a></sup>`;
          break;
        }
        case 'soft-page-break':
        case 'note-citation':
        case 'note-body':
          break;
        default:
          s += inline(el);
      }
    }
    return s;
  };

  const list = (el: Element, ordered: boolean): string => {
    const items = childElements(el, 'list-item')
      .map((li) => `<li>${blocks(li)}</li>`)
      .join('');
    return `<${ordered ? 'ol' : 'ul'}>${items}</${ordered ? 'ol' : 'ul'}>`;
  };

  function blocks(container: Element): string {
    let out = '';
    for (const el of childElements(container)) {
      const n = localName(el);
      if (n === 'h') {
        const lv = Math.min(6, Math.max(1, Number(attr(el, 'outline-level') ?? 1)));
        const id = attr(el, 'id');
        out += `<h${lv}${id ? ` id="${escapeAttr(id)}"` : ''}>${inline(el)}</h${lv}>`;
      } else if (n === 'p') {
        const c = inline(el);
        out += c.replace(/<[^>]*>/g, '').trim() === '' && !c.includes('<img') ? '<p class="mr-blank"><br></p>' : `<p>${c}</p>`;
      } else if (n === 'list') out += list(el, false);
      else if (n === 'table') {
        const rows = descendants(el, 'table-row')
          .map((tr) => `<tr>${childElements(tr, 'table-cell').map((tc) => `<td${Number(attr(tc, 'number-columns-spanned') ?? 1) > 1 ? ` colspan="${Number(attr(tc, 'number-columns-spanned'))}"` : ''}>${blocks(tc)}</td>`).join('')}</tr>`)
          .join('');
        out += `<table>${rows}</table>`;
      } else if (n === 'section' || n === 'table-of-content' || n === 'index-body' || n === 'text' || n === 'index-title') out += blocks(el);
    }
    return out;
  }

  const text = firstDescendant(doc, 'text');
  if (!text) throw new UnsupportedFormatError('不是有效的 ODT：缺少正文');
  let html = blocks(text);
  if (notes.length) {
    const items = notes.map((n) => `<li epub:type="footnote" id="${n.id}">${n.html} <a epub:type="backlink" href="#r${n.id}">↩</a></li>`).join('');
    html += `<section epub:type="footnotes"><hr><ol>${items}</ol></section>`;
  }

  const fm = metaFromFileName(opts.fileName);
  const meta: BookMetadata = { title: fm.title, authors: fm.authors };
  if (zip.has('meta.xml')) {
    const m = parseXml(await zip.markup('meta.xml'));
    const t = textOfEl(firstDescendant(m, 'title'));
    const a = textOfEl(firstDescendant(m, 'creator')) || textOfEl(firstDescendant(m, 'initial-creator'));
    const d = textOfEl(firstDescendant(m, 'description'));
    const s = textOfEl(firstDescendant(m, 'subject'));
    const lang = textOfEl(firstDescendant(m, 'language'));
    if (t) meta.title = t;
    if (a) meta.authors = [a];
    if (d) meta.description = d;
    if (s) meta.subjects = [s];
    if (lang) meta.language = lang;
  }
  return { html, meta, zip, words: countWords(html.replace(/<[^>]*>/g, ' ')) };
}

const thumb = async (zip: ZipArchive) => (zip.has('Thumbnails/thumbnail.png') ? zip.blob('Thumbnails/thumbnail.png', 'image/png') : null);

export const odtParser: FormatParser = {
  format: 'odt',
  extensions: ['odt'],
  async open(file, opts): Promise<Book> {
    const c = await convert(file, opts);
    const store = new ResourceStore();
    const resolveResource = (ref: string) => {
      const m = /^odt-media\/(.+)$/.exec(ref);
      if (!m) return Promise.resolve(null);
      const path = decodeURIComponent(m[1]);
      return store.url(path, async () => (c.zip.has(path) ? c.zip.blob(path, mimeOf(path)) : null));
    };
    const content = await buildSectionContent(c.html, { resolveResource }, true);
    return buildFlowBook({ format: 'odt', metadata: c.meta, content, maxChars: htmlSettings.get().maxChapterChars, splitAtH1: true, getCover: () => thumb(c.zip), destroy: () => store.destroy() });
  },
  async probe(file, opts): Promise<BookProbe> {
    const c = await convert(file, opts);
    return { format: 'odt', metadata: c.meta, cover: await thumb(c.zip), size: { chars: c.words } };
  },
};
