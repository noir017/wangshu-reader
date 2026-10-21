// 点击区判定（CTRL-001，spec 02 §4.5），逐行移植自原 app 的 A.clickArea。
// 坐标为 0..1 的阅读区归一化坐标（引擎 tap 事件的约定）；双页点右页的 x += W/2 由引擎在上报时处理。
import type { TapArea } from '@/core/reader';

/** 返回 0 中(菜单) 1 上 2 下 3 左 4 右 */
export function clickArea(tapMode: number, toggleTapMode: boolean, x: number, y: number): TapArea {
  const W = 1;
  const H = 1;
  switch (tapMode) {
    case 0:
      if (toggleTapMode) {
        if (x < W / 3) return 3;
        return x > (W * 2) / 3 ? 4 : 0;
      }
      if (y < H / 3) return 1;
      return y > (H * 2) / 3 ? 2 : 0;
    case 1: {
      if (toggleTapMode) {
        const f = W / 3;
        if (x >= f) {
          const f2 = (W * 2) / 3;
          if (x >= f2 || y >= H / 3) {
            return x > f2 || (x > f && y > (H * 2) / 3) ? 4 : 0;
          }
        }
        return 3;
      }
      const f3 = H / 3;
      if (y >= f3) {
        const f4 = (H * 2) / 3;
        if (y >= f4 || x <= (W * 2) / 3) {
          if (y <= f4 && (y <= f3 || x >= W / 3)) return 0;
          return 2;
        }
      }
      return 1;
    }
    case 2:
      if (!toggleTapMode) {
        if (y >= H / 3 && (y >= (H * 4) / 9 || (x >= W / 3 && x <= (W * 2) / 3))) {
          return y > (H * 2) / 3 || (y > (H * 5) / 9 && (x < W / 3 || x > (W * 2) / 3)) ? 2 : 0;
        }
        return 1;
      }
      if (x >= W / 3 && (x >= (W * 4) / 9 || (y >= H / 3 && y <= (H * 2) / 3))) {
        if (x <= (W * 2) / 3 && (x <= (W * 5) / 9 || (y >= H / 3 && y <= (H * 2) / 3))) return 0;
        return 4;
      }
      return 3;
    case 3:
      if (toggleTapMode) {
        if (x >= W / 3) {
          const f5 = W / 2;
          if (x >= f5 || (y >= H / 3 && y <= (H * 2) / 3)) {
            return x > (W * 2) / 3 || (x > f5 && (y < H / 3 || y > (H * 2) / 3)) ? 4 : 0;
          }
        }
        return 3;
      }
      if (y >= H / 3) {
        const f6 = H / 2;
        if (y >= f6 || (x >= W / 3 && x <= (W * 2) / 3)) {
          if (y <= (H * 2) / 3 && (y <= f6 || (x >= W / 3 && x <= (W * 2) / 3))) return 0;
          return 2;
        }
      }
      return 1;
    case 4: {
      const f7 = H / 3;
      if (y >= f7 || x >= W / 3) {
        return x <= W / 3 || x >= (W * 2) / 3 || y <= f7 || y >= (H * 2) / 3 ? 2 : 0;
      }
      return 1;
    }
    case 5: {
      const f8 = H / 3;
      if (y >= f8 || x <= W / 3 || x >= (W * 2) / 3) {
        return x <= W / 3 || x >= (W * 2) / 3 || y <= f8 || y >= (H * 2) / 3 ? 2 : 0;
      }
      return 1;
    }
    case 6: {
      const f9 = H / 3;
      if (y >= f9 || x <= (W * 2) / 3) {
        return x <= W / 3 || x >= (W * 2) / 3 || y <= f9 || y >= (H * 2) / 3 ? 2 : 0;
      }
      return 1;
    }
    default:
      return 0;
  }
}

/** 九宫格每格的区域码（行 = 上/中/下，列 = 左/中/右），用于点击区示意（CTRL-013）与测试 */
export function areaGrid(tapMode: number, toggleTapMode: boolean): TapArea[][] {
  const c = [1 / 6, 0.5, 5 / 6];
  return c.map((y) => c.map((x) => clickArea(tapMode, toggleTapMode, x, y)));
}

/** tapMode ≥ 4 时 toggleTapMode 无效（只有一种布局） */
export function toggleApplies(tapMode: number): boolean {
  return tapMode < 4;
}

/** 点击模式的 11 种画廊项：模式 0–3 各有上下/左右两版，4–6 一版 */
export const TAP_MODE_GALLERY: { tapMode: number; toggle: boolean }[] = [
  { tapMode: 0, toggle: true },
  { tapMode: 0, toggle: false },
  { tapMode: 1, toggle: true },
  { tapMode: 1, toggle: false },
  { tapMode: 2, toggle: true },
  { tapMode: 2, toggle: false },
  { tapMode: 3, toggle: true },
  { tapMode: 3, toggle: false },
  { tapMode: 4, toggle: true },
  { tapMode: 5, toggle: true },
  { tapMode: 6, toggle: true },
];
