// 脚注提取（TOC-004 的内容提供方）：给定一份章节 body HTML 和锚点 id，判断它是不是脚注并取出 HTML 片段。
// 判定依据：目标元素（或其祖先）带 epub:type=footnote|endnote|rearnote|note 或 role=doc-footnote|doc-endnote；
// 无标记的旧式书用 id/class 命名启发式（footnote1、fn3、n12…）。正文长度 >5000 的当作不是脚注。
const FOOTNOTE_TYPE = /\b(footnote|endnote|rearnote|note)s?\b/i;
const FOOTNOTE_NAME = /(foot|end|rear)?note|^fn[-_]?\d|^n\d+$|^ref\d+$/i;

export function extractFootnote(bodyHtml: string, anchor: string): string | null {
  const holder = new DOMParser().parseFromString(`<!doctype html><html><body><div>${bodyHtml}</div></body></html>`, 'text/html').body.firstElementChild;
  if (!holder) return null;
  const el = Array.from(holder.querySelectorAll('[id],a[name]')).find((e) => (e.getAttribute('id') ?? e.getAttribute('name')) === anchor);
  if (!el) return null;
  let node: Element = el;
  // 目标若是空锚点（<a id="x"/>），取它所在的块
  if (!(node.textContent ?? '').trim()) node = node.closest('p,li,div,aside,section,dd,blockquote') ?? node;
  const typed = node.closest('[epub\\:type],[role]');
  const typeAttr = `${node.getAttribute('epub:type') ?? ''} ${typed?.getAttribute('epub:type') ?? ''} ${node.getAttribute('role') ?? ''} ${typed?.getAttribute('role') ?? ''}`;
  const isNote = FOOTNOTE_TYPE.test(typeAttr) || /doc-(foot|end)note/.test(typeAttr) || FOOTNOTE_NAME.test(anchor) || FOOTNOTE_NAME.test(node.getAttribute('class') ?? '');
  if (!isNote) return null;
  const len = (node.textContent ?? '').length;
  if (len === 0 || len >= 5000) return null;
  const tag = node.localName;
  return tag === 'li' || tag === 'aside' || tag === 'div' || tag === 'section' ? node.innerHTML : node.outerHTML;
}
