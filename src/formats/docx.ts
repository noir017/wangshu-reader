// DOCX（FMT-015）：自己把 word/document.xml 转成语义 HTML（标题、列表、表格、粗斜体下划线、超链接、图片、脚注），
// 再交给 flow 按 Heading 1 与大小切章。原 app 的实现很粗糙（字符串替换），这里做成了真正的转换。
import type { Book, BookMetadata, BookProbe, FormatParser, OpenOptions } from '@/core/book';
import { UnsupportedFormatError, corrupt } from './errors';
import { buildFlowBook } from './lib/flow';
import { mimeOf } from './lib/mime';
import { ResourceStore } from './lib/resources';
import { buildSectionContent } from './lib/section';
import { countWords, escapeAttr, escapeHtml, metaFromFileName } from './lib/text';
import { attr, childElements, descendants, firstChild, firstDescendant, localName, parseXml, textOfEl } from './lib/xml';
import { joinPath, openZip, type ZipArchive } from './lib/zip';
import { htmlSettings } from './settings';

const val = (el: Element | null | undefined) => attr(el, 'val');
const isOn = (el: Element | null | undefined) => !!el && !['0', 'false', 'off', 'none'].includes((val(el) ?? 'true').toLowerCase());

interface Styles {
  headingLevel: Map<string, number>;
}

function parseStyles(doc: Document | null): Styles {
  const headingLevel = new Map<string, number>();
  if (doc) {
    for (const st of descendants(doc, 'style')) {
      const id = attr(st, 'styleId');
      if (!id) continue;
      const name = (val(firstChild(st, 'name')) ?? '').toLowerCase();
      let m = /^heading\s*(\d)$/.exec(name) ?? /^(title)$/.exec(name);
      let level = 0;
      if (m) level = m[1] === 'title' ? 1 : Number(m[1]);
      else {
        const ol = firstDescendant(firstChild(st, 'ppr') ?? st, 'outlinelvl');
        if (ol && val(ol) !== null && Number(val(ol)) < 9) level = Number(val(ol)) + 1;
        m = null;
      }
      if (level) headingLevel.set(id, Math.min(6, level));
    }
  }
  return { headingLevel };
}

function parseNumbering(doc: Document | null): (numId: string, lvl: number) => 'ol' | 'ul' {
  const abstractFmt = new Map<string, Map<number, string>>();
  const numToAbs = new Map<string, string>();
  if (doc) {
    for (const a of descendants(doc, 'abstractnum')) {
      const id = attr(a, 'abstractNumId') ?? '';
      const lv = new Map<number, string>();
      for (const l of childElements(a, 'lvl')) lv.set(Number(attr(l, 'ilvl') ?? 0), val(firstChild(l, 'numfmt')) ?? 'decimal');
      abstractFmt.set(id, lv);
    }
    for (const n of descendants(doc, 'num')) {
      const id = attr(n, 'numId') ?? '';
      const abs = val(firstChild(n, 'abstractnumid'));
      if (abs) numToAbs.set(id, abs);
    }
  }
  return (numId, lvl) => {
    const fmt = abstractFmt.get(numToAbs.get(numId) ?? '')?.get(lvl);
    return fmt && fmt !== 'bullet' && fmt !== 'none' ? 'ol' : 'ul';
  };
}

function relsMap(doc: Document | null): Map<string, { target: string; external: boolean }> {
  const m = new Map<string, { target: string; external: boolean }>();
  if (doc) for (const r of descendants(doc, 'relationship')) m.set(attr(r, 'Id') ?? '', { target: attr(r, 'Target') ?? '', external: (attr(r, 'TargetMode') ?? '') === 'External' });
  return m;
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
  const docPath = zip.resolve('word/document.xml');
  if (!docPath) throw new UnsupportedFormatError('不是有效的 DOCX：缺少 word/document.xml');
  const doc = parseXml(await zip.markup(docPath));
  const stylesDoc = zip.has('word/styles.xml') ? parseXml(await zip.markup('word/styles.xml')) : null;
  const numDoc = zip.has('word/numbering.xml') ? parseXml(await zip.markup('word/numbering.xml')) : null;
  const rels = relsMap(zip.has('word/_rels/document.xml.rels') ? parseXml(await zip.markup('word/_rels/document.xml.rels')) : null);
  const styles = parseStyles(stylesDoc);
  const listKind = parseNumbering(numDoc);
  const footDoc = zip.has('word/footnotes.xml') ? parseXml(await zip.markup('word/footnotes.xml')) : null;

  const footnotes: string[] = [];
  const fnIndex = new Map<string, number>();

  const imageSrc = (rid: string | null): string | null => {
    const r = rid ? rels.get(rid) : undefined;
    if (!r || r.external) return null;
    return `docx-media/${encodeURIComponent(joinPath('word', r.target))}`;
  };

  const runs = (p: Element): string => {
    let s = '';
    const walk = (node: Element) => {
      for (const c of childElements(node)) {
        const n = localName(c);
        if (n === 'r') s += run(c);
        else if (n === 'hyperlink') {
          const rid = attr(c, 'id');
          const anchor = attr(c, 'anchor');
          const target = rid ? rels.get(rid) : undefined;
          const inner = (() => {
            const save = s;
            s = '';
            walk(c);
            const r = s;
            s = save;
            return r;
          })();
          if (anchor) s += `<a href="#${escapeAttr(anchor)}">${inner}</a>`;
          else if (target?.external && /^(https?|mailto):/i.test(target.target)) s += `<a href="${escapeAttr(target.target)}">${inner}</a>`;
          else s += inner;
        } else if (n === 'bookmarkstart') {
          const name = attr(c, 'name');
          if (name && !name.startsWith('_GoBack')) s += `<a id="${escapeAttr(name)}"></a>`;
        } else if (n === 'sdt') {
          const content = firstChild(c, 'sdtcontent');
          if (content) walk(content);
        } else if (['ins', 'smarttag', 'fldsimple', 'sdtcontent', 'customxml'].includes(n)) walk(c);
      }
    };
    const run = (r: Element): string => {
      const rpr = firstChild(r, 'rpr');
      let out = '';
      for (const c of childElements(r)) {
        const n = localName(c);
        if (n === 't' || n === 'delText') out += escapeHtml(c.textContent ?? '');
        else if (n === 'tab') out += ' ';
        else if (n === 'br' || n === 'cr') out += (attr(c, 'type') ?? '') === 'page' ? '' : '<br>';
        else if (n === 'noBreakHyphen') out += '‑';
        else if (n === 'sym') out += '';
        else if (n === 'footnotereference') {
          const id = attr(c, 'id') ?? '';
          if (!fnIndex.has(id)) fnIndex.set(id, fnIndex.size + 1);
          out += `<sup><a epub:type="noteref" href="#fn${escapeAttr(id)}" id="fnref${escapeAttr(id)}">${fnIndex.get(id)}</a></sup>`;
        } else if (n === 'drawing' || n === 'pict') {
          for (const blip of descendants(c, 'blip')) {
            const src = imageSrc(attr(blip, 'embed'));
            if (src) out += `<img src="${src}" alt="">`;
          }
          for (const im of descendants(c, 'imagedata')) {
            const src = imageSrc(attr(im, 'id'));
            if (src) out += `<img src="${src}" alt="">`;
          }
        }
      }
      if (!out) return '';
      if (rpr) {
        if (isOn(firstChild(rpr, 'b'))) out = `<strong>${out}</strong>`;
        if (isOn(firstChild(rpr, 'i'))) out = `<em>${out}</em>`;
        const u = firstChild(rpr, 'u');
        if (u && (val(u) ?? 'single') !== 'none') out = `<u>${out}</u>`;
        if (isOn(firstChild(rpr, 'strike')) || isOn(firstChild(rpr, 'dstrike'))) out = `<s>${out}</s>`;
        const va = val(firstChild(rpr, 'vertalign'));
        if (va === 'superscript') out = `<sup>${out}</sup>`;
        else if (va === 'subscript') out = `<sub>${out}</sub>`;
      }
      return out;
    };
    walk(p);
    return s;
  };

  interface ListCtx {
    stack: { kind: 'ol' | 'ul'; numId: string; lvl: number }[];
  }
  const blocks = (container: Element): string => {
    const out: string[] = [];
    const ctx: ListCtx = { stack: [] };
    const closeLists = (to = 0) => {
      while (ctx.stack.length > to) out.push(`</li></${ctx.stack.pop()!.kind}>`);
    };
    for (const el of childElements(container)) {
      const n = localName(el);
      if (n === 'p') {
        const ppr = firstChild(el, 'ppr');
        const styleId = val(firstChild(ppr ?? el, 'pstyle')) ?? '';
        let level = styles.headingLevel.get(styleId) ?? 0;
        const ol = ppr ? firstChild(ppr, 'outlinelvl') : null;
        if (!level && ol && Number(val(ol)) < 9) level = Number(val(ol)) + 1;
        const numPr = ppr ? firstChild(ppr, 'numpr') : null;
        const numId = numPr ? (val(firstChild(numPr, 'numid')) ?? '') : '';
        const content = runs(el);
        if (numPr && numId !== '0' && !level) {
          const lvl = Number(val(firstChild(numPr, 'ilvl')) ?? 0);
          const kind = listKind(numId, lvl);
          while (ctx.stack.length && (ctx.stack[ctx.stack.length - 1].lvl > lvl || (ctx.stack[ctx.stack.length - 1].lvl === lvl && (ctx.stack[ctx.stack.length - 1].kind !== kind || ctx.stack[ctx.stack.length - 1].numId !== numId)))) {
            out.push(`</li></${ctx.stack.pop()!.kind}>`);
          }
          const top = ctx.stack[ctx.stack.length - 1];
          if (!top || top.lvl < lvl) {
            out.push(`<${kind}><li>`);
            ctx.stack.push({ kind, numId, lvl });
          } else out.push('</li><li>');
          out.push(content || '<br>');
          continue;
        }
        closeLists();
        const jc = val(ppr ? firstChild(ppr, 'jc') : null);
        const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' ? 'justify' : '';
        const style = align ? ` style="text-align:${align}"` : '';
        if (level) out.push(`<h${level}${style}>${content}</h${level}>`);
        else if (!content) out.push('<p class="mr-blank"><br></p>');
        else out.push(`<p${style}>${content}</p>`);
      } else if (n === 'tbl') {
        closeLists();
        const rows = childElements(el, 'tr')
          .map((tr) => {
            const cells = childElements(tr, 'tc')
              .map((tc) => {
                const span = Number(val(firstChild(firstChild(tc, 'tcpr') ?? tc, 'gridspan')) ?? 1);
                return `<td${span > 1 ? ` colspan="${span}"` : ''}>${blocks(tc)}</td>`;
              })
              .join('');
            return `<tr>${cells}</tr>`;
          })
          .join('');
        out.push(`<table>${rows}</table>`);
      } else if (n === 'sdt') {
        const content = firstChild(el, 'sdtcontent');
        if (content) {
          closeLists();
          out.push(blocks(content));
        }
      }
    }
    closeLists();
    return out.join('');
  };

  const body = firstDescendant(doc, 'body');
  if (!body) throw new UnsupportedFormatError('不是有效的 DOCX：缺少正文');
  let html = blocks(body);

  if (footDoc && fnIndex.size) {
    const byId = new Map<string, Element>();
    for (const f of descendants(footDoc, 'footnote')) byId.set(attr(f, 'id') ?? '', f);
    const items = [...fnIndex.entries()].map(([id]) => {
      const f = byId.get(id);
      return `<li epub:type="footnote" id="fn${escapeAttr(id)}">${f ? blocks(f) : ''} <a epub:type="backlink" href="#fnref${escapeAttr(id)}">↩</a></li>`;
    });
    footnotes.push(...items);
    html += `<section epub:type="footnotes"><hr><ol>${footnotes.join('')}</ol></section>`;
  }

  // 元数据：docProps/core.xml
  const fm = metaFromFileName(opts.fileName);
  const meta: BookMetadata = { title: fm.title, authors: fm.authors };
  if (zip.has('docProps/core.xml')) {
    const core = parseXml(await zip.markup('docProps/core.xml'));
    const t = textOfEl(firstDescendant(core, 'title'));
    const a = textOfEl(firstDescendant(core, 'creator'));
    const d = textOfEl(firstDescendant(core, 'description'));
    const s = textOfEl(firstDescendant(core, 'subject'));
    if (t) meta.title = t;
    if (a) meta.authors = [a];
    if (d) meta.description = d;
    if (s) meta.subjects = [s];
  }
  return { html, meta, zip, words: countWords(html.replace(/<[^>]*>/g, ' ')) };
}

export const docxParser: FormatParser = {
  format: 'docx',
  extensions: ['docx'],
  async open(file, opts): Promise<Book> {
    const c = await convert(file, opts);
    const store = new ResourceStore();
    const resolveResource = (ref: string) => {
      const m = /^docx-media\/(.+)$/.exec(ref);
      if (!m) return Promise.resolve(null);
      const path = decodeURIComponent(m[1]);
      return store.url(path, async () => (c.zip.has(path) ? c.zip.blob(path, mimeOf(path)) : null));
    };
    const content = await buildSectionContent(c.html, { resolveResource }, true);
    return buildFlowBook({ format: 'docx', metadata: c.meta, content, maxChars: htmlSettings.get().maxChapterChars, splitAtH1: true, destroy: () => store.destroy() });
  },
  async probe(file, opts): Promise<BookProbe> {
    const c = await convert(file, opts);
    return { format: 'docx', metadata: c.meta, cover: null, size: { chars: c.words } };
  },
};

