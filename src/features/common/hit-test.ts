// 视口坐标 → (章节, 章内偏移)。引擎没有 hitTest 接口：靠 caretPositionFromPoint 在章节文档里反查。
// 章节文档要么是主文档，要么是同源 iframe（引擎的做法）。引擎会同时挂着相邻章的 iframe（预载/动画用），
// 不能挨个问「这个点在你里面吗」——被裁掉/盖住的 iframe 也会给出一个位置；所以先用 elementsFromPoint 找到
// 这个点上真正可见的 iframe（已考虑裁剪与遮挡），再只问它。
import { offsetOfPoint } from '@/core/text';
import { recentSectionDocs } from './section-docs';

type CaretDoc = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAt(doc: CaretDoc, x: number, y: number): { node: Node; offset: number } | null {
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const rg = doc.caretRangeFromPoint?.(x, y);
  return rg ? { node: rg.startContainer, offset: rg.startOffset } : null;
}

export function hitTestPoint(x: number, y: number): { section: number; offset: number } | null {
  const known = recentSectionDocs();
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.tagName !== 'IFRAME') continue;
    let doc: Document | null = null;
    try {
      doc = (el as HTMLIFrameElement).contentDocument;
    } catch {
      continue; // 跨域
    }
    if (!doc?.body) continue;
    const entry = known.find((k) => k.doc === doc);
    if (!entry) continue;
    const r = el.getBoundingClientRect();
    const hit = caretAt(doc as CaretDoc, x - r.left, y - r.top);
    if (hit && doc.body.contains(hit.node)) return { section: entry.section, offset: offsetOfPoint(doc.body, hit.node, hit.offset) };
    return null;
  }
  // 正文直接渲染在主文档里（没有 iframe）：用注册的主文档
  for (const { section, doc } of known) {
    if (doc.defaultView?.frameElement) continue;
    const hit = caretAt(doc as CaretDoc, x, y);
    if (hit && doc.body.contains(hit.node)) return { section, offset: offsetOfPoint(doc.body, hit.node, hit.offset) };
  }
  return null;
}
