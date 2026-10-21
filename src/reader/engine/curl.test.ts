import { describe, expect, it } from 'vitest';
import { curlFromPointer, curlMesh, googleMesh, setCurlPos, type Rect } from './curl';

const R: Rect = { left: 0, top: 0, right: 400, bottom: 800 };

describe('仿真翻页网格（harism CurlMesh）', () => {
  // D 指向页面保持平整的那一侧：向左拖时 D = (-1,0)，卷曲线 P 左边是平整的正面，右边卷成圆柱再折回
  const P = { x: 250, y: 400 };
  const D = { x: -1, y: 0 };
  const r = 40;
  it('正面顶点在卷曲线左侧的平页上，顶点是三角带（成对）', () => {
    const m = curlMesh(R, P, D, r);
    expect(m.front).toBeGreaterThan(0);
    expect(m.back).toBeGreaterThan(0);
    expect(m.verts.length % 2).toBe(0);
    for (const v of m.verts.slice(0, m.front)) {
      expect(v.x).toBeGreaterThanOrEqual(-1e-6);
      expect(v.x).toBeLessThanOrEqual(P.x + r + 1e-6);
      expect(v.u).toBeGreaterThanOrEqual(0);
      expect(v.u).toBeLessThanOrEqual(1);
    }
  });
  it('背面折回盖在平页上：x 不超过圆柱最右端，且有 z 抬起', () => {
    const m = curlMesh(R, P, D, r);
    const back = m.verts.slice(Math.max(0, m.front - 2));
    expect(back.some((v) => v.z > 0)).toBe(true);
    for (const v of back) expect(v.x).toBeLessThanOrEqual(P.x + r + 1e-6);
  });
  it('圆柱明暗系数在 0.74..1.2', () => {
    const m = curlMesh(R, P, D, r);
    for (const v of m.verts) {
      expect(v.shade).toBeGreaterThan(0.7);
      expect(v.shade).toBeLessThan(1.25);
    }
  });
  it('阴影顶点齐全：投影与自阴影的强度系数为正', () => {
    const m = curlMesh(R, P, D, r);
    expect(m.dropShadow.length).toBeGreaterThan(0);
    for (const s of m.dropShadow) expect(s.k).toBeGreaterThan(0);
    for (const s of m.selfShadow) expect(s.k).toBeGreaterThan(0);
  });
  it('倾斜的卷曲方向也能生成合法网格', () => {
    const d = { x: -Math.cos(0.5), y: Math.sin(0.5) };
    const m = curlMesh(R, { x: 200, y: 300 }, d, 30);
    expect(m.verts.length).toBeGreaterThan(4);
    for (const v of m.verts) {
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.y)).toBe(true);
    }
  });
  it('半径为 0（卷得最开）时退化为折页：没有圆柱段', () => {
    const m = curlMesh(R, P, D, 0);
    expect(m.verts.length).toBeGreaterThan(0);
    for (const v of m.verts) expect(Number.isFinite(v.x)).toBe(true);
  });
});

describe('指针 → 卷曲线（updateCurlPos / setCurlPos）', () => {
  it('指针没离开起点：不卷', () => {
    expect(curlFromPointer(R, { x: 400, y: 700 }, { x: 400, y: 700 }, false, false)).toBeNull();
  });
  it('向左拖：卷曲线在指针右侧，半径随页宽（竖屏 W/3 × 0.2157 × 1.5）', () => {
    const p = curlFromPointer(R, { x: 400, y: 720 }, { x: 250, y: 720 }, false, false)!;
    expect(p).toBeTruthy();
    expect(p.r).toBeCloseTo(1.5 * (400 / 3) * (1 - 0.7843), 3);
    expect(p.P.x).toBeGreaterThan(250);
    expect(p.P.x).toBeLessThan(400);
  });
  it('点击翻页半径系数 1.0（拖动 1.5）', () => {
    const a = curlFromPointer(R, { x: 400, y: 720 }, { x: 250, y: 720 }, true, false)!;
    const b = curlFromPointer(R, { x: 400, y: 720 }, { x: 250, y: 720 }, false, false)!;
    expect(a.r / b.r).toBeCloseTo(1 / 1.5, 3);
  });
  it('setCurlPos：P.x 越过右缘 = 平整；越过左缘夹到左缘；方向过陡夹回 40°', () => {
    expect(setCurlPos(R, { x: 400, y: 100 }, { x: -1, y: 0 }, 10)).toBeNull();
    expect(setCurlPos(R, { x: -50, y: 100 }, { x: -1, y: 0 }, 10)!.P.x).toBe(0);
    const c = setCurlPos(R, { x: 200, y: 100 }, { x: 0.1, y: 1 }, 10)!;
    expect(Math.abs(c.D.y)).toBeCloseTo(Math.sin((40 * Math.PI) / 180), 4);
    expect(Math.hypot(c.D.x, c.D.y)).toBeCloseTo(1, 5);
  });
});

describe('Google 风格（§4.4）', () => {
  it('50 段条带，每段上下两个顶点；t=0 时是平的原位页面', () => {
    const g = googleMesh(R, 0.0001, false);
    expect(g.verts).toHaveLength(2 * 51);
    expect(g.facing).toHaveLength(51);
    expect(g.verts[0].v).toBe(0);
    expect(g.verts[1].v).toBe(1);
  });
  it('翻到一半：一部分段翻到背面', () => {
    const g = googleMesh(R, 0.7, false);
    expect(g.facing.some((f) => !f)).toBe(true);
    expect(g.shadow).toBeGreaterThan(0);
    for (const v of g.verts) expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
  });
  it('贴图坐标 u 沿弧长从 0 到 1 单调', () => {
    const g = googleMesh(R, 0.5, true);
    const us = g.verts.filter((_, i) => i % 2 === 0).map((v) => v.u);
    expect(us[0]).toBe(0);
    expect(us[us.length - 1]).toBeCloseTo(1, 5);
    for (let i = 1; i < us.length; i++) expect(us[i]).toBeGreaterThanOrEqual(us[i - 1]);
  });
});
