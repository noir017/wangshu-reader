// 亮度与蓝光遮罩（VIEW-007 / spec §4.7）。
// 浏览器改不了系统亮度，所以全部用页面最上层的遮罩模拟：
//   - 黑色遮罩 = 亮度变暗；
//   - 暖色遮罩 = 蓝光过滤。
// brightnessValue 沿用原 app 的语义：-100 跟随系统（不加遮罩）；-50…0 为「极暗」区；1…100 为亮度百分比。

/** 原公式 getShadeAlph：v ≤ 0（且不是自动）时的遮罩 alpha（0..200，v=0 → 4，v≤-49 → 200） */
export function shadeA0(brightnessValue: number): number {
  return brightnessValue > 0 || brightnessValue === -100 ? 0 : Math.min(1 - brightnessValue, 50) * 4;
}

export interface BluelightColor {
  /** 0..255 */
  r: number;
  g: number;
  b: number;
  /** 原公式 A（未封顶前，叠加了 shadeA0），0..255 范围内取 min(A,230) */
  alpha: number;
}

/** 蓝光遮罩的颜色与 alpha（原公式：A = i*180/80 + shadeA0，色值随 i 变暖） */
export function bluelightOverlay(enable: boolean, opacity: number, brightnessValue: number): BluelightColor | null {
  if (!enable) return null;
  const i0 = Math.max(0, Math.min(100, opacity));
  const A = (i0 * 180) / 80 + shadeA0(brightnessValue);
  const i = Math.min(i0, 80);
  return {
    r: Math.round(200 - (i * 190) / 80),
    g: Math.round(180 - (i * 170) / 80),
    b: Math.round(60 - (i * 60) / 80),
    alpha: Math.min(A, 230),
  };
}

/**
 * 页面变暗程度 0..1（黑色遮罩的 alpha）。
 *  - 自动(-100)：0；
 *  - 1..100：把原版的「窗口亮度 v%」重映射成页面亮度 40%..100%，即变暗 0.6×(1−v/100)（spec VIEW-007 的 Web 降级）；
 *  - ≤0：原版是「窗口亮度 1% + 遮罩 shadeA0」，这里在 v=0 的 0.6 基础上再按 shadeA0 加深到 0.92，保证滑条单调连续。
 */
export function dimAmount(brightnessValue: number): number {
  if (brightnessValue === -100) return 0;
  if (brightnessValue > 0) return 0.6 * (1 - Math.min(brightnessValue, 100) / 100);
  return 0.6 + (0.32 * (shadeA0(brightnessValue) - 4)) / 196 + 0.0;
}

export interface ShadeLayers {
  dim: number;
  blue: { color: string; alpha: number } | null;
}

export function shadeLayers(brightnessValue: number, bluelightEnable: boolean, bluelightOpacity: number): ShadeLayers {
  const b = bluelightOverlay(bluelightEnable, bluelightOpacity, brightnessValue);
  return {
    dim: dimAmount(brightnessValue),
    // 蓝光层不再叠 shadeA0（变暗已由 dim 层负责），按 i*180/80 单独计 alpha
    blue: b
      ? {
          color: `rgb(${b.r} ${b.g} ${b.b})`,
          alpha: Math.min((Math.max(0, Math.min(100, bluelightOpacity)) * 180) / 80, 230) / 255,
        }
      : null,
  };
}

/** 面板滑条（0..150，值 = 进度−50）与 brightnessValue 的互转 */
export const brightnessToSlider = (v: number): number => Math.max(0, Math.min(150, v + 50));
export const sliderToBrightness = (p: number): number => Math.max(-50, Math.min(100, p - 50));

/** 亮度 ±1 步进（音量键/长按菜单）：自动(-100)时从 100 起算；夹在 -50..100 */
export function stepBrightness(v: number, delta: number): number {
  const base = v === -100 ? 100 : v;
  return Math.max(-50, Math.min(100, base + delta));
}

/**
 * 边缘滑动调亮度（CTRL-007）：手指上滑变亮、下滑变暗，每累计移动 ≥ 20px 一步，
 * 步数 = (1 + 速度/f) × 距离/20（f：上滑 500、下滑 400，速度封顶 10000px/s）。
 * 返回新的 brightnessValue；低亮度保护：≤0 时每次最多变化 1。
 */
export function edgeBrightnessStep(current: number, dyPx: number, speedPxPerSec: number): number {
  const up = dyPx < 0; // 屏幕坐标 y 向上为负
  const dist = Math.abs(dyPx);
  const f = up ? 500 : 400;
  const sp = Math.min(Math.abs(speedPxPerSec), 10000);
  let steps = Math.floor(((1 + sp / f) * dist) / 20);
  if (steps < 1) return current;
  const base = current === -100 ? 100 : current;
  if (base <= 0) steps = 1;
  const next = base + (up ? steps : -steps);
  return Math.max(-50, Math.min(100, next));
}

/** 边缘滑动调字号：每移动 ≥ 40px 一次，单指 ±1.0，夹在 min..max；上滑变大 */
export function edgeFontSizeStep(current: number, dyPx: number, min: number, max: number): number {
  const steps = Math.floor(Math.abs(dyPx) / 40);
  if (steps < 1) return current;
  const next = current + (dyPx < 0 ? steps : -steps);
  return Math.round(Math.max(min, Math.min(max, next)) * 10) / 10;
}
