import { describe, expect, it } from 'vitest';
import {
  clampPan,
  fitScale,
  layoutSpread,
  nextSpreadStart,
  nextZoomStop,
  offsetAtPoint,
  prevSpreadStart,
  qualityFactor,
  rectsForRange,
  renderDensity,
  spreadIndices,
  spreadStart,
  StripLayout,
  wordAt,
  zoomAbout,
  type TextItem,
} from './fixed-layout';

describe('适配缩放', () => {
  it('整页 / 适合宽度 / 适合高度', () => {
    expect(fitScale('page', 400, 800, 600, 800)).toBeCloseTo(400 / 600, 6);
    expect(fitScale('page', 400, 400, 600, 800)).toBeCloseTo(0.5, 6);
    expect(fitScale('width', 400, 400, 600, 800)).toBeCloseTo(400 / 600, 6);
    expect(fitScale('height', 400, 400, 600, 800)).toBeCloseTo(0.5, 6);
    expect(fitScale('page', 0, 0, 0, 0)).toBe(1);
  });
});

describe('双页跨页：封面单页，之后 (1,2)(3,4)…', () => {
  it('spreadStart / spreadIndices', () => {
    expect(spreadStart(0, true, 9)).toBe(0);
    expect(spreadStart(1, true, 9)).toBe(1);
    expect(spreadStart(2, true, 9)).toBe(1);
    expect(spreadStart(7, true, 9)).toBe(7);
    expect(spreadStart(5, false, 9)).toBe(5);
    expect(spreadIndices(0, true, 9)).toEqual([0]);
    expect(spreadIndices(1, true, 9)).toEqual([1, 2]);
    expect(spreadIndices(7, true, 9)).toEqual([7, 8]);
    expect(spreadIndices(7, true, 8)).toEqual([7]); // 末页落单
  });
  it('前后翻跨页', () => {
    expect(nextSpreadStart(0, true, 9)).toBe(1);
    expect(nextSpreadStart(1, true, 9)).toBe(3);
    expect(nextSpreadStart(7, true, 9)).toBeNull();
    expect(nextSpreadStart(2, false, 9)).toBe(3);
    expect(prevSpreadStart(3, true, 9)).toBe(1);
    expect(prevSpreadStart(1, true, 9)).toBe(0);
    expect(prevSpreadStart(0, true, 9)).toBeNull();
    expect(prevSpreadStart(5, false, 9)).toBe(4);
  });
});

describe('跨页排布', () => {
  const sz = { width: 600, height: 800 };
  it('单页居中放进整页', () => {
    const l = layoutSpread([0], [sz], false, 'page', 400, 800);
    expect(l.slots).toHaveLength(1);
    expect(l.slots[0].w).toBeCloseTo(400, 6);
    expect(l.gw).toBeCloseTo(400, 6);
  });
  it('两页并排：宽度之和适配屏幕，rtl 时靠前的页在右', () => {
    const ltr = layoutSpread([1, 2], [sz, sz], false, 'page', 1000, 700);
    expect(ltr.gw).toBeCloseTo(1000, 6); // 1200×800 的一组，整页适配受宽度限制
    expect(ltr.gh).toBeLessThanOrEqual(700 + 1e-6);
    expect(ltr.slots[0].x).toBeLessThan(ltr.slots[1].x);
    expect(ltr.slots[0].index).toBe(1);
    const rtl = layoutSpread([1, 2], [sz, sz], true, 'page', 1000, 700);
    expect(rtl.slots[0].index).toBe(1);
    expect(rtl.slots[0].x).toBeGreaterThan(rtl.slots[1].x);
  });
  it('两页高度不同：统一到较高者的高度', () => {
    const l = layoutSpread([1, 2], [{ width: 600, height: 800 }, { width: 600, height: 400 }], false, 'page', 2000, 2000);
    expect(l.slots[0].h).toBeCloseTo(l.slots[1].h, 6);
  });
});

describe('缩放与平移', () => {
  it('clampPan：放得下居中，放不下不露空白', () => {
    expect(clampPan(1, 400, 800, 300, 500, 99, 99)).toEqual({ tx: 50, ty: 150 });
    const c = clampPan(2, 400, 800, 400, 800, 100, 100);
    expect(c.tx).toBe(0);
    expect(c.ty).toBe(0);
    const d = clampPan(2, 400, 800, 400, 800, -9999, -9999);
    expect(d.tx).toBe(400 - 800);
    expect(d.ty).toBe(800 - 1600);
  });
  it('zoomAbout：不动点保持', () => {
    const t = zoomAbout(0, 0, 1, 2, 100, 150);
    // 屏幕点 (100,150) 对应的内容点放大后仍在 (100,150)
    expect((100 - t.tx) / 2).toBeCloseTo(100, 6);
    expect((150 - t.ty) / 2).toBeCloseTo(150, 6);
  });
  it('双击缩放循环 1 → 1.75 → 3 → 1', () => {
    expect(nextZoomStop(1)).toBe(1.75);
    expect(nextZoomStop(1.75)).toBe(3);
    expect(nextZoomStop(3)).toBe(1);
    expect(nextZoomStop(2.4)).toBe(3);
  });
  it('渲染密度：质量系数 × 缩放，像素数封顶', () => {
    expect(qualityFactor(0)).toBe(1.5);
    expect(qualityFactor(1)).toBe(1);
    expect(qualityFactor(2)).toBe(0.75);
    expect(renderDensity(400, 800, 2, 1, 1)).toBe(2);
    expect(renderDensity(400, 800, 2, 0, 2)).toBe(6);
    const d = renderDensity(1000, 2000, 2, 0, 5, 24e6);
    expect(1000 * 2000 * d * d).toBeLessThanOrEqual(24e6 + 1);
  });
});

describe('连续滚动排布 StripLayout', () => {
  it('未量过的页按平均宽高比估算；量到真实尺寸后重排', () => {
    const s = new StripLayout(10, 400, false, 8);
    s.setSize(0, { width: 600, height: 900 });
    expect(s.pageW(0)).toBe(400);
    expect(s.pageH(0)).toBeCloseTo(600, 6);
    expect(s.pageH(5)).toBeCloseTo(600, 6); // 估算
    expect(s.top(1)).toBeCloseTo(608, 6);
    expect(s.total()).toBeCloseTo(10 * 608 - 8, 6);
    expect(s.setSize(5, { width: 600, height: 300 })).toBe(true);
    expect(s.pageH(5)).toBeCloseTo(200, 6);
    expect(s.setSize(5, { width: 600, height: 300 })).toBe(false);
    // 平均宽高比变了，其余未量页的估算跟着变：页 1..4 估为 400+8，页 5 真实 200+8
    expect(s.top(6)).toBeCloseTo(608 + 4 * 408 + 208, 6);
  });
  it('indexAt 二分：页内、页间隙、越界', () => {
    const s = new StripLayout(5, 100, false, 0);
    for (let i = 0; i < 5; i++) s.setSize(i, { width: 100, height: 200 });
    expect(s.indexAt(0)).toBe(0);
    expect(s.indexAt(199)).toBe(0);
    expect(s.indexAt(200)).toBe(1);
    expect(s.indexAt(999)).toBe(4);
    expect(s.indexAt(-50)).toBe(0);
    expect(s.indexAt(5000)).toBe(4);
  });
  it('统一页面尺寸：每页各自适配屏宽；否则按首页宽度保留相对大小', () => {
    const a = new StripLayout(2, 400, false);
    a.setSize(0, { width: 600, height: 800 });
    a.setSize(1, { width: 300, height: 400 });
    expect(a.pageW(1)).toBeCloseTo(200, 6);
    expect(a.pageX(1)).toBeCloseTo(100, 6);
    const b = new StripLayout(2, 400, true);
    b.setSize(0, { width: 600, height: 800 });
    b.setSize(1, { width: 300, height: 400 });
    expect(b.pageW(1)).toBe(400);
    expect(b.pageH(1)).toBeCloseTo(533.33, 1);
  });
  it('非法尺寸忽略', () => {
    const s = new StripLayout(3, 100, false);
    expect(s.setSize(0, { width: 0, height: 10 })).toBe(false);
    expect(s.setSize(9, { width: 10, height: 10 })).toBe(false);
  });
});

describe('文字层', () => {
  // 两行，每行 10 个字符，宽 0.4，行高 0.03
  const items: TextItem[] = [
    { start: 0, end: 10, x: 0.1, y: 0.1, w: 0.4, h: 0.03 },
    { start: 11, end: 21, x: 0.1, y: 0.2, w: 0.4, h: 0.03 },
  ];
  it('rectsForRange：区间按字符比例切文字块', () => {
    const r = rectsForRange(items, 2, 6);
    expect(r).toHaveLength(1);
    expect(r[0].x).toBeCloseTo(0.1 + 0.4 * 0.2, 6);
    expect(r[0].w).toBeCloseTo(0.4 * 0.4, 6);
  });
  it('rectsForRange：跨行得到两条，同一行相邻块合并', () => {
    expect(rectsForRange(items, 5, 16)).toHaveLength(2);
    const adj: TextItem[] = [
      { start: 0, end: 5, x: 0.1, y: 0.1, w: 0.2, h: 0.03 },
      { start: 5, end: 10, x: 0.3, y: 0.1, w: 0.2, h: 0.03 },
    ];
    const m = rectsForRange(adj, 0, 10);
    expect(m).toHaveLength(1);
    expect(m[0].w).toBeCloseTo(0.4, 6);
  });
  it('rectsForRange：区间在文字之外为空', () => {
    expect(rectsForRange(items, 30, 40)).toEqual([]);
    expect(rectsForRange(items, 4, 4)).toEqual([]);
  });
  it('offsetAtPoint：块内按 x 比例；离太远返回 null；限制左右容忍', () => {
    expect(offsetAtPoint(items, 0.3, 0.11)).toBe(5);
    expect(offsetAtPoint(items, 0.1, 0.11)).toBe(0);
    expect(offsetAtPoint(items, 0.5, 0.11)).toBe(10);
    expect(offsetAtPoint(items, 0.3, 0.5)).toBeNull();
    expect(offsetAtPoint(items, 0.9, 0.11)).toBe(10); // 拖选：吸附到行尾
    expect(offsetAtPoint(items, 0.9, 0.11, 0.6, 0.02)).toBeNull(); // 点击：离字太远不算命中
    expect(offsetAtPoint(items, 0.3, 0.205)).toBe(16);
  });
  it('wordAt：CJK 单字、英文按词、分隔符 null', () => {
    expect(wordAt('你好世界', 1)).toEqual({ start: 1, end: 2 });
    expect(wordAt('hello world', 7)).toEqual({ start: 6, end: 11 });
    expect(wordAt('hello world', 5)).toEqual({ start: 0, end: 5 });
    expect(wordAt('a  b', 1)).toEqual({ start: 0, end: 1 });
    expect(wordAt('，，', 0)).toBeNull();
    expect(wordAt('', 0)).toBeNull();
  });
});
