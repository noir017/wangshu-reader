// 手势识别（CTRL-012）：pointer events 状态机，只上报原始事件。
// 点击区判定与动作执行不在这里（reader/ui 按 controlSettings 做）；翻页类拖拽由引擎自己处理：
//   滚动模式：竖向拖动 = 惯性滚动；横划（速度>600px/s）= 按 horiFlingAnimation 翻页
//   分页模式：动画 1/2/3/6 = 手指跟随（animator.drag*）；4/5/7 = 松手后判定一次翻页（isShiftGesture）
// 鼠标：拖动是原生选字，不做拖拽翻页；触屏：长按选词 + 手柄（手柄归 features，这里只出 selection 事件）。
import { controlSettings, flipSettings } from '../settings';
import type { ChapterFrame } from './frame';
import type { Engine } from './controller';

const SLOP = 10; // 触摸判定为「移动」的阈值（CSS px，原 10dp）
const MOUSE_SLOP = 4;
const TAP_MAX_MS = 800;
const DOUBLE_TAP_MS = 320;
const FLING_MIN_SPEED = 120; // px/s
const DECEL = 2400; // px/s²，惯性滚动减速度
const EDGE_ZONE = 40; // 边缘亮度/字号滑动区宽度

type Mode = 'pending' | 'scroll' | 'flip' | 'edge' | 'edgeH' | 'native' | 'hswipe' | 'vswipe' | 'pinch' | 'longpressed' | 'auto' | 'ignore';

interface Ptr {
  id: number;
  type: string;
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  frame?: ChapterFrame;
  target?: Element | null;
  /** 按下时已有选区（鼠标：原生行为会在 mousedown 时清掉选区，抬起时已经看不出来了） */
  hadSelection?: boolean;
  samples: Array<{ t: number; x: number; y: number }>;
}

/** 浏览器视口坐标 → 文本节点上的字符位置（兼容 caretPositionFromPoint / caretRangeFromPoint） */
export function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  const p = d.caretPositionFromPoint?.(x, y);
  return p ? { node: p.offsetNode, offset: p.offset } : null;
}

export class Gestures {
  private ptrs = new Map<number, Ptr>();
  private mode: Mode = 'pending';
  private longTimer?: ReturnType<typeof setTimeout>;
  private lastTap = { t: 0, x: 0, y: 0 };
  private pinch0 = 0;
  private flingRaf = 0;
  private wheelAcc = 0;
  private wheelLock = 0;
  private edgeStartX = 0;
  private edgeStartY = 0;
  private cleanups: Array<() => void> = [];
  private lastScrollT = 0;
  /** 鼠标点击在文字上时，tap 要等一个双击窗口再发（桌面双击/三击是选词选段，不能顺带翻页） */
  private pendingTap?: ReturnType<typeof setTimeout>;
  private lastMouseClick = { t: 0, x: 0, y: 0 };

  constructor(private e: Engine) {}

  destroy(): void {
    this.stopFling();
    clearTimeout(this.longTimer);
    clearTimeout(this.pendingTap);
    for (const c of this.cleanups) c();
    this.cleanups = [];
  }

  // ───────────── 挂接 ─────────────
  attachRoot(root: HTMLElement): void {
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (ev: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      root.addEventListener(t, fn as EventListener, o);
      this.cleanups.push(() => root.removeEventListener(t, fn as EventListener, o));
    };
    const toRoot = (ev: PointerEvent) => {
      const r = root.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    on('pointerdown', (ev) => this.down(ev, toRoot(ev), undefined));
    on('pointermove', (ev) => this.move(ev, toRoot(ev)));
    on('pointerup', (ev) => this.up(ev, toRoot(ev)));
    on('pointercancel', (ev) => this.cancel(ev));
    on('wheel', (ev) => this.wheel(ev), { passive: false });
    on('keydown', (ev) => this.e.emit('key', { key: ev.key, code: ev.code, event: ev }));
    on('contextmenu', (ev) => ev.preventDefault());
  }

  attachFrame(f: ChapterFrame): void {
    const d = f.doc;
    const toRoot = (ev: PointerEvent) => this.e.toRoot(f, ev.clientX, ev.clientY);
    f.listen('pointerdown', (ev) => this.down(ev, toRoot(ev), f));
    f.listen('pointermove', (ev) => this.move(ev, toRoot(ev)));
    f.listen('pointerup', (ev) => this.up(ev, toRoot(ev)));
    f.listen('pointercancel', (ev) => this.cancel(ev));
    f.listen('wheel', (ev) => this.wheel(ev), { passive: false });
    f.listen('keydown', (ev) => this.e.emit('key', { key: ev.key, code: ev.code, event: ev }));
    f.listen('contextmenu', (ev) => ev.preventDefault());
    f.listen('click', (ev) => ev.preventDefault()); // 沙箱 iframe 里点链接会在 iframe 内导航，必须拦住
    f.listen('dragstart', (ev) => ev.preventDefault());
    f.listen('selectionchange', () => this.e.selection.onNativeChange(f));
    void d;
  }

  // ───────────── 指针 ─────────────
  private slop(p: Ptr): number {
    return p.type === 'mouse' ? MOUSE_SLOP : SLOP;
  }

  private down(ev: PointerEvent, pt: { x: number; y: number }, frame?: ChapterFrame): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const e = this.e;
    const cs = controlSettings.get();
    this.stopFling();
    const p: Ptr = {
      id: ev.pointerId,
      type: ev.pointerType,
      x0: pt.x,
      y0: pt.y,
      t0: ev.timeStamp,
      x: pt.x,
      y: pt.y,
      frame,
      target: ev.target as Element | null,
      hadSelection: !!e.selection.get(),
      samples: [{ t: ev.timeStamp, x: pt.x, y: pt.y }],
    };
    if (this.ptrs.size === 0) {
      // 防边缘误触（VIEW-018）：整个触摸序列忽略
      if (cs.disableEdgeTouch && ev.pointerType !== 'mouse' && this.inEdgeBand(pt)) {
        this.mode = 'ignore';
        this.ptrs.set(p.id, p);
        return;
      }
      this.mode = e.autoscroll.engaged ? 'auto' : 'pending';
      this.edgeStartX = pt.x;
      this.edgeStartY = pt.y;
      // 点击正文即把焦点给阅读区，键盘事件才能收到
      if (ev.pointerType === 'mouse') e.root?.focus({ preventScroll: true });
    } else if (this.mode !== 'ignore') {
      // 第二指：双指缩放（CTRL-006）
      clearTimeout(this.longTimer);
      if (cs.multTouch) {
        const [a] = [...this.ptrs.values()];
        this.pinch0 = Math.hypot(a.x - pt.x, a.y - pt.y) || 1;
        this.mode = 'pinch';
        e.animator.cancelDrag();
      }
    }
    this.ptrs.set(p.id, p);
    if (this.ptrs.size === 1 && this.mode === 'pending') {
      // 鼠标的长按只用于图片（长按看图，longTapImageFullScreen）：文字上按住拖动是原生选择，不能抢
      const onImage = !!(ev.target as Element | null)?.closest?.('img,image,svg');
      if (ev.pointerType !== 'mouse' || onImage) {
        this.longTimer = setTimeout(() => this.longPress(p), Math.max(50, cs.longTapInterval * 1000));
      }
    }
    if (this.mode === 'auto') e.autoscroll.touchStart(pt.x, pt.y);
  }

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
      case 'pinch': {
        const [a, b] = [...this.ptrs.values()];
        if (a && b) {
          const scale = Math.hypot(a.x - b.x, a.y - b.y) / this.pinch0;
          e.emit('pinch', { scale, phase: 'move' });
        }
        return;
      }
      case 'auto':
        e.autoscroll.touchMove(dx, dy, pt.x, pt.y);
        return;
      case 'scroll':
        e.scrollBy(-dy0);
        return;
      case 'flip':
        e.animator.dragMove(dx, dy, pt.x, pt.y);
        return;
      case 'edge':
        e.emit('verticalDrag', { startX: this.edgeStartX, dy, phase: 'move' });
        return;
      case 'edgeH':
        e.emit('verticalDrag', { startX: this.edgeStartX, startY: this.edgeStartY, dy: dx, axis: 'x', phase: 'move' });
        return;
      case 'pending':
        break;
      default:
        return;
    }
    // pending：超过阈值后定方向
    if (Math.hypot(dx, dy) < this.slop(p)) return;
    clearTimeout(this.longTimer);
    if (p.type === 'mouse') {
      this.mode = 'native';
      return;
    }
    this.decideDrag(p, dx, dy);
  }

  private decideDrag(p: Ptr, dx: number, dy: number): void {
    const e = this.e;
    const cs = controlSettings.get();
    const fs = flipSettings.get();
    const vertical = Math.abs(dy) > Math.abs(dx);
    // 边缘竖滑：亮度 / 字号
    if (vertical && this.inSlideEdge(p.x0)) {
      this.mode = 'edge';
      this.edgeStartX = p.x0;
      e.emit('verticalDrag', { startX: p.x0, dy, phase: 'move' });
      return;
    }
    // 上/下边沿横向擦动（亮度/字号边选了上或下时）
    if (!vertical && this.inSlideEdgeH(p.y0)) {
      this.mode = 'edgeH';
      this.edgeStartX = p.x0;
      this.edgeStartY = p.y0;
      e.emit('verticalDrag', { startX: p.x0, startY: p.y0, dy: dx, axis: 'x', phase: 'move' });
      return;
    }
    if (e.mode === 'scroll') {
      if (vertical && !fs.disableMove) {
        this.mode = 'scroll';
        e.scrollBy(-dy); // 把起手到现在的位移补上
      } else if (!vertical && fs.allowScrollHorizontally) this.mode = 'hswipe';
      else this.mode = 'vswipe';
      return;
    }
    const anim = fs.flipAnimation;
    if ((anim === 1 || anim === 2 || anim === 3 || anim === 6) && !vertical && !fs.disableMove) {
      this.mode = 'flip';
      void e.animator.dragBegin(dx < 0 ? 1 : -1, p.x0, p.y0);
      e.animator.dragMove(dx, dy, p.x, p.y);
      return;
    }
    this.mode = vertical ? 'vswipe' : 'hswipe';
    void cs;
  }

  private cancel(ev: PointerEvent): void {
    const p = this.ptrs.get(ev.pointerId);
    if (!p) return;
    clearTimeout(this.longTimer);
    if (this.mode === 'flip') this.e.animator.dragEnd(0, 0, true);
    if (this.mode === 'edge') this.e.emit('verticalDrag', { startX: this.edgeStartX, dy: p.y - p.y0, phase: 'end' });
    if (this.mode === 'edgeH') this.e.emit('verticalDrag', { startX: this.edgeStartX, startY: this.edgeStartY, dy: p.x - p.x0, axis: 'x', phase: 'end' });
    if (this.mode === 'scroll') this.e.emitRelocate(true);
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
    if (this.ptrs.size > 0 && mode !== 'pinch') return;
    if (mode === 'pinch') {
      if (this.ptrs.size <= 1) {
        e.emit('pinch', { scale: 1, phase: 'end' });
        this.mode = 'ignore';
      }
      if (this.ptrs.size === 0) this.mode = 'pending';
      return;
    }
    this.mode = 'pending';
    switch (mode) {
      case 'ignore':
        return;
      case 'auto':
        e.autoscroll.touchEnd(dx, dy, dur);
        return;
      case 'longpressed':
        return;
      case 'native':
        // 鼠标拖选：选区由 selectionchange 上报
        return;
      case 'scroll':
        this.startFling(-vy);
        this.maybeSwipe(p, dx, dy, false);
        return;
      case 'flip':
        e.animator.dragEnd(vx, vy, false);
        return;
      case 'edge':
        e.emit('verticalDrag', { startX: this.edgeStartX, dy, phase: 'end' });
        return;
      case 'edgeH':
        e.emit('verticalDrag', { startX: this.edgeStartX, startY: this.edgeStartY, dy: dx, axis: 'x', phase: 'end' });
        return;
      case 'hswipe':
      case 'vswipe': {
        const consumed = this.shiftGesture(dx, dy, vx, vy);
        if (!consumed) this.maybeSwipe(p, dx, dy, true);
        return;
      }
      case 'pending':
        break;
    }
    if (dur < TAP_MAX_MS && Math.hypot(dx, dy) < this.slop(p)) this.tap(p, ev, pt);
  }

  /** 横划/竖划翻页（ANIM-010 / isShiftGesture）。返回是否已用于翻页 */
  private shiftGesture(dx: number, dy: number, vx: number, vy: number): boolean {
    const e = this.e;
    const fs = flipSettings.get();
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    let dir: 1 | -1 | 0 = 0;
    let anim = e.mode === 'paged' ? fs.flipAnimation : fs.horiFlingAnimation;
    if (e.mode === 'scroll') {
      if (fs.allowScrollHorizontally && Math.abs(vx) > 600 && adx > ady && ady < 40) dir = dx < 0 ? 1 : -1;
    } else if (anim === 4 || anim === 5 || anim === 7) {
      if (ady > 20 && adx < 40) dir = dy < 0 ? 1 : -1;
      else if (fs.allowScrollHorizontally && Math.abs(vx) > 600 && ady < 40 && adx > ady) dir = dx < 0 ? 1 : -1;
    } else if (fs.allowScrollHorizontally && adx > 30 && adx > ady * 1.2) {
      dir = dx < 0 ? 1 : -1;
    }
    if (!dir) return false;
    if (e.mode === 'paged' && fs.disableMove && (anim === 4 || anim === 7)) return false;
    void e.turn(dir, { animation: anim });
    return true;
  }

  /** CTRL-004：大幅划动手势 */
  private maybeSwipe(p: Ptr, dx: number, dy: number, _horizontalCandidate: boolean): void {
    const e = this.e;
    const W = e.boxW;
    const H = e.boxH;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    let dir: 'left' | 'right' | 'up' | 'down' | null = null;
    if (adx > Math.min(W / 2, 400) && ady < 120) dir = dx > 0 ? 'right' : 'left';
    else if (ady > Math.min(H / 2, 400) && adx < 120) dir = dy > 0 ? 'down' : 'up';
    if (!dir) return;
    const edge = p.x0 < EDGE_ZONE ? 'left' : p.x0 > W - EDGE_ZONE ? 'right' : p.y0 < EDGE_ZONE ? 'top' : p.y0 > H - EDGE_ZONE ? 'bottom' : undefined;
    e.emit('swipe', { dir, startX: p.x0 / W, startY: p.y0 / H, dist: Math.hypot(dx, dy), edge });
  }

  // ───────────── 点击 / 长按 ─────────────
  private norm(pt: { x: number; y: number }): { x: number; y: number } {
    return { x: pt.x / Math.max(1, this.e.boxW), y: pt.y / Math.max(1, this.e.boxH) };
  }

  /** 命中链接/图片/装饰则返回 true（已派发对应事件，调用方不再派 tap） */
  private hit(p: Ptr, pt: { x: number; y: number }, long: boolean): boolean {
    const e = this.e;
    const f = p.frame;
    const t = p.target;
    if (f && t && t.closest) {
      const a = t.closest('a[href]');
      if (a && !long) {
        void e.followLink(f, a);
        return true;
      }
      const img = t.closest('img,image,svg');
      if (img && (img.tagName.toLowerCase() === 'img' || img.tagName.toLowerCase() === 'image' || img.querySelector('image'))) {
        // 原版（ActivityTxt.doLongTimeTapEvent）：单击图片 = 普通点击（翻页/呼出菜单），长按才全屏看图（longTapImageFullScreen，默认开）。
        // 整页大图（封面、漫画页）上单击若直接看图，就没法点击翻页了。该项关掉后改为单击看图，否则图片就打不开了
        if (long === e.imageLongTap()) {
          e.openImage(f, img);
          return true;
        }
      }
      const caret = caretAt(f.doc, pt.x - (e.toRoot(f, 0, 0).x), pt.y - e.toRoot(f, 0, 0).y);
      if (caret && caret.node.nodeType === 3) {
        const off = f.text.offsetOfText(caret.node as Text, caret.offset);
        const d = off >= 0 ? e.decorations.hit(f, off) : null;
        if (d) {
          e.emit('decorationClick', { layer: d.layer, id: d.id, rect: e.decorations.rectOfDecoration(f, d) });
          return true;
        }
      }
    }
    return false;
  }

  /** 鼠标点的位置是否正好在某个字上（点空白处 caret 也会吸附到最近的文字，所以还要核对字符矩形） */
  private onGlyph(p: Ptr, pt: { x: number; y: number }): boolean {
    const f = p.frame;
    if (!f) return false;
    const o = this.e.toRoot(f, 0, 0);
    const x = pt.x - o.x;
    const y = pt.y - o.y;
    const c = caretAt(f.doc, x, y);
    if (!c || c.node.nodeType !== 3) return false;
    const len = c.node.nodeValue?.length ?? 0;
    const r = f.doc.createRange();
    try {
      r.setStart(c.node, Math.max(0, c.offset - 1));
      r.setEnd(c.node, Math.min(len, c.offset + 1));
    } catch {
      return false;
    }
    return [...r.getClientRects()].some((b) => x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1);
  }

  private tap(p: Ptr, ev: PointerEvent, pt: { x: number; y: number }): void {
    const e = this.e;
    // 鼠标点击间隔用墙钟：ev.timeStamp 相对于事件所在文档的 timeOrigin，两次点击落在不同 iframe 里时不可比
    const now = p.type === 'mouse' ? Date.now() : ev.timeStamp;
    if (p.type !== 'mouse') {
      // 触屏：有选区时的点击只用来取消选择
      if (e.selection.get()) {
        e.selection.set(null);
        return;
      }
    } else {
      // 鼠标：双击/三击落在文字上是原生选词/选段，不能顺带触发点击区动作（翻页、呼出菜单）
      const glyph = this.onGlyph(p, pt);
      const near = Math.hypot(pt.x - this.lastMouseClick.x, pt.y - this.lastMouseClick.y) < 6;
      const multi = glyph && near && now - this.lastMouseClick.t < DOUBLE_TAP_MS;
      this.lastMouseClick = { t: now, x: pt.x, y: pt.y };
      clearTimeout(this.pendingTap);
      this.pendingTap = undefined;
      if (multi) {
        if (p.frame) e.selection.fixNativeWord(p.frame, pt.x, pt.y);
        e.emit('doubleTap', this.norm(pt));
        return;
      }
      // 按下时有选区：这次点击只用来取消选择（原生行为在 mousedown 时已把选区清掉，抬起时看不出来了）
      if (p.hadSelection) {
        e.selection.set(null);
        return;
      }
      if (this.hit(p, pt, false)) return;
      const n = this.norm(pt);
      if (glyph) {
        // 点在字上：等一个双击窗口，没有第二次点击才算单击
        this.pendingTap = setTimeout(() => {
          this.pendingTap = undefined;
          e.emit('tap', n);
        }, DOUBLE_TAP_MS);
      } else e.emit('tap', n);
      return;
    }
    if (this.hit(p, pt, false)) return;
    const n = this.norm(pt);
    e.emit('tap', n);
    if (now - this.lastTap.t < DOUBLE_TAP_MS && Math.hypot(pt.x - this.lastTap.x, pt.y - this.lastTap.y) < 30) {
      e.emit('doubleTap', n);
      this.lastTap.t = 0;
    } else {
      this.lastTap = { t: now, x: pt.x, y: pt.y };
    }
  }

  private longPress(p: Ptr): void {
    if (this.mode !== 'pending' || !this.ptrs.has(p.id)) return;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) >= SLOP) return;
    const e = this.e;
    this.mode = 'longpressed';
    const pt = { x: p.x, y: p.y };
    if (this.hit(p, pt, true)) return;
    if (p.frame && e.selection.selectWordAt(p.frame, pt.x, pt.y)) return;
    e.emit('longPress', this.norm(pt));
  }

  // ───────────── 边缘 ─────────────
  private inEdgeBand(pt: { x: number; y: number }): boolean {
    const c = controlSettings.get();
    return pt.x < c.leftEdge || pt.x > this.e.boxW - c.rightEdge || pt.y < c.topEdge || pt.y > this.e.boxH - c.bottomEdge;
  }

  /** 起点是否落在亮度/字号的竖滑区（左/右边沿） */
  private inSlideEdge(x0: number): boolean {
    const c = controlSettings.get();
    const W = this.e.boxW;
    const inside = (edge: number) => (edge === 0 ? x0 < EDGE_ZONE : edge === 1 ? x0 > W - EDGE_ZONE : false);
    return (c.adjustBrightness && inside(c.brightnessEdge)) || (c.adjustFontSizeAtSlide && inside(c.fontsizeEdge));
  }

  /** 起点是否落在亮度/字号的横擦区（上/下边沿，原 brightness_edge/fontsize_edge = 2/3） */
  private inSlideEdgeH(y0: number): boolean {
    const c = controlSettings.get();
    const H = this.e.boxH;
    const inside = (edge: number) => (edge === 2 ? y0 < EDGE_ZONE : edge === 3 ? y0 > H - EDGE_ZONE : false);
    return (c.adjustBrightness && inside(c.brightnessEdge)) || (c.adjustFontSizeAtSlide && inside(c.fontsizeEdge));
  }

  // ───────────── 滚轮 ─────────────
  private wheel(ev: WheelEvent): void {
    if (ev.ctrlKey) return;
    ev.preventDefault();
    const e = this.e;
    const unit = ev.deltaMode === 1 ? 32 : ev.deltaMode === 2 ? e.H : 1;
    const dy = (ev.deltaY || ev.deltaX) * unit;
    if (e.autoscroll.running) return;
    if (e.mode === 'scroll') {
      e.scrollBy(dy);
      return;
    }
    const now = ev.timeStamp;
    if (now < this.wheelLock) return;
    this.wheelAcc += dy;
    if (Math.abs(this.wheelAcc) > 40) {
      const dir = this.wheelAcc > 0 ? 1 : -1;
      this.wheelAcc = 0;
      this.wheelLock = now + 220;
      void e.turn(dir);
    }
  }

  // ───────────── 惯性滚动（ANIM-002） ─────────────
  startFling(v: number): void {
    this.stopFling();
    if (Math.abs(v) < FLING_MIN_SPEED || this.e.mode !== 'scroll') {
      this.e.emitRelocate(true);
      return;
    }
    // 估算距离超过整章高度一半则限速（原 MySimpleGesture.onFling）
    const f = this.e.frames.get(this.e.pos.section);
    const maxDist = f ? f.height / 2 : Infinity;
    const dist = (v * v) / (2 * DECEL);
    if (dist > maxDist) v = Math.sign(v) * Math.sqrt(2 * DECEL * maxDist);
    let vel = v;
    this.lastScrollT = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - this.lastScrollT) / 1000);
      this.lastScrollT = now;
      const dec = DECEL * dt * Math.sign(vel);
      const nv = Math.abs(dec) >= Math.abs(vel) ? 0 : vel - dec;
      const moved = this.e.scrollBy(((vel + nv) / 2) * dt);
      vel = nv;
      if (Math.abs(vel) < 8 || (moved === 0 && Math.abs(vel) > 8 && this.hitEnd())) {
        this.flingRaf = 0;
        this.e.emitRelocate(true);
        return;
      }
      this.flingRaf = requestAnimationFrame(step);
    };
    this.flingRaf = requestAnimationFrame(step);
  }

  private hitEnd(): boolean {
    return true;
  }

  stopFling(): void {
    if (this.flingRaf) cancelAnimationFrame(this.flingRaf);
    this.flingRaf = 0;
  }
}
