// 看图器缩放/平移的纯计算（COMIC-004）：缩放 min 1.0 / mid 1.75 / max 3.0，双击循环。

export const ZOOM_MIN = 1;
export const ZOOM_MID = 1.75;
export const ZOOM_MAX = 3;

/** 双击：当前<mid → mid；mid≤当前<max → max；否则 → min（与原 ComicViewAttacher 一致） */
export function nextZoomStep(scale: number): number {
  if (scale < ZOOM_MID - 0.01) return ZOOM_MID;
  if (scale < ZOOM_MAX - 0.01) return ZOOM_MAX;
  return ZOOM_MIN;
}

export interface View {
  scale: number;
  /** 图片中心相对视口中心的平移（CSS px） */
  tx: number;
  ty: number;
}

export interface Size {
  w: number;
  h: number;
}

/** 缩放后图片尺寸超出视口的部分才允许平移；没超出的方向锁在中心 */
export function clampView(v: View, fit: Size, viewport: Size): View {
  const w = fit.w * v.scale;
  const h = fit.h * v.scale;
  const maxX = Math.max(0, (w - viewport.w) / 2);
  const maxY = Math.max(0, (h - viewport.h) / 2);
  return { scale: v.scale, tx: Math.max(-maxX, Math.min(maxX, v.tx)), ty: Math.max(-maxY, Math.min(maxY, v.ty)) };
}

/** 以视口内某点（相对视口中心）为不动点缩放到 newScale */
export function zoomAround(v: View, newScale: number, px: number, py: number, fit: Size, viewport: Size, min = ZOOM_MIN, max = ZOOM_MAX): View {
  const s = Math.max(min, Math.min(max, newScale));
  const k = s / v.scale;
  // 图上点 p = (px - tx)/scale 在缩放前后保持在屏幕同一位置
  return clampView({ scale: s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }, fit, viewport);
}

/** 图片适应视口（contain）后的显示尺寸 */
export function fitSize(img: Size, viewport: Size): Size {
  if (img.w <= 0 || img.h <= 0) return { w: viewport.w, h: viewport.h };
  const k = Math.min(viewport.w / img.w, viewport.h / img.h);
  return { w: img.w * k, h: img.h * k };
}

/** 在最小缩放且水平滑动超过阈值 → 翻到上/下一张 */
export function swipeAction(dx: number, dy: number, scale: number, threshold = 60): 'prev' | 'next' | null {
  if (scale > ZOOM_MIN + 0.01) return null;
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.2) return null;
  return dx > 0 ? 'prev' : 'next';
}

/** 单击落点 → 动作：左 30% 上一张、右 30% 下一张、中间切换工具栏 */
export function tapZone(x: number, width: number): 'prev' | 'next' | 'toggle' {
  const r = x / Math.max(1, width);
  return r < 0.3 ? 'prev' : r > 0.7 ? 'next' : 'toggle';
}
