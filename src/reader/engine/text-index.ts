// 章节文本索引：基准偏移（core/text.ts 的约定）与 DOM 位置之间的换算。
// core/text.ts 的 locateOffset 每次调用都重新遍历文本节点，装饰/搜索高亮一多就很慢；这里遍历一次，之后二分查找。
// 显示性替换（简繁、名字替换）发生在文本节点上：等长替换天然不影响偏移；不等长替换（名字替换）通过 segs 维护映射，
// 这样 Locator/TextRange 永远是基于「原文」的偏移。
import { collectTextNodes } from '@/core/text';

const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING

/** 原文 [os,oe) 在显示文本里被替换成 [ds,de) */
export interface ReplaceSeg {
  os: number;
  oe: number;
  ds: number;
  de: number;
}

function origToDisp(segs: ReplaceSeg[], o: number): number {
  let shift = 0;
  for (const s of segs) {
    if (o <= s.os) break;
    if (o >= s.oe) {
      shift = s.de - s.oe;
      continue;
    }
    return o - s.os < (s.oe - s.os) / 2 ? s.ds : s.de;
  }
  return o + shift;
}

function dispToOrig(segs: ReplaceSeg[], d: number): number {
  let shift = 0;
  for (const s of segs) {
    if (d <= s.ds) break;
    if (d >= s.de) {
      shift = s.oe - s.de;
      continue;
    }
    return d - s.ds < (s.de - s.ds) / 2 ? s.os : s.oe;
  }
  return d + shift;
}

export class TextIndex {
  readonly nodes: Text[];
  /** 各节点的原文（基准文本），不随显示性替换变化 */
  readonly orig: string[];
  /** 各节点在章节纯文本中的起始偏移（基于原文长度） */
  readonly starts: number[];
  readonly total: number;
  private idx = new Map<Text, number>();
  private segs = new Map<number, ReplaceSeg[]>();

  constructor(root: Node) {
    this.nodes = collectTextNodes(root);
    this.orig = this.nodes.map((n) => n.data);
    this.starts = [];
    let acc = 0;
    this.nodes.forEach((n, i) => {
      this.starts.push(acc);
      acc += this.orig[i].length;
      this.idx.set(n, i);
    });
    this.total = acc;
  }

  text(): string {
    return this.orig.join('');
  }

  /** 登记某节点的显示性替换（调用方已把 node.data 改成显示文本） */
  setReplacements(i: number, segs: ReplaceSeg[]): void {
    if (segs.length) this.segs.set(i, segs);
    else this.segs.delete(i);
  }

  /** 节点序号：二分查找包含 offset 的节点；offset 落在两节点交界取后一个，end=true 取前一个 */
  nodeAt(offset: number, end = false): number {
    const n = this.nodes.length;
    if (!n) return -1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    if (end && offset === this.starts[lo] && lo > 0) lo -= 1;
    return lo;
  }

  /** 基准偏移 → DOM 位置 */
  locate(offset: number, end = false): { node: Text; offset: number } | null {
    const i = this.nodeAt(Math.max(0, Math.min(offset, this.total)), end);
    if (i < 0) return null;
    const local = Math.max(0, Math.min(offset - this.starts[i], this.orig[i].length));
    const segs = this.segs.get(i);
    const d = segs ? origToDisp(segs, local) : local;
    const node = this.nodes[i];
    return { node, offset: Math.min(d, node.data.length) };
  }

  /** DOM 位置（文本节点 + 节点内偏移）→ 基准偏移 */
  offsetOfText(node: Text, offsetInNode: number): number {
    const i = this.idx.get(node);
    if (i === undefined) return -1;
    const segs = this.segs.get(i);
    return this.starts[i] + (segs ? dispToOrig(segs, offsetInNode) : Math.min(offsetInNode, this.orig[i].length));
  }

  /** DOM 位置（任意容器 + 容器内偏移，Range 边界语义）→ 基准偏移 */
  offsetOfPoint(container: Node, offsetInContainer: number): number {
    if (container.nodeType === 3) {
      const o = this.offsetOfText(container as Text, offsetInContainer);
      if (o >= 0) return o;
      // 不在索引里（被 SKIP 的节点）：落到它之后的第一个文本节点开头
      return this.firstAtOrAfter((n) => !!(container.compareDocumentPosition(n) & FOLLOWING));
    }
    const ref = container.childNodes[offsetInContainer] ?? null;
    if (ref) return this.firstAtOrAfter((n) => n === ref || ref.contains(n) || !!(ref.compareDocumentPosition(n) & FOLLOWING));
    return this.firstAtOrAfter((n) => !container.contains(n) && !!(container.compareDocumentPosition(n) & FOLLOWING));
  }

  /** 第一个满足 pred 的文本节点的起始偏移（pred 沿文档序单调）；没有则返回 total */
  private firstAtOrAfter(pred: (n: Text) => boolean): number {
    let lo = 0;
    let hi = this.nodes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pred(this.nodes[mid])) hi = mid;
      else lo = mid + 1;
    }
    return lo >= this.nodes.length ? this.total : this.starts[lo];
  }

  /** 基准偏移区间 → DOM Range（越界截断；章节无文本返回 null） */
  range(start: number, end: number): Range | null {
    const s = this.locate(start);
    const e = this.locate(Math.max(start, end), true);
    if (!s || !e) return null;
    const doc = s.node.ownerDocument;
    const r = doc.createRange();
    r.setStart(s.node, s.offset);
    r.setEnd(e.node, e.offset);
    return r;
  }

  /** DOM Range → 基准偏移区间 */
  offsetsOfRange(range: Range): { start: number; end: number } {
    const start = this.offsetOfPoint(range.startContainer, range.startOffset);
    const end = this.offsetOfPoint(range.endContainer, range.endOffset);
    return { start, end: Math.max(start, end) };
  }
}
