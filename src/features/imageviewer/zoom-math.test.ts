import { describe, expect, it } from 'vitest';
import { clampView, fitSize, nextZoomStep, swipeAction, tapZone, zoomAround } from './zoom-math';

const vp = { w: 400, h: 800 };

describe('看图器缩放', () => {
  it('双击循环 1 → 1.75 → 3 → 1', () => {
    expect(nextZoomStep(1)).toBe(1.75);
    expect(nextZoomStep(1.75)).toBe(3);
    expect(nextZoomStep(3)).toBe(1);
    expect(nextZoomStep(1.3)).toBe(1.75);
    expect(nextZoomStep(2.4)).toBe(3);
  });
  it('适应视口（contain）', () => {
    expect(fitSize({ w: 1000, h: 500 }, vp)).toEqual({ w: 400, h: 200 });
    expect(fitSize({ w: 200, h: 1000 }, vp)).toEqual({ w: 160, h: 800 });
    expect(fitSize({ w: 0, h: 0 }, vp)).toEqual(vp);
  });
  it('平移限制：没超出视口的方向锁在中心', () => {
    const fit = { w: 400, h: 200 };
    expect(clampView({ scale: 1, tx: 50, ty: 50 }, fit, vp)).toEqual({ scale: 1, tx: 0, ty: 0 });
    // 3 倍：宽 1200 > 400，可平移 ±400；高 600 < 800，仍锁中心
    expect(clampView({ scale: 3, tx: 999, ty: 999 }, fit, vp)).toEqual({ scale: 3, tx: 400, ty: 0 });
    expect(clampView({ scale: 3, tx: -999, ty: 5 }, fit, vp)).toEqual({ scale: 3, tx: -400, ty: 0 });
  });
  it('以指定点为不动点缩放', () => {
    const fit = { w: 400, h: 800 };
    const v = zoomAround({ scale: 1, tx: 0, ty: 0 }, 2, 100, 0, fit, vp);
    expect(v.scale).toBe(2);
    // 图上点 (100,0) 缩放前后都在屏幕 (100,0)：tx = 100 - (100-0)*2 = -100
    expect(v.tx).toBe(-100);
    // 超出范围的缩放被钳位
    expect(zoomAround({ scale: 1, tx: 0, ty: 0 }, 99, 0, 0, fit, vp).scale).toBe(3);
    expect(zoomAround({ scale: 2, tx: 0, ty: 0 }, 0.1, 0, 0, fit, vp).scale).toBe(1);
  });
  it('滑动翻图只在 1 倍时生效，且要横向为主', () => {
    expect(swipeAction(80, 5, 1)).toBe('prev');
    expect(swipeAction(-80, 5, 1)).toBe('next');
    expect(swipeAction(80, 5, 2)).toBeNull();
    expect(swipeAction(30, 0, 1)).toBeNull();
    expect(swipeAction(80, 90, 1)).toBeNull();
  });
  it('单击区域', () => {
    expect(tapZone(50, 400)).toBe('prev');
    expect(tapZone(200, 400)).toBe('toggle');
    expect(tapZone(390, 400)).toBe('next');
  });
});
