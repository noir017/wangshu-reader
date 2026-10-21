// 整屏纹理翻页：相邻两屏各是一张「阅读区大小」的 canvas（含背景），动画只摆这两张图。
// 固定版式（PDF/漫画）与双页可重排书共用——它们没有「章节 iframe 的两个窗口」可以直接动，只能先拿到整屏图。
// 3–7 用 DOM 层的 transform/opacity；1/2 交给仿真翻页（curl-session.ts，WebGL，失败降级 Canvas2D）。
import type { FlipPlan, FlipSession } from './animator';
import { CurlSession, type CurlHost } from './curl-session';
import { isWhiteFont } from './css';
import { textSettings } from '../settings';

class TexDomSession implements FlipSession {
  private host: HTMLDivElement;
  private shadow: HTMLDivElement;

  constructor(
    private e: CurlHost,
    private anim: number,
    private dir: 1 | -1,
    private a: HTMLCanvasElement,
    private b: HTMLCanvasElement,
  ) {
    const host = (this.host = document.createElement('div'));
    host.style.cssText = `position:absolute;left:0;top:0;width:${e.boxW}px;height:${e.boxH}px;overflow:hidden;pointer-events:none;z-index:50`;
    for (const c of [a, b]) {
      c.style.cssText = `position:absolute;left:0;top:0;width:${e.boxW}px;height:${e.boxH}px;display:block;will-change:transform,opacity`;
      host.appendChild(c);
    }
    this.shadow = document.createElement('div');
    this.shadow.style.cssText = 'position:absolute;pointer-events:none;display:none';
    host.appendChild(this.shadow);
    e.root.appendChild(host);
    this.setP(0);
  }

  setP(p: number): void {
    const { anim, dir, a, b } = this;
    const W = this.e.boxW;
    const H = this.e.boxH;
    const night = isWhiteFont(textSettings.get().fontColor);
    const shColor = night ? 'rgba(0,0,0,.75)' : 'rgba(0,0,0,.38)';
    const tx = (c: HTMLCanvasElement, x: number, y: number, z: number, opacity = 1) => {
      c.style.transform = `translate3d(${x}px,${y}px,0)`;
      c.style.zIndex = String(z);
      c.style.opacity = opacity === 1 ? '' : String(opacity);
    };
    const sh = this.shadow.style;
    sh.display = 'none';
    switch (anim) {
      case 3:
        tx(a, -dir * p * W, 0, 1);
        tx(b, dir * (W - p * W), 0, 1);
        break;
      case 4:
        tx(a, 0, -dir * p * H, 1);
        tx(b, 0, dir * (H - p * H), 1);
        break;
      case 5:
        tx(a, 0, 0, 1, 1 - p);
        tx(b, 0, 0, 2, p);
        break;
      case 6: {
        // 向后翻（下一页）：当前页向左滑出，露出下面静止的新页；向前翻：上一页从左侧滑入盖住当前页
        const sw = 18;
        const edge = dir > 0 ? W - p * W : p * W;
        if (dir > 0) {
          tx(b, 0, 0, 1);
          tx(a, -p * W, 0, 3);
        } else {
          tx(a, 0, 0, 1);
          tx(b, -W + p * W, 0, 3);
        }
        Object.assign(sh, { display: 'block', zIndex: '4', left: `${edge}px`, top: '0', width: `${sw}px`, height: `${H}px`, background: `linear-gradient(to right,${shColor},rgba(0,0,0,0))` });
        break;
      }
      case 7: {
        const sw = 16;
        const edge = dir > 0 ? H - p * H : p * H;
        if (dir > 0) {
          tx(b, 0, 0, 1);
          tx(a, 0, -p * H, 3);
        } else {
          tx(a, 0, 0, 1);
          tx(b, 0, -H + p * H, 3);
        }
        Object.assign(sh, { display: 'block', zIndex: '4', left: '0', top: `${edge}px`, width: `${W}px`, height: `${sw}px`, background: `linear-gradient(to bottom,${shColor},rgba(0,0,0,0))` });
        break;
      }
    }
  }

  end(): void {
    this.host.remove();
  }
}

/** 由整屏纹理创建翻页动画：texA = 当前屏，texB = 目标屏 */
export async function textureFlip(host: CurlHost, anim: number, dir: 1 | -1, texA: HTMLCanvasElement, texB: HTMLCanvasElement, click: boolean): Promise<FlipPlan> {
  if (anim === 1 || anim === 2) {
    return { session: await CurlSession.fromTextures(host, anim, dir, texA, texB, click), anim };
  }
  return { session: new TexDomSession(host, anim, dir, texA, texB), anim };
}

/** 新建一张阅读区大小的纹理画布（CSS 尺寸 w×h，像素 ×dpr），并填上背景色 */
export function newScreenCanvas(w: number, h: number, dpr: number, fill?: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
  }
  return { canvas, ctx };
}
