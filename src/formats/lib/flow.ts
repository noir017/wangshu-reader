// 单文档 → 多章节：HTML / Markdown 这类「整本是一份文档」的格式用它按标题和大小切成 section，并生成标题目录与锚点索引。
import type { BookFormat, BookMetadata, BookSection, ReflowableBook, SectionContent, TocEntry } from '@/core/book';
import { textOf } from '@/core/text';
import { extractFootnote } from './footnote';

export interface FlowOptions {
  format: BookFormat;
  metadata: BookMetadata;
  /** 已清洗的整本内容 */
  content: SectionContent;
  /** 单个 section 的字符上限（原 app maxHtmlChapterSize=100000） */
  maxChars: number;
  /** 每个 h1 另起一章；h1 少于 minChapters 个时不按标题分章，只按大小切 */
  splitAtH1: boolean;
  minChapters?: number;
  /** 进目录的标题级别上限（3 = h1..h3） */
  tocDepth?: number;
  getCover?: () => Promise<Blob | null>;
  destroy?: () => void;
}

const fixPre = (html: string) => html.replace(/(<(?:pre|textarea|listing)\b[^>]*>)\n/gi, '$1\n\n');

function isH1(n: Node): boolean {
  if (n.nodeType !== 1) return false;
  const el = n as Element;
  return el.localName === 'h1' || (el.firstElementChild?.localName === 'h1' && !(el.firstChild?.nodeType === 3 && (el.firstChild.textContent ?? '').trim()));
}

export function buildFlowBook(o: FlowOptions): ReflowableBook {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body><div id="mr-root">${o.content.bodyHtml}</div></body></html>`, 'text/html');
  let root = doc.getElementById('mr-root')!;

  // 整份内容被一个外层 div/section 包着时，先脱一层，否则没法在顶层切
  for (let guard = 0; guard < 3; guard++) {
    const els = Array.from(root.children);
    const hasText = Array.from(root.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
    if (els.length === 1 && !hasText && ['div', 'section', 'article', 'main'].includes(els[0].localName) && textOf(els[0]).length > o.maxChars) {
      root = els[0] as HTMLElement;
    } else break;
  }

  // 标题补 id（锚点），收集进目录
  let hid = 0;
  const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter((h) => (h.textContent ?? '').trim());
  for (const h of headings) if (!h.getAttribute('id')) h.setAttribute('id', `mr-h${++hid}`);

  const h1Count = headings.filter((h) => h.localName === 'h1').length;
  const splitByH1 = o.splitAtH1 && h1Count >= (o.minChapters ?? 2);

  // 按顶层节点分组
  const groups: Node[][] = [];
  let cur: Node[] = [];
  let curLen = 0;
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
    curLen = 0;
  };
  for (const node of Array.from(root.childNodes)) {
    const len = textOf(node).length;
    if (splitByH1 && isH1(node) && curLen > 0) flush();
    else if (curLen > 0 && curLen + len > o.maxChars) flush();
    cur.push(node);
    curLen += len;
  }
  flush();
  if (!groups.length) groups.push([]);

  const minLevel = Math.min(6, ...headings.map((h) => Number(h.localName[1])));
  const depth = o.tocDepth ?? 3;
  const toc: TocEntry[] = [];
  const idToSection = new Map<string, number>();
  const sectionHtml: string[] = [];
  const sections: BookSection[] = [];

  groups.forEach((nodes, i) => {
    const box = doc.createElement('div');
    for (const n of nodes) box.appendChild(n);
    const html = fixPre(box.innerHTML);
    sectionHtml.push(html);
    let title: string | undefined;
    box.querySelectorAll('[id],a[name]').forEach((e) => {
      const id = e.getAttribute('id') ?? e.getAttribute('name') ?? '';
      if (id && !idToSection.has(id)) idToSection.set(id, i);
    });
    for (const h of Array.from(box.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
      const lv = Number(h.localName[1]);
      const text = (h.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (lv <= depth) toc.push({ title: text.length > 403 ? `${text.slice(0, 400)}...` : text, level: Math.max(0, lv - minLevel), section: i, anchor: h.getAttribute('id') ?? undefined });
      if (title === undefined && lv <= 3) title = text;
    }
    const charCount = textOf(box).length;
    sections.push({
      id: `s${i + 1}`,
      title,
      linear: true,
      charCount,
      load: async () => {
        const c: SectionContent = { bodyHtml: html, styles: o.content.styles };
        if (o.content.bodyAttrs) c.bodyAttrs = o.content.bodyAttrs;
        if (o.content.lang) c.lang = o.content.lang;
        if (o.content.dir) c.dir = o.content.dir;
        return c;
      },
    });
  });

  const resolveHref: ReflowableBook['resolveHref'] = (href) => {
    if (!href.startsWith('#')) return null;
    let id = href.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* 保持原样 */
    }
    const s = idToSection.get(id);
    return s === undefined ? null : { section: s, anchor: id };
  };

  return {
    kind: 'reflowable',
    format: o.format,
    metadata: o.metadata,
    toc,
    sections,
    resolveHref,
    getFootnote: async (href) => {
      const r = resolveHref(href, 0);
      return r?.anchor ? extractFootnote(sectionHtml[r.section], r.anchor) : null;
    },
    getCover: o.getCover ?? (async () => null),
    destroy: o.destroy ?? (() => undefined),
  };
}

export function metaFromHead(text: string): { title?: string; author?: string; description?: string; language?: string } {
  const head = text.slice(0, 16384);
  const pick = (re: RegExp) => re.exec(head)?.[1]?.replace(/\s+/g, ' ').trim() || undefined;
  const dec = (s?: string) => s?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const metaContent = (name: string) => pick(new RegExp(`<meta[^>]+name\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i')) ?? pick(new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*name\\s*=\\s*["']${name}["']`, 'i'));
  return {
    title: dec(pick(/<title[^>]*>([\s\S]*?)<\/title>/i)),
    author: dec(metaContent('author')),
    description: dec(metaContent('description')),
    language: pick(/<html[^>]+\blang\s*=\s*["']([\w-]+)["']/i),
  };
}
