// 翻页动画（ANIM-001..012）。两类实现：
//   DOM 层动画（3 水平切换 / 4 上下滚动 / 5 渐隐 / 6 左右覆盖 / 7 上下覆盖）：旧页、新页各是一个真实的章节 iframe 框，只改 transform/opacity；
//     同一章内翻页时新页用同一章的第二个副本（spare）显示另一个窗口，翻完两个副本互换角色，不重载。
//   仿真翻页（1 Apple / 2 Google）：把相邻页栅格化成纹理，WebGL 画卷曲网格（curl-session.ts），无 WebGL 时 Canvas2D 降级。
// 手指跟随（1/2/3/6）：dragBegin/Move/End；点击与按键翻页走 run()。动画结束才真正提交位置（engine.commit）。
import { flipSettings, textSettings } from '../settings';
import { isWhiteFont } from './css';
import type { ChapterFrame } from './frame';
import type { Engine, Pos, TurnTarget } from './controller';
import { CurlSession } from './curl-session';

export interface FlipSession {
  /** p：翻过的比例 0..1（0 = 旧页原样，1 = 完全换成新页） */
  setP(p: number): void;
  end(): void;
}

interface Active {
  session: FlipSession;
  anim: number;
  dir: 1 | -1;
  from: Pos;
  target: TurnTarget;
  swapSection?: number;
  p: number;
  click: boolean;
}

const ease3 = (t: number) => 1 - Math.pow(1 - t, 3);
const ease2 = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function flipDuration(anim: number, speed: number, remaining = 1): number {
  switch (anim) {
    case 3:
    case 6:
      return Math.max(100, (600 - speed * 10) * remaining);
    case 5:
      return Math.max(100, 900 - speed * 10);
    case 4:
    case 7:
      return Math.max(100, (800 - speed * 10) * Math.max(0.3, remaining));
    default:
      // 仿真翻页：T0 = (60 − speed) × 9（Google ×11）
      return Math.max(100, (60 - speed) * (anim === 2 ? 11 : 9) * Math.max(0.3, remaining));
  }
}

class DomSession implements FlipSession {
  private shadow?: HTMLDivElement;
  /** 覆盖翻页里「盖在上面的那页」需要不透明的纸，否则下面的文字会透上来 */
  private backing?: HTMLDivElement;
  private prevOverflow: string;

  constructor(
    private e: Engine,
    private anim: number,
    private dir: 1 | -1,
    private a: ChapterFrame,
    private b: ChapterFrame,
    private aY: number,
    private bY: number,
  ) {
    const st = e.stage!;
    this.prevOverflow = st.style.overflow;
    // 水平动画：页面一直滑到屏幕边缘（页边距区域也算），所以放开舞台裁剪；上下动画保持页高范围内
    if (anim === 3 || anim === 6 || anim === 5) st.style.overflow = 'visible';
    if (anim === 6 || anim === 7) {
      const bk = document.createElement('div');
      const bg = e.root!.style.background || e.root!.style.backgroundColor;
      bk.style.cssText = `position:absolute;pointer-events:none;z-index:2;left:${-e.inset.l}px;top:${-e.inset.t}px;width:${e.boxW}px;height:${e.boxH}px;background:${bg};background-color:${e.root!.style.backgroundColor}`;
      st.appendChild(bk);
      this.backing = bk;
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;pointer-events:none;z-index:2;display:none';
      st.appendChild(d);
      this.shadow = d;
    }
    for (const f of [...e.frames.values(), ...e.spares.values()]) if (f !== a && f !== b) f.place({ x: 0, y: 0, clipH: 1, innerTop: 0, visible: false });
    this.setP(0);
  }

  setP(p: number): void {
    const { e, anim, dir, a, b } = this;
    const W = e.W;
    const H = e.H;
    const aClip = e.pageClip(a, this.aY);
    const bClip = e.pageClip(b, this.bY);
    const pa = { clipH: aClip, innerTop: this.aY, visible: true };
    const pb = { clipH: bClip, innerTop: this.bY, visible: true };
    const sh = this.shadow;
    const night = isWhiteFont(textSettings.get().fontColor);
    const shColor = night ? 'rgba(0,0,0,.75)' : 'rgba(0,0,0,.38)';
    switch (anim) {
      case 3:
        a.place({ ...pa, x: -dir * p * W, y: 0, z: 1 });
        b.place({ ...pb, x: dir * (W - p * W), y: 0, z: 1 });
        break;
      case 4:
        a.place({ ...pa, x: 0, y: -dir * p * H, z: 1 });
        b.place({ ...pb, x: 0, y: dir * (H - p * H), z: 1 });
        break;
      case 5:
        a.place({ ...pa, x: 0, y: 0, z: 1, opacity: 1 - p });
        b.place({ ...pb, x: 0, y: 0, z: 2, opacity: p });
        break;
      case 6: {
        const sw = 18;
        if (dir > 0) {
          b.place({ ...pb, x: 0, y: 0, z: 1 });
          a.place({ ...pa, x: -p * W, y: 0, z: 3 });
          this.backing!.style.transform = `translate3d(${-p * W}px,0,0)`;
          if (sh) Object.assign(sh.style, { display: 'block', left: `${W - p * W}px`, top: '0', width: `${sw}px`, height: `${H}px`, background: `linear-gradient(to right,${shColor},rgba(0,0,0,0))` });
        } else {
          a.place({ ...pa, x: 0, y: 0, z: 1 });
          b.place({ ...pb, x: -W + p * W, y: 0, z: 3 });
          this.backing!.style.transform = `translate3d(${-W + p * W}px,0,0)`;
          if (sh) Object.assign(sh.style, { display: 'block', left: `${p * W}px`, top: '0', width: `${sw}px`, height: `${H}px`, background: `linear-gradient(to right,${shColor},rgba(0,0,0,0))` });
        }
        break;
      }
      case 7: {
        const sw = 16;
        if (dir > 0) {
          b.place({ ...pb, x: 0, y: 0, z: 1 });
          a.place({ ...pa, x: 0, y: -p * H, z: 3 });
          this.backing!.style.transform = `translate3d(0,${-p * H}px,0)`;
          if (sh) Object.assign(sh.style, { display: 'block', left: '0', top: `${aClip - p * H}px`, width: `${W}px`, height: `${sw}px`, background: `linear-gradient(to bottom,${shColor},rgba(0,0,0,0))` });
        } else {
          a.place({ ...pa, x: 0, y: 0, z: 1 });
          b.place({ ...pb, x: 0, y: -H + p * H, z: 3 });
          this.backing!.style.transform = `translate3d(0,${-H + p * H}px,0)`;
          if (sh) Object.assign(sh.style, { display: 'block', left: '0', top: `${bClip - H + p * H}px`, width: `${W}px`, height: `${sw}px`, background: `linear-gradient(to bottom,${shColor},rgba(0,0,0,0))` });
        }
        break;
      }
    }
  }

  end(): void {
    this.shadow?.remove();
    this.backing?.remove();
    this.e.stage!.style.overflow = this.prevOverflow;
  }
}

export class Animator {
  private active?: Active;
  private raf = 0;
  private token = 0;
  private dragDx = 0;
  private dragDir: 1 | -1 = 1;
  private dragP = 0;
  private dragReady?: Promise<boolean>;
  private dragging = false;
  private dragY0 = 0;
  private dragY = 0;

  constructor(private e: Engine) {}

  supports(anim: number): boolean {
    return anim >= 1 && anim <= 7;
  }

  destroy(): void {
    this.cancel();
  }

  /** 中止进行中的动画/拖拽，页面回到当前位置（不提交） */
  cancel(): void {
    this.token++;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const act = this.active;
    this.active = undefined;
    this.dragging = false;
    this.dragReady = undefined;
    if (act) {
      act.session.end();
      this.e.render();
    }
    this.e.turning = false;
  }

  cancelDrag(): void {
    if (this.dragging) this.cancel();
  }

  private async begin(anim: number, dir: 1 | -1, from: Pos, target: TurnTarget, click: boolean): Promise<Active | null> {
    const e = this.e;
    try {
      const a = e.frames.get(from.section) ?? (await e.ensureFrame(from.section));
      let b: ChapterFrame;
      let swapSection: number | undefined;
      if (target.section === from.section) {
        b = await e.ensureSpare(target.section);
        swapSection = target.section;
      } else {
        b = await e.ensureFrame(target.section);
      }
      if (anim === 1 || anim === 2) {
        const session = await CurlSession.create(e, anim, dir, a, b, from.y, target.y, click);
        if (!session) return this.begin(3, dir, from, target, click); // 栅格化失败：降级为水平切换
        return { session, anim, dir, from, target, swapSection, p: 0, click };
      }
      return { session: new DomSession(e, anim, dir, a, b, from.y, target.y), anim, dir, from, target, swapSection, p: 0, click };
    } catch (err) {
      e.emit('error', err as Error);
      return null;
    }
  }

  private play(act: Active, p0: number, p1: number, duration: number, ease: (t: number) => number): Promise<void> {
    const token = ++this.token;
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        if (token !== this.token) return resolve();
        const t = clamp01((now - t0) / duration);
        const p = p0 + (p1 - p0) * ease(t);
        act.p = p;
        act.session.setP(p);
        if (t >= 1) {
          this.raf = 0;
          resolve();
          return;
        }
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  private easeFor(act: Active): (t: number) => number {
    if (act.anim === 1 || act.anim === 2) {
      // 仿真翻页点击：向前 t^1.2，向后 sqrt(t)
      return act.dir > 0 ? (t) => Math.pow(t, 1.2) : (t) => Math.sqrt(t);
    }
    if (act.anim === 4 || act.anim === 7) return ease2;
    if (act.anim === 5) return (t) => t;
    return ease3;
  }

  private finish(act: Active, ok: boolean): void {
    const e = this.e;
    act.session.end();
    this.active = undefined;
    if (ok) {
      if (act.swapSection !== undefined) e.swapSpare(act.swapSection);
      e.commit(act.target, act.dir, act.from);
    } else {
      e.render();
    }
  }

  /** 点击/按键/横划触发的整页动画 */
  async run(dir: 1 | -1, from: Pos, target: TurnTarget, anim: number): Promise<boolean> {
    const act = await this.begin(anim, dir, from, target, true);
    if (!act) return false;
    this.active = act;
    const speed = flipSettings.get().flipSpeed;
    await this.play(act, 0, 1, flipDuration(anim, speed), this.easeFor(act));
    if (this.active !== act) return true; // 被 cancel：状态已由 cancel 处理
    this.finish(act, true);
    return true;
  }

  debugKind(): string {
    const s = this.active?.session;
    return s instanceof CurlSession ? s.rendererKind : s ? 'dom' : '';
  }

  /** 测试用：把动画定格在进度 p（截图核对），debugEnd 复位 */
  async debugShow(dir: 1 | -1, anim: number, p: number): Promise<boolean> {
    this.cancel();
    const e = this.e;
    const from = { ...e.pos };
    const target = await e.targetOf(dir, from);
    if (!target) return false;
    const act = await this.begin(anim, dir, from, target, false);
    if (!act) return false;
    this.active = act;
    e.turning = true;
    act.session.setP(p);
    return true;
  }

  // ───────────── 手指跟随 ─────────────
  async dragBegin(dir: 1 | -1, _x0: number, y0: number): Promise<void> {
    const e = this.e;
    if (e.turning || this.dragging) return;
    e.turning = true;
    this.dragging = true;
    this.dragDir = dir;
    this.dragDx = 0;
    this.dragP = 0;
    this.dragY0 = y0;
    this.dragY = y0;
    const from = { ...e.pos };
    const token = ++this.token;
    this.dragReady = (async () => {
      const target = await e.targetOf(dir, from);
      if (!target) {
        if (dir > 0) e.emit('endOfBook', undefined);
        return false;
      }
      const anim = flipSettings.get().flipAnimation;
      const act = await this.begin(anim, dir, from, target, false);
      if (!act || token !== this.token) {
        act?.session.end();
        return false;
      }
      this.active = act;
      act.session.setP(this.pFromDrag());
      return true;
    })();
    const ok = await this.dragReady;
    if (!ok && token === this.token) {
      // 没有目标页：保持站住，等手指抬起
      this.dragReady = undefined;
    }
  }

  private pFromDrag(): number {
    const W = Math.max(1, this.e.boxW);
    const toward = this.dragDir > 0 ? -this.dragDx : this.dragDx;
    return clamp01(toward / (W * 0.9));
  }

  dragMove(dx: number, _dy: number, _x: number, y: number): void {
    if (!this.dragging) return;
    this.dragDx = dx;
    this.dragY = y;
    const act = this.active;
    if (!act) return;
    this.dragP = this.pFromDrag();
    act.p = this.dragP;
    if (act.session instanceof CurlSession) act.session.setPointerY(y);
    act.session.setP(this.dragP);
  }

  dragEnd(vx: number, _vy: number, cancelled: boolean): void {
    if (!this.dragging) return;
    const token = this.token;
    void (async () => {
      const ok = this.dragReady ? await this.dragReady : false;
      if (token !== this.token) return;
      const act = this.active;
      this.dragging = false;
      if (!ok || !act) {
        this.dragReady = undefined;
        this.e.turning = false;
        return;
      }
      const toward = this.dragDir > 0 ? -vx : vx;
      const complete = !cancelled && (toward > 600 || (toward > -200 && act.p > 0.35));
      const speed = flipSettings.get().flipSpeed;
      const target = complete ? 1 : 0;
      const remaining = Math.abs(target - act.p);
      const dur = flipDuration(act.anim, speed, remaining);
      act.click = false;
      await this.play(act, act.p, target, dur, (t) => ease3(t));
      if (this.active !== act) return;
      this.dragReady = undefined;
      this.finish(act, complete);
      this.e.turning = false;
    })();
  }
}
