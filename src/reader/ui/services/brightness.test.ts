import { describe, expect, it } from 'vitest';
import {
  bluelightOverlay,
  brightnessToSlider,
  dimAmount,
  edgeBrightnessStep,
  edgeFontSizeStep,
  shadeA0,
  shadeLayers,
  sliderToBrightness,
  stepBrightness,
} from './brightness';

describe('亮度遮罩与蓝光过滤（spec §4.7）', () => {
  it('shadeA0（getShadeAlph）：自动与 v>0 无遮罩；v=0 → 4；v=-50 → 200；封顶 200', () => {
    expect(shadeA0(-100)).toBe(0);
    expect(shadeA0(1)).toBe(0);
    expect(shadeA0(100)).toBe(0);
    expect(shadeA0(0)).toBe(4);
    expect(shadeA0(-10)).toBe(44);
    expect(shadeA0(-49)).toBe(200);
    expect(shadeA0(-50)).toBe(200);
  });

  it('蓝光默认 30%：A≈67、颜色 (129,117,38)（spec 例）', () => {
    const b = bluelightOverlay(true, 30, -100)!;
    expect(b.alpha).toBeCloseTo(67.5, 1);
    expect([b.r, b.g, b.b]).toEqual([129, 116, 38]);
    // spec 写 (129,117,38)：G 通道 116.25，四舍五入差 1 以内
    expect(Math.abs(b.g - 117)).toBeLessThanOrEqual(1);
  });

  it('蓝光：关闭为 null；过滤量按 0..100 夹取，有效色值最多按 80 计，alpha 封顶 230', () => {
    expect(bluelightOverlay(false, 50, -100)).toBeNull();
    const hi = bluelightOverlay(true, 100, -100)!;
    expect(hi.alpha).toBe(225);
    expect(bluelightOverlay(true, 95, -100)!.alpha).toBeLessThanOrEqual(230);
    expect([hi.r, hi.g, hi.b]).toEqual([10, 10, 0]);
    expect(bluelightOverlay(true, 0, -100)).toMatchObject({ r: 200, g: 180, b: 60, alpha: 0 });
    // 蓝光 alpha 叠加 shadeA0（原公式）
    expect(bluelightOverlay(true, 30, -50)!.alpha).toBeCloseTo(230, 0);
  });

  it('dimAmount：自动 = 0；1..100 重映射为页面亮度 40%..100%；≤0 在 0.6 之上单调加深到 0.92', () => {
    expect(dimAmount(-100)).toBe(0);
    expect(dimAmount(100)).toBeCloseTo(0, 5);
    expect(dimAmount(50)).toBeCloseTo(0.3, 5);
    expect(dimAmount(1)).toBeCloseTo(0.594, 3);
    expect(dimAmount(0)).toBeCloseTo(0.6, 3);
    expect(dimAmount(-49)).toBeCloseTo(0.92, 3);
    expect(dimAmount(-50)).toBeCloseTo(0.92, 3);
  });

  it('dimAmount 整段滑条单调不减（-50 → 100 越亮越小），且在 0/1 处连续', () => {
    let prev = Infinity;
    for (let v = -50; v <= 100; v++) {
      const d = dimAmount(v);
      expect(d).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
    expect(Math.abs(dimAmount(0) - dimAmount(1))).toBeLessThan(0.02);
  });

  it('shadeLayers：自动且无蓝光 → 没有遮罩；蓝光层 alpha 为 0..1', () => {
    expect(shadeLayers(-100, false, 30)).toEqual({ dim: 0, blue: null });
    const l = shadeLayers(50, true, 30);
    expect(l.dim).toBeCloseTo(0.3, 5);
    expect(l.blue?.alpha).toBeCloseTo(67.5 / 255, 4);
    expect(l.blue?.color).toBe('rgb(129 116 38)');
  });

  it('面板滑条（0..150）与亮度值互转', () => {
    expect(brightnessToSlider(-50)).toBe(0);
    expect(brightnessToSlider(0)).toBe(50);
    expect(brightnessToSlider(100)).toBe(150);
    expect(sliderToBrightness(0)).toBe(-50);
    expect(sliderToBrightness(150)).toBe(100);
    expect(sliderToBrightness(75)).toBe(25);
  });

  it('±1 步进：自动时从 100 起；夹在 -50..100', () => {
    expect(stepBrightness(-100, -1)).toBe(99);
    expect(stepBrightness(50, 1)).toBe(51);
    expect(stepBrightness(100, 1)).toBe(100);
    expect(stepBrightness(-50, -1)).toBe(-50);
  });

  it('边缘滑动调亮度：上滑变亮、下滑变暗；每 20px 一步，速度加成；≤0 时每次只 1 步', () => {
    expect(edgeBrightnessStep(50, -10, 0)).toBe(50); // 不足 20px
    expect(edgeBrightnessStep(50, -20, 0)).toBe(51);
    expect(edgeBrightnessStep(50, 40, 0)).toBe(48);
    expect(edgeBrightnessStep(50, -100, 0)).toBe(55);
    // 速度加成：(1 + 500/500) × 40/20 = 4
    expect(edgeBrightnessStep(50, -40, 500)).toBe(54);
    // 下滑 f=400
    expect(edgeBrightnessStep(50, 40, 400)).toBe(46);
    // 速度封顶 10000
    expect(edgeBrightnessStep(0, -20, 99999)).toBe(1); // ≤0 保护
    expect(edgeBrightnessStep(-100, -20, 0)).toBe(100); // 自动 → 从 100 起，已是上限
    expect(edgeBrightnessStep(5, 200, 0)).toBe(-5);
    expect(edgeBrightnessStep(-50, 100, 0)).toBe(-50);
  });

  it('边缘滑动调字号：每 40px 一次，上滑变大，夹在范围内', () => {
    expect(edgeFontSizeStep(17, -39, 10, 100)).toBe(17);
    expect(edgeFontSizeStep(17, -40, 10, 100)).toBe(18);
    expect(edgeFontSizeStep(17, 80, 10, 100)).toBe(15);
    expect(edgeFontSizeStep(11, 400, 10, 100)).toBe(10);
    expect(edgeFontSizeStep(99, -400, 10, 100)).toBe(100);
  });
});
