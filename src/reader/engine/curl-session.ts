// 仿真翻页会话：栅格化相邻两页 → 渲染器按进度 p 画卷曲网格。
// 向前翻：被卷的页是当前页 A，下面是新页 B；向后翻：被卷的是上一页 B（从左侧翻回来），下面是当前页 A，
// 即「向前翻的逆过程」。进度 s（卷过的比例）→ 虚拟指针 → 卷曲线（curlFromPointer）。
import type { ChapterFrame } from './frame';
import type { Engine } from './controller';
import type { FlipSession } from './animator';
import { averageColor, getPageTexture } from './raster';
import { createCurlRenderer, type CurlRenderer, type CurlScene } from './curl-render';
import { curlFromPointer, curlMesh, googleMesh, type Rect } from './curl';

export class CurlSession implements FlipSession {
  private pointerY: number;
  private y0: number;
  private rect: Rect;
  private landscape: boolean;
  private lastP = 0;

  private constructor(
    private e: Engine,
    private anim: number,
    private dir: 1 | -1,
    private renderer: CurlRenderer,
    private texF: HTMLCanvasElement,
    private tint: [number, number, number],
    private backAlpha: number,
    private click: boolean,
  ) {
    this.rect = { left: 0, top: 0, right: e.boxW, bottom: e.boxH };
    this.landscape = e.boxW > e.boxH;
    this.y0 = click ? e.boxH * 0.99 : e.boxH * 0.9;
    this.pointerY = click ? e.boxH * 0.94 : this.y0;
  }

  static async create(e: Engine, anim: number, dir: 1 | -1, a: ChapterFrame, b: ChapterFrame, aY: number, bY: number, click: boolean): Promise<CurlSession | null> {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bg = e.root!.style.background || e.root!.style.backgroundColor;
    const base = { box: { w: e.boxW, h: e.boxH }, inset: { l: e.inset.l, t: e.inset.t }, width: e.W, background: bg, dpr };
    let texA: HTMLCanvasElement;
    let texB: HTMLCanvasElement;
    try {
      [texA, texB] = await Promise.all([
        getPageTexture({ ...base, frame: a, y: aY, clipH: e.pageClip(a, aY) }),
        getPageTexture({ ...base, frame: b, y: bY, clipH: e.pageClip(b, bY) }),
      ]);
    } catch {
      return null;
    }
    const texF = dir > 0 ? texA : texB;
    const texU = dir > 0 ? texB : texA;
    let renderer = createCurlRenderer(e.boxW, e.boxH, dpr);
    try {
      renderer.setPages(texF, texU);
    } catch {
      // 纹理被浏览器判为跨域污染（部分 Safari）：改用 Canvas2D
      renderer.dispose();
      renderer = createCurlRenderer(e.boxW, e.boxH, dpr, 'canvas2d');
      renderer.setPages(texF, texU);
    }
    const [r, g, bl] = averageColor(texF);
    const lum = (r + g + bl) / 3;
    const f = lum > 200 ? 0.4 : 0.5;
    const backAlpha = f + (0.9 - f) * ((255 - lum) / 255);
    const tint: [number, number, number] = [Math.max(r * 0.97, 25), Math.max(g * 0.97, 25), Math.max(bl * 0.97, 25)];
    const s = new CurlSession(e, anim, dir, renderer, texF, tint, backAlpha, click);
    s.paint(0);
    e.root!.appendChild(renderer.canvas);
    return s;
  }

  /** 拖动时更新手指的 y（决定卷曲线的倾斜） */
  setPointerY(y: number): void {
    this.pointerY = Math.max(0, Math.min(this.e.boxH, y));
    this.paint(this.lastP);
  }

  setP(p: number): void {
    this.paint(p);
  }

  private paint(p: number): void {
    this.lastP = p;
    // s：被卷页翻过的比例
    const s = this.dir > 0 ? p : 1 - p;
    const rect = this.rect;
    const W = rect.right - rect.left;
    const scene: CurlScene = { rect, texF: this.texF, texU: this.texF, tint: this.tint, backAlpha: this.backAlpha, mesh: null };
    // texU 由渲染器 setPages 持有，这里只是满足类型
    if (this.anim === 2) {
      scene.google = googleMesh(rect, s, this.landscape);
    } else if (s <= 0.0005) {
      scene.mesh = null;
    } else if (s >= 0.9995) {
      scene.mesh = { verts: [], front: 0, back: 0, dropShadow: [], selfShadow: [] };
    } else {
      const dragStart = { x: rect.right, y: this.y0 };
      const pointer = { x: rect.right - s * 2 * W, y: this.pointerY };
      const cp = curlFromPointer(rect, dragStart, pointer, this.click, this.landscape);
      scene.mesh = cp ? curlMesh(rect, cp.P, cp.D, cp.r) : null;
    }
    this.renderer.draw(scene);
  }

  get rendererKind(): string {
    return this.renderer.kind;
  }

  end(): void {
    this.renderer.canvas.remove();
    this.renderer.dispose();
  }
}
