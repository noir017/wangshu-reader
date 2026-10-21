// 固定版式（PDF/漫画）的纯几何：适配缩放、双页跨页、缩放平移夹取、连续滚动的页面排布、文字层矩形。
// 不碰 DOM，方便单测。坐标：像素，y 向下。
import type { FixedPageText } from '@/core/book';

export type FitMode = 'page' | 'width' | 'height';
export interface Size {
  width: number;
  height: number;
}

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** 把 gw×gh 的内容缩放到框 boxW×boxH：整页（两边都放得下）/ 适合宽度 / 适合高度 */
export function fitScale(mode: FitMode, boxW: number, boxH: number, gw: number, gh: number): number {
  if (gw <= 0 || gh <= 0 || boxW <= 0 || boxH <= 0) return 1;
  const sw = boxW / gw;
  const sh = boxH / gh;
  return mode === 'width' ? sw : mode === 'height' ? sh : Math.min(sw, sh);
}

// ───────────── 双页（跨页）：封面单独一页，之后 (1,2)(3,4)… ─────────────

export function spreadStart(page: number, dual: boolean, count: number): number {
  const p = clamp(page, 0, Math.max(0, count - 1));
  if (!dual || p <= 0) return p;
  return p % 2 === 1 ? p : p - 1;
}

export function spreadIndices(start: number, dual: boolean, count: number): number[] {
  if (!dual || start <= 0 || start + 1 >= count) return [start];
  return [start, start + 1];
}

export function nextSpreadStart(start: number, dual: boolean, count: number): number | null {
  const idx = spreadIndices(start, dual, count);
  const n = idx[idx.length - 1] + 1;
  return n < count ? n : null;
}

export function prevSpreadStart(start: number, dual: boolean, count: number): number | null {
  if (start <= 0) return null;
  return spreadStart(start - 1, dual, count);
}

export interface Slot {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SpreadLayout {
  slots: Slot[];
  /** 整组（一页或并排两页）缩放后的尺寸 */
  gw: number;
  gh: number;
  /** 原始页尺寸 → 像素的缩放 */
  scale: number;
}

/**
 * 一屏里的页面排布。两页并排时先把它们统一到同一高度（较高者不变）再整体适配；
 * rtl（日漫）时靠前的页放在右边。
 */
export function layoutSpread(indices: number[], sizes: Size[], rtl: boolean, mode: FitMode, boxW: number, boxH: number): SpreadLayout {
  const h0 = Math.max(...sizes.map((s) => s.height), 1);
  const norm = sizes.map((s) => ({ w: (s.width * h0) / Math.max(1, s.height), h: h0 }));
  const gw0 = norm.reduce((a, n) => a + n.w, 0);
  const scale = fitScale(mode, boxW, boxH, gw0, h0);
  const order = indices.map((_, i) => i);
  if (rtl) order.reverse();
  const slots: Slot[] = [];
  let x = 0;
  for (const i of order) {
    slots.push({ index: indices[i], x, y: 0, w: norm[i].w * scale, h: norm[i].h * scale });
    x += norm[i].w * scale;
  }
  slots.sort((a, b) => indices.indexOf(a.index) - indices.indexOf(b.index));
  return { slots, gw: gw0 * scale, gh: h0 * scale, scale };
}

/** 缩放 z 后内容 (gw·z)×(gh·z) 在框内的平移夹取：放得下就居中，放不下就不能露出空白 */
export function clampPan(z: number, boxW: number, boxH: number, gw: number, gh: number, tx: number, ty: number): { tx: number; ty: number } {
  const cw = gw * z;
  const ch = gh * z;
  return {
    tx: cw <= boxW + 0.5 ? (boxW - cw) / 2 : clamp(tx, boxW - cw, 0),
    ty: ch <= boxH + 0.5 ? (boxH - ch) / 2 : clamp(ty, boxH - ch, 0),
  };
}

/** 以屏幕点 (fx,fy) 为不动点把缩放从 z0 改到 z1 */
export function zoomAbout(tx: number, ty: number, z0: number, z1: number, fx: number, fy: number): { tx: number; ty: number } {
  const k = z1 / z0;
  return { tx: fx - (fx - tx) * k, ty: fy - (fy - ty) * k };
}

/** 双击缩放循环：1 → 1.75 → 3 → 1（与画廊 ComicView 的 min/mid/max 一致） */
export function nextZoomStop(z: number): number {
  if (z < 1.75 - 0.05) return 1.75;
  if (z < 3 - 0.05) return 3;
  return 1;
}

/** 渲染质量 0 高 / 1 中 / 2 低 → 相对 devicePixelRatio 的倍数 */
export function qualityFactor(q: number): number {
  return q === 0 ? 1.5 : q === 2 ? 0.75 : 1;
}

/** 页面位图的像素密度：质量系数 × 缩放，并把总像素数限制在 maxPixels 以内 */
export function renderDensity(cssW: number, cssH: number, dpr: number, quality: number, zoom: number, maxPixels = 24e6): number {
  let d = dpr * qualityFactor(quality) * Math.max(1, zoom);
  const px = cssW * cssH * d * d;
  if (px > maxPixels) d = Math.sqrt(maxPixels / Math.max(1, cssW * cssH));
  return Math.max(0.5, d);
}

// ───────────── 连续滚动：页面纵向排布 ─────────────

/**
 * 竖向连续排布。所有页统一缩放到「参考宽度 = 屏宽」（fitDifferent 时每页各自适配屏宽，
 * 否则按首页宽度统一缩放，保留页面间的相对大小）。页尺寸是懒加载的：没量过的页按已知页的平均宽高比估算。
 */
export class StripLayout {
  private sizes: Array<Size | undefined>;
  private tops = new Float64Array(0);
  private dirty = true;
  private ratioSum = 0;
  private ratioN = 0;
  private refW = 0;

  constructor(
    readonly count: number,
    private boxW: number,
    private fitDifferent: boolean,
    /** 页间距（PDF 要有，长条漫画要无缝） */
    private gap = 0,
  ) {
    this.sizes = new Array(count).fill(undefined);
  }

  known(i: number): boolean {
    return !!this.sizes[i];
  }

  /** 登记页的真实尺寸；返回布局是否因此变化 */
  setSize(i: number, s: Size): boolean {
    if (i < 0 || i >= this.count || s.width <= 0 || s.height <= 0) return false;
    const old = this.sizes[i];
    if (old && old.width === s.width && old.height === s.height) return false;
    if (old) {
      this.ratioSum -= old.height / old.width;
      this.ratioN--;
    }
    this.sizes[i] = s;
    this.ratioSum += s.height / s.width;
    this.ratioN++;
    if (!this.refW) this.refW = s.width;
    this.dirty = true;
    return true;
  }

  private ratio(): number {
    return this.ratioN ? this.ratioSum / this.ratioN : 1.4;
  }

  pageW(i: number): number {
    const s = this.sizes[i];
    if (!s) return this.boxW;
    return this.fitDifferent || !this.refW ? this.boxW : (s.width * this.boxW) / this.refW;
  }

  pageH(i: number): number {
    const s = this.sizes[i];
    if (!s) return this.boxW * this.ratio();
    return (this.pageW(i) * s.height) / s.width;
  }

  pageX(i: number): number {
    return (this.boxW - this.pageW(i)) / 2;
  }

  private ensure(): void {
    if (!this.dirty && this.tops.length === this.count + 1) return;
    const t = new Float64Array(this.count + 1);
    for (let i = 0; i < this.count; i++) t[i + 1] = t[i] + this.pageH(i) + this.gap;
    this.tops = t;
    this.dirty = false;
  }

  top(i: number): number {
    this.ensure();
    return this.tops[clamp(i, 0, this.count)];
  }

  total(): number {
    this.ensure();
    return Math.max(0, this.tops[this.count] - this.gap);
  }

  /** 包含纵坐标 y 的页（越界取首/末页） */
  indexAt(y: number): number {
    this.ensure();
    if (this.count === 0) return 0;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tops[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

// ───────────── 文字层（PDF 选择/装饰） ─────────────

export type TextItem = FixedPageText['items'][number];
export interface NRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 文本区间 [start,end) 覆盖的矩形（归一化页坐标）。同一行相邻的文字块合并成一条 */
export function rectsForRange(items: TextItem[], start: number, end: number): NRect[] {
  const raw: NRect[] = [];
  for (const it of items) {
    const len = it.end - it.start;
    if (len <= 0 || it.end <= start || it.start >= end) continue;
    const a = (Math.max(start, it.start) - it.start) / len;
    const b = (Math.min(end, it.end) - it.start) / len;
    if (b <= a) continue;
    raw.push({ x: it.x + a * it.w, y: it.y, w: (b - a) * it.w, h: it.h });
  }
  const out: NRect[] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.max(last.h, r.h) * 0.5 && r.x <= last.x + last.w + Math.max(last.h, r.h) * 1.5 && r.x >= last.x - 1e-6) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const top = Math.min(last.y, r.y);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      last.w = right - last.x;
      last.y = top;
      last.h = bottom - top;
    } else out.push({ ...r });
  }
  return out;
}

/**
 * 页内点 (nx,ny)（归一化）→ 文本偏移；离文字太远返回 null。
 * slackY：容忍的垂直距离（相对行高）；slackX：容忍落在文字块左右之外多远（归一化页宽，缺省不限 = 拖选时吸附到行首/行尾）
 */
export function offsetAtPoint(items: TextItem[], nx: number, ny: number, slackY = 0.6, slackX = Infinity): number | null {
  let best: { d: number; item: TextItem } | null = null;
  for (const it of items) {
    if (it.end <= it.start) continue;
    const dy = ny < it.y ? it.y - ny : ny > it.y + it.h ? ny - (it.y + it.h) : 0;
    if (dy > it.h * slackY) continue;
    const dx = nx < it.x ? it.x - nx : nx > it.x + it.w ? nx - (it.x + it.w) : 0;
    if (dx > slackX) continue;
    const d = dy * 4 + dx;
    if (!best || d < best.d) best = { d, item: it };
  }
  if (!best) return null;
  const it = best.item;
  const f = it.w > 0 ? clamp((nx - it.x) / it.w, 0, 1) : 0;
  return it.start + Math.round(f * (it.end - it.start));
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const SEP = /[\s　/,.;?"':(){}[\]!，。；＂”“：？《》（）、！’‘<>—-]/;

/** 偏移处的「词」：CJK 单字，其它语言按连续的非分隔字符；落在分隔符上返回 null */
export function wordAt(text: string, offset: number): { start: number; end: number } | null {
  if (!text) return null;
  let at = clamp(offset, 0, text.length - 1);
  if (SEP.test(text[at]) && at > 0 && !SEP.test(text[at - 1])) at -= 1;
  const ch = text[at];
  if (SEP.test(ch)) return null;
  if (CJK.test(ch)) return { start: at, end: at + 1 };
  let s = at;
  let e = at + 1;
  while (s > 0 && !SEP.test(text[s - 1]) && !CJK.test(text[s - 1])) s--;
  while (e < text.length && !SEP.test(text[e]) && !CJK.test(text[e])) e++;
  return { start: s, end: e };
}
