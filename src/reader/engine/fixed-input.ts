// 固定版式手势（CTRL-012 的固定版式版）：pointer events 状态机，只上报原始事件。
//   连续滚动 / 已放大 / 页比屏幕大：单指拖 = 平移（带惯性）；拖过边缘再多拖一截 = 翻页
//   单页且整页可见：横向拖 = 手指跟随翻页（动画 1/2/3/6）或松手判一次翻页（4/5/7）
//   双指 = 缩放（以两指中心为不动点）；双击 = 缩放循环（单击因此延迟一个双击窗口再上报）
//   长按 = 选词（有文字层时）；鼠标在文字上拖 = 选择，其它地方拖 = 平移
import { controlSettings, flipSettings } from '../settings';
import { offsetAtPoint } from './fixed-layout';
import { nextZoomStop } from './fixed-layout';
import type { FixedEngine } from './fixed';

const SLOP = 10;
const MOUSE_SLOP = 4;
const TAP_MAX_MS = 800;
const DOUBLE_TAP_MS = 260;
const DECEL = 2400;
const EDGE_ZONE = 20;
const OVERSCROLL_FLIP = 56;

type Mode = 'pending' | 'pan' | 'flip' | 'edge' | 'select' | 'hswipe' | 'vswipe' | 'pinch' | 'longpressed' | 'auto' | 'ignore';

interface Ptr {
  id: number;
  type: string;
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  samples: Array<{ t: number; x: number; y: number }>;
}

export class FixedInput {
  private ptrs = new Map<number, Ptr>();
  private mode: Mode = 'pending';
  private longTimer?: ReturnType<typeof setTimeout>;
  private tapTimer?: ReturnType<typeof setTimeout>;
  private lastTap = { t: 0, x: 0, y: 0 };
  private flingRaf = 0;
  private cleanups: Array<() => void> = [];
  private wheelAcc = 0;
  private wheelLock = 0;
  private overX = 0;
  private overY = 0;
  private pinch?: { d0: number; z0: number };
  private selAnchor?: { index: number; offset: number };

  constructor(private e: FixedEngine) {}

  destroy(): void {
    this.stopFling();
    clearTimeout(this.longTimer);
    clearTimeout(this.tapTimer);
    for (const c of this.cleanups) c();
    this.cleanups = [];
  }

  attach(root: HTMLElement): void {
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (ev: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      root.addEventListener(t, fn as EventListener, o);
      this.cleanups.push(() => root.removeEventListener(t, fn as EventListener, o));
    };
    const pt = (ev: PointerEvent) => {
      const r = root.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    on('pointerdown', (ev) => this.down(ev, pt(ev)));
    on('pointermove', (ev) => this.move(ev, pt(ev)));
    on('pointerup', (ev) => this.up(ev, pt(ev)));
    on('pointercancel', (ev) => this.cancel(ev));
    on('wheel', (ev) => this.wheel(ev, pt(ev as unknown as PointerEvent)), { passive: false });
    on('keydown', (ev) => this.e.emit('key', { key: ev.key, code: ev.code, event: ev }));
    on('contextmenu', (ev) => ev.preventDefault());
  }

  private slop(p: Ptr): number {
    return p.type === 'mouse' ? MOUSE_SLOP : SLOP;
  }

  // ───────────── 按下 ─────────────
  private down(ev: PointerEvent, pt: { x: number; y: number }): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const e = this.e;
    const cs = controlSettings.get();
    this.stopFling();
    const p: Ptr = { id: ev.pointerId, type: ev.pointerType, x0: pt.x, y0: pt.y, t0: ev.timeStamp, x: pt.x, y: pt.y, samples: [{ t: ev.timeStamp, x: pt.x, y: pt.y }] };
    try {
      e.root.setPointerCapture(ev.pointerId);
    } catch {
      /* 合成事件没有活动指针 */
    }
    if (this.ptrs.size === 0) {
      if (cs.disableEdgeTouch && ev.pointerType !== 'mouse' && this.inEdgeBand(pt)) {
        this.mode = 'ignore';
        this.ptrs.set(p.id, p);
        return;
      }
      this.mode = e.autoEngaged ? 'auto' : 'pending';
      this.overX = this.overY = 0;
      this.selAnchor = undefined;
      if (this.mode === 'auto') e.autoTouchStart();
      if (ev.pointerType === 'mouse') {
        e.root.focus({ preventScroll: true });
        // 鼠标按在文字上：拖动 = 选择
        const pa = e.pageAt(pt.x, pt.y);
        if (pa) {
          void e.textOf(pa.index).then((t) => {
            if (!t || !this.ptrs.has(p.id)) return;
            const off = offsetAtPoint(t.items, pa.nx, pa.ny, 0.15, 0.02);
            if (off !== null && this.mode === 'pending') this.selAnchor = { index: pa.index, offset: off };
          });
        }
      } else {
        this.longTimer = setTimeout(() => this.longPress(p), Math.max(50, cs.longTapInterval * 1000));
      }
    } else if (this.mode !== 'ignore') {
      clearTimeout(this.longTimer);
      const [a] = [...this.ptrs.values()];
      if (this.mode === 'flip') e.animator.cancelDrag();
      this.pinch = { d0: Math.hypot(a.x - pt.x, a.y - pt.y) || 1, z0: e.z };
      this.mode = 'pinch';
    }
    this.ptrs.set(p.id, p);
  }

  // ───────────── 移动 ─────────────
  private move(ev: PointerEvent, pt: { x: number; y: number }): void {
    const p = this.ptrs.get(ev.pointerId);
    if (!p || this.mode === 'ignore') return;
    const e = this.e;
    const dx0 = pt.x - p.x;
    const dy0 = pt.y - p.y;
    p.x = pt.x;
    p.y = pt.y;
    p.samples.push({ t: ev.timeStamp, x: pt.x, y: pt.y });
    while (p.samples.length > 2 && ev.timeStamp - p.samples[0].t > 120) p.samples.shift();
    const dx = pt.x - p.x0;
    const dy = pt.y - p.y0;
    switch (this.mode) {
      case 'auto':
        e.autoTouchMove(dx, dy);
        return;
      case 'pinch': {
        const [a, b] = [...this.ptrs.values()];
        if (a && b && this.pinch) {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          e.zoomTo(this.pinch.z0 * (d / this.pinch.d0), (a.x + b.x) / 2, (a.y + b.y) / 2);
          // 双指同时拖动：中心的位移 = 平移（取本次移动指针位移的一半）
          e.panBy(dx0 / 2, dy0 / 2);
        }
        return;
      }
      case 'pan': {
        const o = e.panBy(dx0, dy0);
        this.overX += o.ox;
        this.overY += o.oy;
        return;
      }
      case 'flip':
        e.animator.dragMove(dx, dy, pt.x, pt.y);
        return;
      case 'edge':
        e.emit('verticalDrag', { startX: p.x0, dy, phase: 'move' });
        return;
      case 'select':
        this.extendSelection(pt);
        return;
      case 'pending':
        break;
      default:
        return;
    }
    if (Math.hypot(dx, dy) < this.slop(p)) return;
    clearTimeout(this.longTimer);
    if (p.type === 'mouse' && this.selAnchor) {
      this.mode = 'select';
      this.extendSelection(pt);
      return;
    }
    this.decide(p, dx, dy);
  }

  private decide(p: Ptr, dx: number, dy: number): void {
    const e = this.e;
    const fs = flipSettings.get();
    const vertical = Math.abs(dy) > Math.abs(dx);
    if (vertical && p.type !== 'mouse' && this.inSlideEdge(p.x0)) {
      this.mode = 'edge';
      e.emit('verticalDrag', { startX: p.x0, dy, phase: 'move' });
      return;
    }
    if (e.mode === 'continuous') {
      this.mode = 'pan';
      e.panBy(dx, dy);
      return;
    }
    // 单页：页比屏幕大/已放大时拖动 = 平移；竖向主导且页高过屏也平移
    if (e.overflowX || e.overflowY) {
      if (e.overflowX || vertical) {
        this.mode = 'pan';
        const o = e.panBy(dx, dy);
        this.overX += o.ox;
        this.overY += o.oy;
        return;
      }
    }
    const anim = e.flipAnimation();
    if ((anim === 1 || anim === 2 || anim === 3 || anim === 6) && !vertical && !fs.disableMove) {
      this.mode = 'flip';
      void e.animator.dragBegin(dx < 0 ? 1 : -1, p.x0, p.y0);
      e.animator.dragMove(dx, dy, p.x, p.y);
      return;
    }
    this.mode = vertical ? 'vswipe' : 'hswipe';
  }

  private cancel(ev: PointerEvent): void {
    const p = this.ptrs.get(ev.pointerId);
    if (!p) return;
    clearTimeout(this.longTimer);
    if (this.mode === 'flip') this.e.animator.dragEnd(0, 0, true);
    if (this.mode === 'edge') this.e.emit('verticalDrag', { startX: p.x0, dy: p.y - p.y0, phase: 'end' });
    this.ptrs.delete(ev.pointerId);
    if (!this.ptrs.size) this.mode = 'pending';
  }

  private velocity(p: Ptr): { vx: number; vy: number } {
    const s = p.samples;
    if (s.length < 2) return { vx: 0, vy: 0 };
    const a = s[0];
    const b = s[s.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0.004) return { vx: 0, vy: 0 };
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }

  // ───────────── 抬起 ─────────────
  private up(ev: PointerEvent, pt: { x: number; y: number }): void {
    const p = this.ptrs.get(ev.pointerId);
    if (!p) return;
    clearTimeout(this.longTimer);
    p.x = pt.x;
    p.y = pt.y;
    p.samples.push({ t: ev.timeStamp, x: pt.x, y: pt.y });
    this.ptrs.delete(ev.pointerId);
    const e = this.e;
    const mode = this.mode;
    const dx = pt.x - p.x0;
    const dy = pt.y - p.y0;
    const { vx, vy } = this.velocity(p);
    const dur = ev.timeStamp - p.t0;
    if (mode === 'pinch') {
      if (this.ptrs.size <= 1) {
        this.pinch = undefined;
        // 剩下的那根手指不再当作新手势，等全部抬起
        this.mode = this.ptrs.size === 0 ? 'pending' : 'ignore';
        e.scheduleSettle();
      }
      return;
    }
    if (this.ptrs.size > 0) return;
    this.mode = 'pending';
    switch (mode) {
      case 'ignore':
      case 'longpressed':
        return;
      case 'auto':
        e.autoTouchEnd(dx, dy, dur);
        return;
      case 'select':
        this.extendSelection(pt);
        return;
      case 'pan': {
        const flipped = this.edgeFlip(vx);
        if (!flipped) this.startFling(vx, vy);
        return;
      }
      case 'flip':
        e.animator.dragEnd(vx, vy, false);
        return;
      case 'edge':
        e.emit('verticalDrag', { startX: p.x0, dy, phase: 'end' });
        return;
      case 'hswipe':
      case 'vswipe':
        if (!this.shiftGesture(dx, dy, vx)) this.maybeSwipe(p, dx, dy);
        return;
      case 'pending':
        break;
    }
    if (dur < TAP_MAX_MS && Math.hypot(dx, dy) < this.slop(p)) this.tap(p, ev, pt);
  }

  /** 平移到边缘后仍拖过一截 → 翻页（单页视图） */
  private edgeFlip(vx: number): boolean {
    const e = this.e;
    if (e.mode !== 'single' || !e.zoomed && !e.overflowX) return false;
    if (Math.abs(this.overX) < OVERSCROLL_FLIP && !(Math.abs(vx) > 700 && Math.abs(this.overX) > 12)) return false;
    // overX > 0：想把内容往右拖却到头了 = 看前一页（视觉方向 -1）
    const vis: 1 | -1 = this.overX > 0 ? -1 : 1;
    void e.turn(e.rtl ? ((-vis) as 1 | -1) : vis, { wholePage: true });
    return true;
  }

  /** 横划/竖划翻页（isShiftGesture）。返回是否已用于翻页 */
  private shiftGesture(dx: number, dy: number, vx: number): boolean {
    const e = this.e;
    const fs = flipSettings.get();
    const anim = e.flipAnimation();
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    let vis: 1 | -1 | 0 = 0;
    let vertical = false;
    if (anim === 4 || anim === 5 || anim === 7) {
      if (ady > 20 && adx < 40) {
        vis = dy < 0 ? 1 : -1;
        vertical = true;
      } else if (fs.allowScrollHorizontally && Math.abs(vx) > 600 && ady < 40 && adx > ady) vis = dx < 0 ? 1 : -1;
    } else if (fs.allowScrollHorizontally && adx > 30 && adx > ady * 1.2) vis = dx < 0 ? 1 : -1;
    if (!vis) return false;
    if (fs.disableMove && (anim === 4 || anim === 7)) return false;
    const logical: 1 | -1 = vertical || !e.rtl ? vis : ((-vis) as 1 | -1);
    void e.turn(logical, { wholePage: true });
    return true;
  }

  /** CTRL-004：大幅划动手势（与可重排引擎一致，动作绑定在 reader/ui） */
  private maybeSwipe(p: Ptr, dx: number, dy: number): void {
    const e = this.e;
    const W = e.boxW;
    const H = e.boxH;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    let dir: 'left' | 'right' | 'up' | 'down' | null = null;
    if (adx > Math.min(W / 2, 400) && ady < 120) dir = dx > 0 ? 'right' : 'left';
    else if (ady > Math.min(H / 2, 400) && adx < 120) dir = dy > 0 ? 'down' : 'up';
    if (!dir) return;
    const edge = p.x0 < 40 ? 'left' : p.x0 > W - 40 ? 'right' : p.y0 < 40 ? 'top' : p.y0 > H - 40 ? 'bottom' : undefined;
    e.emit('swipe', { dir, startX: p.x0 / W, startY: p.y0 / H, dist: Math.hypot(dx, dy), edge });
  }

  // ───────────── 点击 / 长按 ─────────────
  private norm(pt: { x: number; y: number }): { x: number; y: number } {
    return { x: pt.x / Math.max(1, this.e.boxW), y: pt.y / Math.max(1, this.e.boxH) };
  }

  private tap(p: Ptr, ev: PointerEvent, pt: { x: number; y: number }): void {
    const e = this.e;
    if (e.getSelection() && p.type !== 'mouse') {
      e.setSelection(null);
      return;
    }
    if (p.type === 'mouse' && e.getSelection()) e.setSelection(null);
    const pa = e.pageAt(pt.x, pt.y);
    if (pa) {
      const t = e.textCached(pa.index);
      if (t) {
        const off = offsetAtPoint(t.items, pa.nx, pa.ny, 0.2, 0.02);
        const d = off === null ? null : e.decorationAt(pa.index, off);
        if (d) {
          e.emit('decorationClick', { layer: d.layer, id: d.id, rect: e.decorationRect(d.range) });
          return;
        }
      }
    }
    const n = this.norm(pt);
    const now = ev.timeStamp;
    if (now - this.lastTap.t < DOUBLE_TAP_MS && Math.hypot(pt.x - this.lastTap.x, pt.y - this.lastTap.y) < 30) {
      clearTimeout(this.tapTimer);
      this.lastTap.t = 0;
      e.emit('doubleTap', n);
      // 鼠标双击文字 = 选词；其它 = 缩放循环
      if (p.type === 'mouse' && pa && e.textCached(pa.index)) {
        const off = offsetAtPoint(e.textCached(pa.index)!.items, pa.nx, pa.ny, 0.15, 0.02);
        if (off !== null) {
          void e.selectWord(pa.index, off);
          return;
        }
      }
      e.zoomTo(nextZoomStop(e.z), pt.x, pt.y);
      e.scheduleSettle();
      return;
    }
    this.lastTap = { t: now, x: pt.x, y: pt.y };
    clearTimeout(this.tapTimer);
    // 单击等一个双击窗口再上报，否则双击缩放会先触发一次翻页
    this.tapTimer = setTimeout(() => e.emit('tap', n), DOUBLE_TAP_MS);
  }

  private longPress(p: Ptr): void {
    if (this.mode !== 'pending' || !this.ptrs.has(p.id)) return;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) >= SLOP) return;
    const e = this.e;
    this.mode = 'longpressed';
    const pa = e.pageAt(p.x, p.y);
    if (pa) {
      void e.textOf(pa.index).then((t) => {
        const off = t ? offsetAtPoint(t.items, pa.nx, pa.ny, 0.3, 0.03) : null;
        const ok = off !== null ? e.selectWord(pa.index, off) : Promise.resolve(false);
        void ok.then((sel) => {
          if (!sel) e.emit('longPress', this.norm(p));
        });
      });
      return;
    }
    e.emit('longPress', this.norm(p));
  }

  /** 鼠标拖选：锚点到当前点之间的文字 */
  private extendSelection(pt: { x: number; y: number }): void {
    const e = this.e;
    const a = this.selAnchor;
    if (!a) return;
    const pa = e.pageAt(pt.x, pt.y);
    if (!pa || pa.index !== a.index) return;
    const t = e.textCached(pa.index);
    if (!t) return;
    const off = offsetAtPoint(t.items, pa.nx, pa.ny, 3);
    if (off === null) return;
    const start = Math.min(a.offset, off);
    const end = Math.max(a.offset, off);
    if (end > start) e.updateSelection({ section: a.index, start, end });
  }

  // ───────────── 边缘 ─────────────
  private inEdgeBand(pt: { x: number; y: number }): boolean {
    const c = controlSettings.get();
    return pt.x < c.leftEdge || pt.x > this.e.boxW - c.rightEdge || pt.y < c.topEdge || pt.y > this.e.boxH - c.bottomEdge;
  }

  private inSlideEdge(x0: number): boolean {
    const c = controlSettings.get();
    const W = this.e.boxW;
    const inside = (edge: number) => (edge === 0 ? x0 < EDGE_ZONE : edge === 1 ? x0 > W - EDGE_ZONE : false);
    return (c.adjustBrightness && inside(c.brightnessEdge)) || (c.adjustFontSizeAtSlide && inside(c.fontsizeEdge));
  }

  // ───────────── 滚轮 ─────────────
  private wheel(ev: WheelEvent, pt: { x: number; y: number }): void {
    const e = this.e;
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? 32 : ev.deltaMode === 2 ? e.boxH : 1;
    const dy = (ev.deltaY || 0) * unit;
    const dx = (ev.deltaX || 0) * unit;
    if (ev.ctrlKey) {
      e.zoomTo(e.z * Math.exp(-dy / 300), pt.x, pt.y);
      e.scheduleSettle();
      return;
    }
    if (e.mode === 'continuous' || e.zoomed || e.overflowY) {
      e.panBy(-dx, -dy);
      if (e.mode === 'single') {
        // 页内滚到底后继续滚轮才翻页
        const down = dy > 0;
        if (!e.canPanY(down ? 1 : -1) && Math.abs(dy) > 0) this.wheelTurn(down ? 1 : -1, ev.timeStamp, dy);
      }
      return;
    }
    this.wheelTurn(dy > 0 ? 1 : -1, ev.timeStamp, dy);
  }

  private wheelTurn(dir: 1 | -1, now: number, dy: number): void {
    if (now < this.wheelLock) return;
    this.wheelAcc += dy;
    if (Math.abs(this.wheelAcc) > 40) {
      this.wheelAcc = 0;
      this.wheelLock = now + 260;
      void this.e.turn(dir);
    }
  }

  // ───────────── 惯性 ─────────────
  private startFling(vx: number, vy: number): void {
    this.stopFling();
    const e = this.e;
    if (Math.hypot(vx, vy) < 120) {
      e.emitRelocate(true);
      return;
    }
    let vel = { x: vx, y: vy };
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const sp = Math.hypot(vel.x, vel.y);
      const ns = Math.max(0, sp - DECEL * dt);
      const k = sp > 0 ? ns / sp : 0;
      const nv = { x: vel.x * k, y: vel.y * k };
      const o = e.panBy(((vel.x + nv.x) / 2) * dt, ((vel.y + nv.y) / 2) * dt);
      vel = nv;
      if (ns < 8 || (Math.abs(o.ox) > 0.5 && Math.abs(o.oy) > 0.5)) {
        this.flingRaf = 0;
        e.emitRelocate(true);
        return;
      }
      this.flingRaf = requestAnimationFrame(step);
    };
    this.flingRaf = requestAnimationFrame(step);
  }

  stopFling(): void {
    if (this.flingRaf) cancelAnimationFrame(this.flingRaf);
    this.flingRaf = 0;
  }
}
