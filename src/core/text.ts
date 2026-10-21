// 章节纯文本与偏移换算：Locator.offset / TextRange 的唯一基准。
// 纯文本 = root 下所有文本节点按文档顺序直接拼接（跳过 script/style 等不可见元素），不插入任何分隔符；
// 所以任何对 DOM 的显示性改动（简繁转换、断字的软连字符等）都必须保持文本节点长度不变，否则偏移会错位。

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE']);

/** 块级元素：用于给朗读/搜索提供段落边界 */
const BLOCK = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'TR',
  'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'DT', 'DD', 'FIGCAPTION', 'BR', 'HR', 'TABLE', 'UL', 'OL', 'DL',
]);

function skipped(node: Node, root: Node): boolean {
  for (let p = node.parentNode; p && p !== root; p = p.parentNode) {
    if (p.nodeType === 1 && SKIP.has((p as Element).tagName.toUpperCase())) return true;
  }
  return false;
}

/** root 下参与计数的文本节点（文档顺序） */
export function collectTextNodes(root: Node): Text[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!skipped(n, root)) out.push(n as Text);
  }
  return out;
}

export function textOf(root: Node): string {
  return collectTextNodes(root)
    .map((t) => t.data)
    .join('');
}

/**
 * 纯文本 + 段落边界。breaks 为升序偏移，表示「从该偏移起是一个新的块级元素」，
 * 朗读分句、搜索结果摘要、导出时用来还原换行。
 */
export function textWithBreaks(root: Node): { text: string; breaks: number[] } {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 1 | 4 /* SHOW_ELEMENT | SHOW_TEXT */);
  let text = '';
  const breaks: number[] = [];
  const mark = () => {
    if (breaks[breaks.length - 1] !== text.length) breaks.push(text.length);
  };
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 1) {
      const tag = (n as Element).tagName.toUpperCase();
      if (BLOCK.has(tag)) mark();
    } else if (!skipped(n, root)) {
      text += (n as Text).data;
    }
  }
  if (breaks[0] === 0) breaks.shift();
  return { text, breaks };
}

/** 偏移 → 文本节点内位置。offset 恰在两个节点交界时取后一个节点的开头（end=true 时取前一个节点末尾） */
export function locateOffset(root: Node, offset: number, end = false): { node: Text; offset: number } | null {
  const nodes = collectTextNodes(root);
  let acc = 0;
  for (let i = 0; i < nodes.length; i++) {
    const len = nodes[i].data.length;
    if (offset < acc + len || (end && offset === acc + len) || (i === nodes.length - 1 && offset === acc + len)) {
      return { node: nodes[i], offset: offset - acc };
    }
    acc += len;
  }
  return null;
}

const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING（worker 里没有全局 Node）

/**
 * DOM 位置（容器 + 容器内偏移，与 Range 边界同语义）→ 纯文本偏移。
 * 只用 compareDocumentPosition，不依赖 Range.intersectsNode/comparePoint（happy-dom 等实现不可靠）。
 */
export function offsetOfPoint(root: Node, container: Node, offsetInContainer: number): number {
  const nodes = collectTextNodes(root);
  let acc = 0;
  if (container.nodeType === 3) {
    for (const t of nodes) {
      if (t === container) return acc + Math.min(offsetInContainer, t.data.length);
      if (container.compareDocumentPosition(t) & FOLLOWING) return acc;
      acc += t.data.length;
    }
    return acc;
  }
  // 元素容器：边界在第 offsetInContainer 个子节点之前；越界即容器末尾
  const ref = container.childNodes[offsetInContainer] ?? null;
  for (const t of nodes) {
    if (ref) {
      if (t === ref || ref.contains(t) || ref.compareDocumentPosition(t) & FOLLOWING) break;
    } else if (!container.contains(t) && container.compareDocumentPosition(t) & FOLLOWING) {
      break;
    }
    acc += t.data.length;
  }
  return acc;
}

/** 纯文本区间 → DOM Range；越界时截到有效范围，章节无文本时返回 null */
export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  const s = locateOffset(root, Math.max(0, start));
  const e = locateOffset(root, Math.max(start, end), true);
  if (!s || !e) return null;
  const doc = root.ownerDocument ?? (root as Document);
  const r = doc.createRange();
  r.setStart(s.node, s.offset);
  r.setEnd(e.node, e.offset);
  return r;
}

/** DOM Range → 纯文本区间 */
export function offsetsOfRange(root: Node, range: Range): { start: number; end: number } {
  const start = offsetOfPoint(root, range.startContainer, range.startOffset);
  const end = offsetOfPoint(root, range.endContainer, range.endOffset);
  return { start, end: Math.max(start, end) };
}

/** 从 bodyHtml 计算纯文本（解析器算 charCount、搜索/朗读离线取文本用） */
export function textOfHtml(bodyHtml: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${bodyHtml}</body></html>`, 'text/html');
  return textOf(doc.body);
}
