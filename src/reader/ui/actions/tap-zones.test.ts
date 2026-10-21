import { describe, expect, it } from 'vitest';
import { areaGrid, clickArea, TAP_MODE_GALLERY, toggleApplies } from './tap-zones';

// spec 02 §4.5：3×3 网格（行 = 上/中/下，列 = 左/中/右）；0 中(菜单) 1 上 2 下 3 左 4 右
const LR: Record<number, number[][]> = {
  0: [[3, 0, 4], [3, 0, 4], [3, 0, 4]],
  1: [[3, 3, 4], [3, 0, 4], [3, 4, 4]],
  2: [[3, 0, 4], [3, 0, 4], [3, 0, 4]],
  4: [[1, 2, 2], [2, 0, 2], [2, 2, 2]],
  5: [[2, 1, 2], [2, 0, 2], [2, 2, 2]],
  6: [[2, 2, 1], [2, 0, 2], [2, 2, 2]],
};
const UD: Record<number, number[][]> = {
  0: [[1, 1, 1], [0, 0, 0], [2, 2, 2]],
  1: [[1, 1, 1], [2, 0, 1], [2, 2, 2]],
  2: [[1, 1, 1], [0, 0, 0], [2, 2, 2]],
};

describe('点击区判定 clickArea（CTRL-001 / spec §4.5）', () => {
  for (const mode of [0, 1, 2, 4, 5, 6]) {
    it(`tapMode ${mode} 左右模式的 3×3 格`, () => {
      expect(areaGrid(mode, true)).toEqual(LR[mode]);
    });
  }
  for (const mode of [0, 1, 2]) {
    it(`tapMode ${mode} 上下模式的 3×3 格`, () => {
      expect(areaGrid(mode, false)).toEqual(UD[mode]);
    });
  }

  it('tapMode 3：中心格菜单，中心上下的格子按左半 3 / 右半 4 划分，左列全 3、右列全 4（左右模式）', () => {
    expect(clickArea(3, true, 0.1, 0.1)).toBe(3);
    expect(clickArea(3, true, 0.1, 0.5)).toBe(3);
    expect(clickArea(3, true, 0.9, 0.9)).toBe(4);
    expect(clickArea(3, true, 0.5, 0.5)).toBe(0);
    // 中列上方/下方：以 x = W/2 为界
    expect(clickArea(3, true, 0.45, 0.1)).toBe(3);
    expect(clickArea(3, true, 0.55, 0.1)).toBe(4);
    expect(clickArea(3, true, 0.45, 0.9)).toBe(3);
    expect(clickArea(3, true, 0.55, 0.9)).toBe(4);
  });

  it('tapMode 3 上下模式：转置', () => {
    expect(clickArea(3, false, 0.1, 0.1)).toBe(1);
    expect(clickArea(3, false, 0.9, 0.1)).toBe(1);
    expect(clickArea(3, false, 0.1, 0.9)).toBe(2);
    expect(clickArea(3, false, 0.5, 0.5)).toBe(0);
    expect(clickArea(3, false, 0.1, 0.45)).toBe(1);
    expect(clickArea(3, false, 0.1, 0.55)).toBe(2);
  });

  it('tapMode 2 左右模式：十字中区', () => {
    // x ∈ [W/3, 4W/9) 且在上/下行 → 3
    expect(clickArea(2, true, 0.4, 0.1)).toBe(3);
    expect(clickArea(2, true, 0.4, 0.9)).toBe(3);
    // 中间行内 x ∈ [W/3, 2W/3] → 0
    expect(clickArea(2, true, 0.4, 0.5)).toBe(0);
    expect(clickArea(2, true, 0.6, 0.5)).toBe(0);
    // x ∈ [4W/9, 5W/9] 全高 → 0
    expect(clickArea(2, true, 0.5, 0.05)).toBe(0);
    expect(clickArea(2, true, 0.5, 0.95)).toBe(0);
    // 其余按左右半
    expect(clickArea(2, true, 0.6, 0.1)).toBe(4);
    expect(clickArea(2, true, 0.1, 0.5)).toBe(3);
    expect(clickArea(2, true, 0.9, 0.5)).toBe(4);
  });

  it('tapMode 2 上下模式：转置的十字', () => {
    expect(clickArea(2, false, 0.1, 0.4)).toBe(1);
    expect(clickArea(2, false, 0.9, 0.4)).toBe(1);
    expect(clickArea(2, false, 0.5, 0.4)).toBe(0);
    expect(clickArea(2, false, 0.5, 0.6)).toBe(0);
    expect(clickArea(2, false, 0.1, 0.6)).toBe(2);
    expect(clickArea(2, false, 0.1, 0.5)).toBe(0);
  });

  it('tapMode ≥ 4 忽略 toggle：左右/上下两种模式结果相同', () => {
    for (const mode of [4, 5, 6]) expect(areaGrid(mode, true)).toEqual(areaGrid(mode, false));
  });

  it('未知 tapMode 恒为菜单（default）', () => {
    expect(clickArea(7, true, 0.1, 0.1)).toBe(0);
    expect(clickArea(-1, false, 0.9, 0.9)).toBe(0);
  });

  it('默认 tapMode=1 左右模式：左+上 = 上一页区，右+下 = 下一页区，中心 = 菜单', () => {
    expect(clickArea(1, true, 0.05, 0.5)).toBe(3);
    expect(clickArea(1, true, 0.5, 0.1)).toBe(3);
    expect(clickArea(1, true, 0.95, 0.5)).toBe(4);
    expect(clickArea(1, true, 0.5, 0.95)).toBe(4);
    expect(clickArea(1, true, 0.5, 0.5)).toBe(0);
  });

  it('toggleApplies 与画廊：模式 0–3 有两版，4–6 一版，共 11 种', () => {
    expect(TAP_MODE_GALLERY).toHaveLength(11);
    expect([0, 1, 2, 3].every((m) => toggleApplies(m))).toBe(true);
    expect([4, 5, 6].some((m) => toggleApplies(m))).toBe(false);
  });
});
