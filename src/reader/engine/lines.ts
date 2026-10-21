// 整行翻页的几何计算（VIEW-001 / §4.1），纯函数，不碰 DOM，方便单测。
// 位置模型：章节内容是一整条高 contentHeight 的流，翻页就是把窗口 [y, y+H) 对齐到行顶；窗口底边不切行。
// 行（LineBox）已经含半行距（行盒而不是字形盒），所以翻页后首行字形与页顶之间的留白是一致的。

export interface LineBox {
  top: number;
  bottom: number;
  /** 图片/视频等不可拆分块：必须完整落在窗口内才算「显示」（不拦腰截断） */
  atomic?: boolean;
  /** 文字字形盒的底（行盒底减去半行距）：窗口底边只要盖住字形就不算切行，比 oneLineTag 的比例更准 */
  ink?: number;
}

/** 一行露出多大比例才算显示（A.oneLineTag）：行距<0 → 1−lineSpace/10；否则 (lineSpace≥2 ? .75 : .82) + (亚洲语言 .1 : .08) */
export function oneLineTag(lineSpace: number, asian: boolean): number {
  if (lineSpace < 0) return Math.min(1, 1 - lineSpace / 10);
  return (lineSpace >= 2 ? 0.75 : 0.82) + (asian ? 0.1 : 0.08);
}

/** 把若干行盒（可能重叠，如同一行里的多个 inline 片段）合并成按 top 升序的行表 */
export function mergeBoxes(boxes: LineBox[]): LineBox[] {
  const sorted = boxes.slice().sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  const out: LineBox[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.top < last.top + (last.bottom - last.top) * 0.5) {
      if (b.bottom > last.bottom) last.bottom = b.bottom;
      if (b.atomic) last.atomic = true;
      if (b.ink !== undefined && (last.ink === undefined || b.ink > last.ink)) last.ink = b.ink;
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

/** 第一个 bottom > y 的行（窗口顶部的那一行）；全部在 y 之上则返回 lines.length */
export function lineAt(lines: LineBox[], y: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].bottom > y + 0.5) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** top < edge 的行数（即「底边之前开始的行」的个数） */
function countStartingBefore(lines: LineBox[], edge: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].top < edge - 0.5) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function isShown(l: LineBox, edge: number, tag: number): boolean {
  if (l.atomic) return l.bottom <= edge + 1;
  if (l.ink !== undefined) return l.ink <= edge + 0.5;
  const h = Math.max(1, l.bottom - l.top);
  return edge - l.top >= h * tag - 0.5;
}

/** 窗口 [y, y+H) 内最后一个算「显示」的行下标（至少是窗口首行）；窗口之后没有行时返回 -1 */
export function lastShownLine(lines: LineBox[], y: number, H: number, tag: number): number {
  const first = lineAt(lines, y);
  if (first >= lines.length) return -1;
  const edge = y + H;
  let i = countStartingBefore(lines, edge) - 1;
  if (i < first) return first;
  if (!isShown(lines[i], edge, tag) && i > first) i -= 1;
  return i;
}

/** 向下翻页后的窗口顶；null = 已到章末（后面没有行了）。keepOne：保留上一页最后一行 */
export function nextPageTop(lines: LineBox[], y: number, H: number, tag: number, keepOne = false): number | null {
  const last = lastShownLine(lines, y, H, tag);
  if (last < 0) return null;
  const first = lineAt(lines, y);
  let nextIdx = last + 1;
  if (keepOne && last > first) nextIdx = last;
  if (nextIdx >= lines.length) return null;
  const top = lines[nextIdx].top;
  return top > y + 0.5 ? top : null;
}

/** 以第 last 行为页末行时，能装下的最靠前的页顶（行下标 k → 行顶；k=0 时取 0，把章首留白归入第一页） */
export function topForLastLine(lines: LineBox[], last: number, H: number, tag: number): number {
  if (last <= 0 || !lines.length) return 0;
  let k = last;
  while (k > 0) {
    const edge = lines[k - 1].top + H;
    if (!isShown(lines[last], edge, tag)) break;
    // 中间的行都在 [k-1.top, last.top] 之间，只要末行能显示即可
    k -= 1;
  }
  return k === 0 ? 0 : lines[k].top;
}

/** 向上翻页后的窗口顶；null = 已经是第一页 */
export function prevPageTop(lines: LineBox[], y: number, H: number, tag: number): number | null {
  if (y <= 0.5) return null;
  const j = lineAt(lines, y); // 当前页首行
  if (j <= 0) return null;
  const top = topForLastLine(lines, j - 1, H, tag);
  return top < y - 0.5 ? top : j - 1 > 0 ? lines[j - 1].top : 0;
}

/** 章内最后一页的窗口顶 */
export function lastPageTop(lines: LineBox[], H: number, tag: number): number {
  if (!lines.length) return 0;
  return topForLastLine(lines, lines.length - 1, H, tag);
}

/** 包含 y 的行的行顶（用于重排后把锚点字符所在行放到页顶）；y 在所有行之下取最后一行 */
export function snapToLineTop(lines: LineBox[], y: number): number {
  if (!lines.length) return 0;
  const i = lineAt(lines, y);
  const idx = Math.min(i, lines.length - 1);
  return idx === 0 ? Math.min(0, lines[0].top) : lines[idx].top;
}

/** 章内页数估算（STATUS-001）：floor(H/pageH)+1 在整除时多一页，这里按 ceil 处理 */
export function estimatePages(contentHeight: number, pageH: number): number {
  return Math.max(1, Math.ceil((contentHeight - 1) / Math.max(1, pageH)));
}

/** 当前页码（1 起）：spec §4.2 current = floor(total·(y + pageH/5)/H)+1，末页强制 = total */
export function estimatePage(y: number, contentHeight: number, pageH: number, atEnd: boolean): number {
  const total = estimatePages(contentHeight, pageH);
  if (atEnd) return total;
  const cur = Math.floor((total * (y + pageH / 5)) / Math.max(1, contentHeight)) + 1;
  return Math.max(1, Math.min(total, cur));
}
