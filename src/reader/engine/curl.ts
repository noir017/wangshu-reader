// 仿真翻页的网格几何（规格 §4.3 / §4.4）。纯数学，不碰 DOM/GL，方便单测。
// Apple 风格：harism/android_page_curl 的 CurlMesh —— 把页面矩形绕「卷曲线」卷成半圆柱，输出三角带顶点。
// Google 风格：页面沿一条 S 形曲线弯折，再做透视投影（在 CPU 上投影，输出的仍是 2D 三角带，渲染器通用）。
// 坐标：像素，y 向下。

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Vtx {
  x: number;
  y: number;
  /** 离页面平面的高度（>0 表示翘起）；渲染 2D 时不用，决定正反面 */
  z: number;
  u: number;
  v: number;
  /** 明暗系数（圆柱面上 0.74..1.2） */
  shade: number;
  /** 半影方向（阴影用） */
  px: number;
  py: number;
}

export interface ShadowV {
  x: number;
  y: number;
  px: number;
  py: number;
  /** 0..1：内侧颜色插值系数 */
  k: number;
}

export interface CurlMesh {
  /** 按扫描顺序排列的三角带顶点：前 front 个是正面，其后（从 max(0,front-2) 起）是背面 */
  verts: Vtx[];
  front: number;
  back: number;
  dropShadow: ShadowV[];
  selfShadow: ShadowV[];
}

interface P2 {
  x: number;
  y: number;
}

export const MAX_SPLITS = 10;

interface RV extends Vtx {
  /** 原始角点序号 0=TL 1=BL 2=TR 3=BR */
  corner: number;
}

const rot = (x: number, y: number, c: number, s: number): P2 => ({ x: x * c + y * s, y: -x * s + y * c });
const unrot = (x: number, y: number, c: number, s: number): P2 => ({ x: x * c - y * s, y: x * s + y * c });

/**
 * 卷曲：P 卷曲线上一点，D 单位卷曲方向（指向页面保持平整的那一侧），r 圆柱半径。
 * 返回 null 表示页面完全平整（没有卷曲）。
 */
export function curlMesh(rect: Rect, P: P2, D: P2, r: number): CurlMesh {
  const phi = Math.atan2(D.y, D.x);
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  // 四个角点：0 TL、1 BL、2 TR、3 BR，贴图坐标与外向半影
  const corners: Array<{ x: number; y: number; u: number; v: number; px: number; py: number }> = [
    { x: rect.left, y: rect.top, u: 0, v: 0, px: -1, py: -1 },
    { x: rect.left, y: rect.bottom, u: 0, v: 1, px: -1, py: 1 },
    { x: rect.right, y: rect.top, u: 1, v: 0, px: 1, py: -1 },
    { x: rect.right, y: rect.bottom, u: 1, v: 1, px: 1, py: 1 },
  ];
  const rv: RV[] = corners.map((k, i) => {
    const p = rot(k.x - P.x, k.y - P.y, c, s);
    const pen = rot(k.px, k.py, c, s);
    return { x: p.x, y: p.y, z: 0, u: k.u, v: k.v, shade: 1, px: pen.x, py: pen.y, corner: i };
  });
  rv.sort((a, b) => b.x - a.x || b.y - a.y);
  const pos = new Map<number, number>();
  rv.forEach((v, i) => pos.set(v.corner, i));
  // 矩形四条边（用原始角点序号：TL-BL、TL-TR、BL-BR、TR-BR）换算成排序后的下标
  const edges: Array<[number, number]> = (
    [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ] as Array<[number, number]>
  ).map(([a, b]) => [pos.get(a)!, pos.get(b)!]);

  const arc = Math.PI * r;
  const scan: number[] = [0];
  if (r > 0) for (let i = 1; i < MAX_SPLITS; i++) scan.push((-arc * i) / (MAX_SPLITS - 1));
  scan.push(rv[3].x - 1);

  const intersections = (x: number): RV[] => {
    const out: RV[] = [];
    for (const [ia, ib] of edges) {
      const a = rv[ia];
      const b = rv[ib];
      const hi = a.x >= b.x ? a : b;
      const lo = a.x >= b.x ? b : a;
      if (hi.x > x && lo.x < x) {
        const t = (x - lo.x) / (hi.x - lo.x);
        out.push({
          x,
          y: lo.y + (hi.y - lo.y) * t,
          z: 0,
          u: lo.u + (hi.u - lo.u) * t,
          v: lo.v + (hi.v - lo.v) * t,
          shade: 1,
          px: lo.px + (hi.px - lo.px) * t,
          py: lo.py + (hi.py - lo.py) * t,
          corner: -1,
        });
      }
    }
    return out;
  };

  const verts: Vtx[] = [];
  const dropShadow: ShadowV[] = [];
  const selfShadow: ShadowV[] = [];
  let front = 0;
  let back = 0;
  let xmax = rv[0].x + 1;
  const last = scan.length - 1;

  const emit = (v: RV, i: number) => {
    let isFront: boolean;
    let { x, z, px, py } = v;
    let shade = 1;
    if (i === 0) {
      isFront = true;
    } else if (i === last || arc === 0) {
      x = -(arc + x);
      z = 2 * r;
      px = -px;
      isFront = false;
    } else {
      const rotY = x / r;
      x = r * Math.sin(rotY);
      z = r - r * Math.cos(rotY);
      px *= Math.cos(rotY);
      shade = Math.sqrt(Math.sin(rotY) + 1.5) * 0.9 + 0.1;
      isFront = z < r;
    }
    if (isFront) front++;
    else back++;
    const w = unrot(x, v.y, c, s);
    const pw = unrot(px, py, c, s);
    const out: Vtx = { x: w.x + P.x, y: w.y + P.y, z, u: v.u, v: v.v, shade, px: pw.x, py: pw.y };
    verts.push(out);
    if (z > 0 && z <= r && r > 0) {
      const sv: ShadowV = { x: out.x, y: out.y, px: (z / 2) * -D.x, py: (z / 2) * -D.y, k: z / r };
      dropShadow.splice(Math.floor((dropShadow.length + 1) / 2), 0, sv);
    }
    if (z > r) {
      const sv: ShadowV = { x: out.x, y: out.y, px: ((z - r) / 3) * pw.x, py: ((z - r) / 3) * pw.y, k: (z - r) / (2 * r) };
      selfShadow.splice(Math.floor((selfShadow.length + 1) / 2), 0, sv);
    }
  };

  for (let i = 0; i < scan.length; i++) {
    const xmin = scan[i];
    const outBuf: RV[] = [];
    for (const v of rv) {
      if (v.x >= xmin && v.x <= xmax) {
        const n = { ...v };
        const inter = intersections(n.x);
        if (inter.length === 1 && inter[0].y > v.y) outBuf.push(inter[0], n);
        else if (inter.length <= 1) outBuf.push(n, ...inter);
        // 两个交点：退化情形，原算法不输出
      }
    }
    const inter = intersections(xmin);
    if (inter.length === 2) {
      const [a, b] = inter;
      if (a.y < b.y) outBuf.push(b, a);
      else outBuf.push(a, b);
    } else if (inter.length) {
      outBuf.push(...inter);
    }
    for (const v of outBuf) emit(v, i);
    xmax = xmin;
  }
  return { verts, front, back, dropShadow, selfShadow };
}

// ───────────── 指针 → 卷曲参数（§4.3 updateCurlPos / setCurlPos） ─────────────

export interface CurlParams {
  P: P2;
  D: P2;
  r: number;
}

/**
 * 手指（或合成指针）位置 → 卷曲线。dragStart 是触点在页缘上的起点（向前翻时在右缘）。
 * 返回 null = 不卷曲（页面保持平整）。
 */
export function curlFromPointer(rect: Rect, dragStart: P2, pointer: P2, fromClick: boolean, landscape: boolean): CurlParams | null {
  const pageW = rect.right - rect.left;
  const pressureFactor = 1 - 0.7843; // 原 app 压力固定 0.7843
  let r = (fromClick ? 1.0 : 1.5) * (pageW / (landscape ? 6 : 3)) * Math.max(pressureFactor, 0);
  const dir = { x: pointer.x - dragStart.x, y: pointer.y - dragStart.y };
  const L = Math.hypot(dir.x, dir.y);
  if (L < 0.5) return null;
  let arc = Math.PI * r;
  const fullW = 2 * pageW;
  if (L > fullW - arc) {
    arc = Math.max(fullW - L, 0);
    r = arc / Math.PI;
  }
  const P =
    L >= arc
      ? { x: pointer.x - (dir.x * (L - arc)) / 2 / L, y: pointer.y - (dir.y * (L - arc)) / 2 / L }
      : { x: pointer.x + (dir.x * Math.sin(Math.sqrt(L / arc) * Math.PI) * r) / L, y: pointer.y + (dir.y * Math.sin(Math.sqrt(L / arc) * Math.PI) * r) / L };
  return setCurlPos(rect, P, { x: dir.x / L, y: dir.y / L }, r);
}

/** 把卷曲线夹进页面：P.x 不能越过左缘；越过右缘 = 平整；方向向竖直倾斜太多时压回 40° 内 */
export function setCurlPos(rect: Rect, P: P2, D: P2, r: number): CurlParams | null {
  if (P.x >= rect.right) return null;
  const p = { x: Math.max(P.x, rect.left), y: Math.min(Math.max(P.y, rect.top), rect.bottom) };
  const len = Math.hypot(D.x, D.y);
  if (len === 0) return null;
  let d = { x: D.x / len, y: D.y / len };
  // D 的主轴应当是水平的（向左或向右）；与水平轴夹角超过 40° 时夹回
  const maxTilt = Math.sin((40 * Math.PI) / 180);
  if (Math.abs(d.y) > maxTilt) {
    const sy = Math.sign(d.y) * maxTilt;
    const sx = Math.sign(d.x || -1) * Math.sqrt(1 - maxTilt * maxTilt);
    d = { x: sx, y: sy };
  }
  return { P: p, D: d, r };
}

// ───────────── Google 风格（§4.4） ─────────────

export interface GoogleMesh {
  /** 沿页宽 50 段的条带：每段两个顶点（上、下），已做透视投影 */
  verts: Vtx[];
  /** 每段是正面（true）还是翻过去的背面 */
  facing: boolean[];
  /** 贴在页右端的阴影强度 0..1（0 = 不画） */
  shadow: number;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** t：−1..1。t>0 向前翻（右→左），t<0 向后翻 */
export function googleMesh(rect: Rect, t: number, landscape: boolean): GoogleMesh {
  const W = rect.right - rect.left;
  const H = rect.bottom - rect.top;
  const dirLeft = t < 0;
  const sm = dirLeft ? smooth(Math.min(0, Math.max(t, -1)) + 1) : Math.min(1, Math.max(t, 0)) * 1.2;
  const smc = Math.min(sm, 1.2);
  // 控制点（以页宽为 1）
  const Q0Xsrc = -0.39375;
  const Q0Xtgt = -1.5;
  const Q1Xsrc = -0.45;
  const Q1Zsrc = -0.02;
  const P0 = { x: -0.5, z: 0 };
  const P1 = { x: 0.5 + -1 * smc, z: 0.1 * smc };
  const Q0 = { x: Q0Xsrc + (Q0Xtgt - Q0Xsrc) * smc, z: Math.sqrt(Math.max(smc, 0)) * 1.2 };
  const c = (0.25 - Q1Zsrc) / (Q1Zsrc + 0.05);
  const z1 = smc < 0.5 ? (Math.pow(Math.sqrt(2 * smc) - 0.5, 2) - 0.25) * (Q1Zsrc / -0.25) : (Math.pow(2 * smc - 0.5, 2) - c) * (Q1Zsrc / c);
  let Q1 = { x: Q1Xsrc + (0.5 - Q1Xsrc) * smc, z: z1 };
  if (Q1.x > P1.x) Q1 = { ...Q1, x: P1.x };
  if (smc > 0.5 && Q1.z > P1.z) Q1 = { ...Q1, z: P1.z };
  const N = 50;
  const pts: Array<{ x: number; z: number }> = [];
  const lerp = (a: { x: number; z: number }, b: { x: number; z: number }, u: number) => ({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u });
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const Q = lerp(Q0, Q1, u);
    const a = lerp(P0, Q, u);
    const b = lerp(Q, P1, u);
    pts.push(lerp(a, b, u));
  }
  // 贴图 u = 沿曲线弧长占比
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = cum[N] || 1;
  // 透视：相机在 z = f 处看向 −z；页面中线 z=0 对应屏幕原样
  const fov = ((landscape ? 30 : 45) * Math.PI) / 180;
  const f = H / W / 2 / Math.tan(fov / 2);
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  const verts: Vtx[] = [];
  const facing: boolean[] = [];
  for (let i = 0; i <= N; i++) {
    const p = pts[i];
    const k = f / Math.max(0.2, f - p.z);
    const sx = cx + p.x * W * k;
    const next = pts[Math.min(N, i + 1)];
    const prev = pts[Math.max(0, i - 1)];
    facing.push(next.x - prev.x >= 0);
    const u = cum[i] / total;
    const top = cy + (rect.top - cy) * k;
    const bottom = cy + (rect.bottom - cy) * k;
    verts.push({ x: sx, y: top, z: p.z, u, v: 0, shade: 1, px: 0, py: 0 }, { x: sx, y: bottom, z: p.z, u, v: 1, shade: 1, px: 0, py: 0 });
  }
  // 阴影强度：t∈(0.6,0.8) 1→2.5，(0.8,1) 2.5→0
  const at = Math.abs(t);
  const base = 0.3;
  const kk = at < 0.6 ? 1 : at < 0.8 ? 1 + 1.5 * ((at - 0.6) / 0.2) : Math.max(0, 2.5 * (1 - (at - 0.8) / 0.2));
  return { verts, facing, shadow: at <= 0 ? 0 : Math.min(1, base * kk) };
}
