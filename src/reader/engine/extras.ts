// 章节加载时的附加渲染：纯图章整页居中（VIEW-016）、章末提示（VIEW-021）、页底注解（TOC-004 footnoteOnBottom）、已访问链接。
// 铁律：只加元素、不加文本节点（提示/注解文字放在 data-* 属性里由 ::before 画出），所以偏移基准不变。
import type { ChapterFrame } from './frame';

export interface ExtrasOptions {
  section: number;
  /** 已访问链接（section|href） */
  visited: Set<string>;
  chapterEnd?: string | null;
  /** 页底注解：返回链接指向的注解 HTML（或 null）；internal 判断由调用方包在里面 */
  footnote?: ((href: string) => Promise<string | null>) | null;
}

/** 链接文字像注解标记：很短，且是数字/括号/上标 */
export function looksLikeNoteMarker(text: string, epubType?: string | null): boolean {
  if (epubType && /noteref/i.test(epubType)) return true;
  const t = text.trim();
  return t.length > 0 && t.length <= 6 && /^[\[(（【〔*†‡]*[\d¹²³⁴⁵⁶⁷⁸⁹⁰*†‡a-z]{0,4}[\])）】〕]*$/i.test(t) && /[\d¹²³⁴⁵⁶⁷⁸⁹⁰*†‡\[(（【]/.test(t);
}

function plainText(html: string): string {
  const d = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  return (d.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export async function applyExtras(f: ChapterFrame, o: ExtrasOptions): Promise<void> {
  const doc = f.doc;
  const body = doc.body;
  // 纯图章：没有文字、只有一张图
  if (f.text.text().trim() === '' && doc.images.length === 1 && !body.querySelector('table,video,audio')) body.classList.add('mr-imgonly');
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    if (o.visited.has(`${o.section}|${a.getAttribute('href')}`)) a.classList.add('mr-visited');
  }
  if (o.footnote) {
    const marks = Array.from(doc.querySelectorAll('a[href]'))
      .filter((a) => looksLikeNoteMarker(a.textContent ?? '', a.getAttribute('epub:type')))
      .slice(0, 40);
    const jobs = marks.map(async (a) => {
      try {
        const html = await o.footnote!(a.getAttribute('href') ?? '');
        const text = html ? plainText(html) : '';
        if (!text) return;
        const host = a.closest('p,li,blockquote,dd,div,h1,h2,h3,h4,h5,h6') ?? a.parentElement;
        if (!host || !host.parentNode) return;
        const box = doc.createElement('div');
        box.className = 'mr-note';
        box.setAttribute('data-mr-note', text);
        // 同一块里的多个注解依次排在块后面
        let at: Node = host;
        while (at.nextSibling && (at.nextSibling as Element).classList?.contains('mr-note')) at = at.nextSibling;
        host.parentNode.insertBefore(box, at.nextSibling);
      } catch {
        /* 取不到注解就不显示 */
      }
    });
    await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 1500))]);
  }
  if (o.chapterEnd) {
    const end = doc.createElement('div');
    end.className = 'mr-end';
    end.setAttribute('data-mr-end', o.chapterEnd);
    body.appendChild(end);
  }
}
