// 固定版式引擎（PDF / 漫画，PDF-002/006/007/008、COMIC-003）：实现 core/reader.ts 的 ReaderController。
// 视图：单页（可双页跨页，封面单独）与竖向连续滚动；适合 整页/宽度/高度；双指缩放、平移、双击缩放；
// PDF 夜间反色、页边色、漫画右到左；翻页动画复用整屏纹理翻页（texflip.ts）。
// 页面位图由 FixedBook.renderPage 提供，引擎只管排布、缓存（按密度分档重绘，缩放后补高清）与交互。
// 位置模型：Locator.section = 页下标，offset = 0（连续滚动时也只记页）。文字选择/装饰基于 getPageText 的文字块。
import type { FixedBook, FixedPageText, Locator, TextRange } from '@/core/book';
import { Emitter } from '@/core/emitter';
import type { Decoration, GoToTarget, ReaderController, ReaderEvents, ReaderLocation, ReaderSelection } from '@/core/reader';
import { autoScrollSettings, fixedSettings, screenSettings } from '../settings';
import { Animator, type FlipHost, type FlipPlan } from './animator';
import { DECO_DEFAULT_COLOR } from './decorations';
import {
  clamp,
  clampPan,
  fitScale,
  layoutSpread,
  nextSpreadStart,
  prevSpreadStart,
  rectsForRange,
  renderDensity,
  spreadIndices,
  spreadStart,
  StripLayout,
  wordAt,
  zoomAbout,
  type FitMode,
  type NRect,
  type Size,
  type SpreadLayout,
} from './fixed-layout';
import { FixedInput } from './fixed-input';
import { newScreenCanvas, textureFlip } from './texflip';
import { pageThreshold, pixelsPerSecond } from './autoscroll';

const MAX_ZOOM = 5;
/** 缩放档：位图密度按档位分级，避免连续缩放时反复重绘 */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 5];
const COMIC = new Set(['cbz', 'cbr', 'cb7']);

interface Master {
  src: CanvasImageSource;
  w: number;
  h: number;
  density: number;
  close?: () => void;
}

export interface PageView {
  index: number;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  deco: HTMLDivElement;
  x: number;
  y: number;
  w: number;
  h: number;
  renderedD: number;
  token: number;
}

type Mode = 'single' | 'continuous';

const stepUp = (z: number) => ZOOM_STEPS.find((s) => s >= z - 1e-6) ?? MAX_ZOOM;

export class FixedEngine implements ReaderController, FlipHost {
  readonly book: FixedBook;
  private em = new Emitter<{ [K in keyof ReaderEvents]: ReaderEvents[K] }>();
  root!: HTMLDivElement;
  private container?: HTMLElement;
  private layer!: HTMLDivElement;
  boxW = 0;
  boxH = 0;
  turning = false;
  animator: Animator;
  input!: FixedInput;
  private destroyed = false;
  private epoch = 0;
  private ro?: ResizeObserver;
  private unsubs: Array<() => void> = [];
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private hiresTimer?: ReturnType<typeof setTimeout>;
  private relocateTimer?: ReturnType<typeof setTimeout>;
  private lastLoc: ReaderLocation | null = null;
  private snap = this.snapshot();

  // ── 视图状态 ──
  /** 单页：当前跨页的首页；连续：视口中线所在页 */
  page = 0;
  z = 1;
  /** 单页：整组的屏幕平移（含居中） */
  tx = 0;
  ty = 0;
  gw = 0;
  gh = 0;
  /** 连续：视口左上角在「世界」（宽 = 屏宽）里的坐标 */
  sy = 0;
  cx = 0;
  private group?: HTMLDivElement;
  private world?: HTMLDivElement;
  private strip?: StripLayout;
  views = new Map<number, PageView>();
  private layoutSlots?: SpreadLayout;

  // ── 数据缓存 ──
  private sizes = new Map<number, Promise<Size>>();
  private sizeNow = new Map<number, Size>();
  private masters = new Map<string, Promise<Master>>();
  private texts = new Map<number, Promise<FixedPageText | null>>();
  private textNow = new Map<number, FixedPageText | null>();
  private decos = new Map<string, Decoration[]>();
  private selRange: TextRange | null = null;
  private selFlashTimer?: ReturnType<typeof setTimeout>;

  // ── 自动滚屏 ──
  private auto?: { raf: number; last: number; count: number; paused: boolean };

  constructor(book: FixedBook) {
    this.book = book;
    this.animator = new Animator(this);
  }

  // ───────────── 设置 ─────────────
  private snapshot() {
    return { fixed: fixedSettings.get(), dual: screenSettings.get().dualPage };
  }

  get isComic(): boolean {
    return COMIC.has(this.book.format);
  }

  get rtl(): boolean {
    return this.isComic && (fixedSettings.get().comicRtl || this.book.metadata.direction === 'rtl');
  }

  get night(): boolean {
    return fixedSettings.get().pdfTheme === 1;
  }

  /** 页边色：PDF 用 pdfBackColor，漫画 cbzBackColor；夜间 PDF 取反，漫画/DJVU 纯黑（PDF-007） */
  marginColor(): string {
    const f = fixedSettings.get();
    if (!this.night) return this.isComic ? f.cbzBackColor : f.pdfBackColor;
    return this.book.format === 'pdf' ? invertHex(f.pdfBackColor) : '#000000';
  }

  get mode(): Mode {
    const v = fixedSettings.get().pdfViewMode;
    if (v === 2) return 'continuous';
    if (v === 1) return 'single';
    // 自动：横屏连续、竖屏逐页（PDF-002）；长条漫画（页面远高于宽）也连续
    if (this.isComic && this.stripLike()) return 'continuous';
    return this.boxW > this.boxH ? 'continuous' : 'single';
  }

  private stripLike(): boolean {
    const s = this.sizeNow.get(0);
    return !!s && s.height / s.width > 2.4;
  }

  /** 双页并排：仅单页视图，且屏幕设置允许 */
  get dual(): boolean {
    if (this.mode !== 'single') return false;
    const d = screenSettings.get().dualPage;
    if (d === 'on') return this.boxW >= 600;
    return d === 'auto' && this.boxW >= 900 && this.boxW > this.boxH;
  }

  get fit(): FitMode {
    return fixedSettings.get().fitMode;
  }

  private dpr(): number {
    return Math.min(3, window.devicePixelRatio || 1);
  }

  // ───────────── 事件 ─────────────
  on<K extends keyof ReaderEvents>(type: K, fn: (payload: ReaderEvents[K]) => void): () => void {
    return this.em.on(type, fn);
  }
  emit<K extends keyof ReaderEvents>(type: K, payload: ReaderEvents[K]): void {
    this.em.emit(type, payload);
  }

  // ───────────── 生命周期 ─────────────
  async open(container: HTMLElement, at?: Locator): Promise<void> {
    this.container = container;
    const root = (this.root = document.createElement('div'));
    root.className = 'mr-reader mr-fixed';
    Object.assign(root.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      userSelect: 'none',
      touchAction: 'none',
      outline: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    root.tabIndex = 0;
    this.layer = document.createElement('div');
    this.layer.style.cssText = 'position:absolute;inset:0;overflow:hidden';
    root.appendChild(this.layer);
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(root);
    this.input = new FixedInput(this);
    this.input.attach(root);
    await this.measureBox();
    this.applyColors();
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(container);
    this.unsubs.push(
      fixedSettings.subscribe(() => this.scheduleRefresh()),
      screenSettings.subscribe(() => this.scheduleRefresh()),
    );
    try {
      if (this.book.pageCount > 0) {
        // 先量首页尺寸：自动视图要靠它判断是不是长条漫画
        await this.sizeOf(0);
        await this.rebuild(at?.section ?? 0);
      }
    } catch (e) {
      this.emit('error', e as Error);
      throw e;
    }
    if (autoScrollSettings.get().startAutoScroll) this.startAutoScroll();
  }

  destroy(): void {
    this.destroyed = true;
    this.epoch++;
    if (this.auto) cancelAnimationFrame(this.auto.raf);
    this.auto = undefined;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.hiresTimer);
    clearTimeout(this.relocateTimer);
    clearTimeout(this.selFlashTimer);
    this.ro?.disconnect();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.animator.destroy();
    this.input?.destroy();
    for (const p of this.masters.values()) void p.then((m) => m.close?.(), () => undefined);
    this.masters.clear();
    this.views.clear();
    this.root?.remove();
    this.em.clear();
  }

  private async measureBox(): Promise<void> {
    const c = this.container!;
    for (let i = 0; i < 60 && (!c.clientWidth || !c.clientHeight); i++) await new Promise((r) => setTimeout(r, 50));
    this.boxW = c.clientWidth || 360;
    this.boxH = c.clientHeight || 640;
  }

  private onResize(): void {
    if (this.destroyed || !this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h || (w === this.boxW && h === this.boxH)) return;
    this.scheduleRefresh(true);
  }

  private scheduleRefresh(force = false): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(force), 80);
  }

  private async refresh(force: boolean): Promise<void> {
    if (this.destroyed || !this.container) return;
    const prev = this.snap;
    const next = this.snapshot();
    this.snap = next;
    const a = prev.fixed;
    const b = next.fixed;
    const sizeChanged = this.container.clientWidth !== this.boxW || this.container.clientHeight !== this.boxH;
    const layoutChanged =
      force ||
      sizeChanged ||
      a.pdfViewMode !== b.pdfViewMode ||
      a.fitMode !== b.fitMode ||
      a.fitDifferentPageSize !== b.fitDifferentPageSize ||
      a.comicRtl !== b.comicRtl ||
      prev.dual !== next.dual;
    if (layoutChanged) {
      if (sizeChanged) {
        this.boxW = this.container.clientWidth;
        this.boxH = this.container.clientHeight;
      }
      await this.rebuild(this.page);
      return;
    }
    if (a.pdfRenderQuality !== b.pdfRenderQuality) {
      this.masters.clear();
      for (const v of this.views.values()) v.renderedD = 0;
      this.renderVisible();
    }
    if (a.pdfBackColor !== b.pdfBackColor || a.cbzBackColor !== b.cbzBackColor || a.pdfTheme !== b.pdfTheme || a.cbzSmooth !== b.cbzSmooth) this.applyColors();
  }

  /** 页边色、夜间反色、平滑缩放：只改样式，不重排 */
  applyColors(): void {
    if (!this.root) return;
    this.root.style.background = this.marginColor();
    const night = this.night;
    const smooth = fixedSettings.get().cbzSmooth;
    for (const v of this.views.values()) this.styleView(v, night, smooth);
  }

  private styleView(v: PageView, night = this.night, smooth = fixedSettings.get().cbzSmooth): void {
    v.canvas.style.filter = night && this.book.format === 'pdf' ? 'invert(1) hue-rotate(180deg)' : night ? 'brightness(.85)' : '';
    v.canvas.style.imageRendering = this.isComic && !smooth ? 'pixelated' : 'auto';
    v.el.style.background = this.isComic ? 'transparent' : night ? '#111' : '#fff';
  }

  // ───────────── 页尺寸、位图、文字 ─────────────
  sizeOf(i: number): Promise<Size> {
    let p = this.sizes.get(i);
    if (!p) {
      p = this.book.getPageSize(i).then(
        (s) => {
          const v = { width: Math.max(1, s.width), height: Math.max(1, s.height) };
          this.sizeNow.set(i, v);
          return v;
        },
        () => {
          const v = this.sizeNow.get(0) ?? { width: 595, height: 842 };
          this.sizeNow.set(i, v);
          return v;
        },
      );
      this.sizes.set(i, p);
    }
    return p;
  }

  /** 页位图（主副本，不进 DOM）：按 CSS 尺寸 + 缩放档位生成，LRU 缓存 */
  bitmap(index: number, cssW: number, cssH: number, zoom: number): Promise<Master> {
    const quality = fixedSettings.get().pdfRenderQuality;
    const density = renderDensity(cssW, cssH, this.dpr(), quality, stepUp(zoom));
    const key = `${index}|${Math.round(cssW)}x${Math.round(cssH)}|${density.toFixed(2)}`;
    let p = this.masters.get(key);
    if (p) {
      // 刷新 LRU 位置
      this.masters.delete(key);
      this.masters.set(key, p);
      return p;
    }
    p = this.book
      .renderPage(index, { width: cssW, height: cssH, dpr: density })
      .then((src): Master => {
        const s = src as CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; close?: () => void };
        return { src, w: s.naturalWidth || (s.width as number) || 1, h: s.naturalHeight || (s.height as number) || 1, density, close: s.close?.bind(s) };
      });
    p.catch(() => this.masters.delete(key));
    this.masters.set(key, p);
    while (this.masters.size > 12) {
      const k = this.masters.keys().next().value as string;
      const old = this.masters.get(k)!;
      this.masters.delete(k);
      void old.then((m) => m.close?.(), () => undefined);
    }
    return p;
  }

  textOf(i: number): Promise<FixedPageText | null> {
    let p = this.texts.get(i);
    if (!p) {
      p = (this.book.getPageText?.(i) ?? Promise.resolve(null)).then(
        (t) => {
          this.textNow.set(i, t);
          return t;
        },
        () => {
          this.textNow.set(i, null);
          return null;
        },
      );
      this.texts.set(i, p);
      if (this.texts.size > 40) {
        const k = this.texts.keys().next().value as number;
        this.texts.delete(k);
        this.textNow.delete(k);
      }
    }
    return p;
  }

  textCached(i: number): FixedPageText | null | undefined {
    return this.textNow.get(i);
  }

  // ───────────── 视图构建 ─────────────
  private clearView(): void {
    this.epoch++;
    this.group?.remove();
    this.world?.remove();
    this.group = undefined;
    this.world = undefined;
    this.strip = undefined;
    this.layoutSlots = undefined;
    this.views.clear();
  }

  async rebuild(page: number): Promise<void> {
    if (this.destroyed || !this.root) return;
    this.animator.cancel();
    this.root.style.background = this.marginColor();
    // 先量首页，让「自动」视图判断得到长条漫画
    await this.sizeOf(0);
    if (this.destroyed) return;
    const p = clamp(page, 0, Math.max(0, this.book.pageCount - 1));
    if (this.mode === 'continuous') await this.buildStrip(p);
    else await this.showSpread(p);
  }

  /** 单页/跨页视图：以 start 所在跨页为当前屏 */
  private showSeq = 0;
  async showSpread(page: number, opts: { atBottom?: boolean } = {}): Promise<void> {
    const count = this.book.pageCount;
    if (!count) return;
    const seq = ++this.showSeq; // 并发调用（快速连点、重排与翻页撞车）时只认最后一次
    const dual = this.dual;
    const start = spreadStart(page, dual, count);
    const idx = spreadIndices(start, dual, count);
    const sizes = await Promise.all(idx.map((i) => this.sizeOf(i)));
    const lay = layoutSpread(idx, sizes, this.rtl, this.fit, this.boxW, this.boxH);
    // 位图都到位再换屏，翻页时不闪空白
    const masters = await Promise.all(lay.slots.map((s) => this.bitmap(s.index, s.w, s.h, 1)));
    if (this.destroyed || seq !== this.showSeq) return;
    this.clearView();
    const g = (this.group = document.createElement('div'));
    g.style.cssText = `position:absolute;left:0;top:0;width:${lay.gw}px;height:${lay.gh}px;transform-origin:0 0;will-change:transform`;
    this.layer.appendChild(g);
    this.layoutSlots = lay;
    this.gw = lay.gw;
    this.gh = lay.gh;
    this.page = start;
    this.z = 1;
    const c = clampPan(1, this.boxW, this.boxH, lay.gw, lay.gh, 0, opts.atBottom ? -Infinity : 0);
    this.tx = c.tx;
    this.ty = c.ty;
    lay.slots.forEach((s, k) => {
      const v = this.makeView(s.index, s.x, s.y, s.w, s.h);
      g.appendChild(v.el);
      this.paint(v, masters[k]);
      this.views.set(s.index, v);
    });
    this.applyTransform();
    void this.paintAllDecos();
    this.emitRelocate(true);
    setTimeout(() => this.prefetch(), 60);
  }

  private makeView(index: number, x: number, y: number, w: number, h: number): PageView {
    const el = document.createElement('div');
    el.className = 'mr-fx-page';
    el.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;box-shadow:${this.isComic ? 'none' : '0 0 5px rgba(0,0,0,.35)'}`;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;display:block`;
    const deco = document.createElement('div');
    deco.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    el.append(canvas, deco);
    const v: PageView = { index, el, canvas, deco, x, y, w, h, renderedD: 0, token: 0 };
    this.styleView(v);
    return v;
  }

  private paint(v: PageView, m: Master): void {
    const c = v.canvas;
    if (c.width !== m.w || c.height !== m.h) {
      c.width = m.w;
      c.height = m.h;
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(m.src, 0, 0, c.width, c.height);
    v.renderedD = m.density;
  }

  /** 空闲时预取相邻跨页的位图 */
  private prefetch(): void {
    if (this.destroyed || this.mode !== 'single') return;
    const dual = this.dual;
    const count = this.book.pageCount;
    for (const s of [nextSpreadStart(this.page, dual, count), prevSpreadStart(this.page, dual, count)]) {
      if (s === null) continue;
      const idx = spreadIndices(spreadStart(s, dual, count), dual, count);
      void Promise.all(idx.map((i) => this.sizeOf(i))).then((sizes) => {
        const lay = layoutSpread(idx, sizes, this.rtl, this.fit, this.boxW, this.boxH);
        for (const sl of lay.slots) void this.bitmap(sl.index, sl.w, sl.h, 1).catch(() => undefined);
      });
    }
  }

  /** 连续滚动视图：以 page 为视口顶 */
  private async buildStrip(page: number): Promise<void> {
    const count = this.book.pageCount;
    const comic = this.isComic;
    const strip = new StripLayout(count, this.boxW, fixedSettings.get().fitDifferentPageSize, comic ? 0 : 8);
    const seq = ++this.showSeq;
    const first = await this.sizeOf(page);
    strip.setSize(page, first);
    const s0 = this.sizeNow.get(0);
    if (s0) strip.setSize(0, s0);
    if (this.destroyed || seq !== this.showSeq) return;
    this.clearView();
    this.strip = strip;
    const w = (this.world = document.createElement('div'));
    w.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;will-change:transform';
    this.layer.appendChild(w);
    this.z = 1;
    this.cx = 0;
    this.sy = strip.top(page);
    this.page = page;
    this.applyTransform();
    this.mountVisible();
    this.emitRelocate(true);
  }

  // ───────────── 变换 ─────────────
  applyTransform(): void {
    if (this.group) this.group.style.transform = `translate3d(${this.tx}px,${this.ty}px,0) scale(${this.z})`;
    if (this.world) this.world.style.transform = `scale(${this.z}) translate(${-this.cx}px,${-this.sy}px)`;
  }

  private clampStrip(): void {
    const strip = this.strip;
    if (!strip) return;
    const maxSy = Math.max(0, strip.total() - this.boxH / this.z);
    this.sy = clamp(this.sy, 0, maxSy);
    const maxCx = Math.max(0, this.boxW - this.boxW / this.z);
    this.cx = fixedSettings.get().pdfScrollLock ? maxCx / 2 : clamp(this.cx, 0, maxCx);
  }

  /** 平移（屏幕像素）。返回被夹取吃掉的位移，用于「拖到边缘再拖就翻页」的判定 */
  panBy(dx: number, dy: number): { ox: number; oy: number } {
    if (this.strip) {
      this.cx -= dx / this.z;
      this.sy -= dy / this.z;
      const wantCx = this.cx;
      const wantSy = this.sy;
      this.clampStrip();
      this.applyTransform();
      this.mountVisible();
      this.updateCurrentPage();
      this.emitRelocate(false);
      return { ox: -(wantCx - this.cx) * this.z, oy: -(wantSy - this.sy) * this.z };
    }
    if (!this.group) return { ox: 0, oy: 0 };
    const wantX = this.tx + dx;
    const wantY = this.ty + dy;
    const c = clampPan(this.z, this.boxW, this.boxH, this.gw, this.gh, wantX, wantY);
    this.tx = c.tx;
    this.ty = c.ty;
    this.applyTransform();
    return { ox: wantX - c.tx, oy: wantY - c.ty };
  }

  /** 以屏幕点为不动点缩放到 z（夹在 1..MAX_ZOOM） */
  zoomTo(z1: number, fx: number, fy: number): void {
    const z0 = this.z;
    z1 = clamp(z1, 1, MAX_ZOOM);
    if (Math.abs(z1 - z0) < 1e-4) return;
    if (this.strip) {
      const wx = this.cx + fx / z0;
      const wy = this.sy + fy / z0;
      this.z = z1;
      this.cx = wx - fx / z1;
      this.sy = wy - fy / z1;
      this.clampStrip();
      this.applyTransform();
      this.mountVisible();
      this.updateCurrentPage();
    } else if (this.group) {
      const t = zoomAbout(this.tx, this.ty, z0, z1, fx, fy);
      this.z = z1;
      const c = clampPan(z1, this.boxW, this.boxH, this.gw, this.gh, t.tx, t.ty);
      this.tx = c.tx;
      this.ty = c.ty;
      this.applyTransform();
    }
    this.scheduleSettle();
  }

  get zoomed(): boolean {
    return this.z > 1.02;
  }

  /** 当前页的内容是否还能往某个方向平移（单页视图：页高大于屏高时先在页内滚动） */
  canPanY(dir: 1 | -1): boolean {
    if (this.strip) return dir > 0 ? this.sy < this.strip.total() - this.boxH / this.z - 0.5 : this.sy > 0.5;
    const ch = this.gh * this.z;
    if (ch <= this.boxH + 1) return false;
    return dir > 0 ? this.ty > this.boxH - ch + 0.5 : this.ty < -0.5;
  }

  get overflowX(): boolean {
    return !this.strip && this.gw * this.z > this.boxW + 1;
  }
  get overflowY(): boolean {
    return !this.strip && this.gh * this.z > this.boxH + 1;
  }

  /** 手势结束后：补高清、刷新位置 */
  scheduleSettle(): void {
    clearTimeout(this.hiresTimer);
    this.hiresTimer = setTimeout(() => this.renderVisible(), 160);
  }

  /** 缩放后补高清：当前密度档位与已绘制的不同就重绘 */
  private renderVisible(): void {
    for (const v of this.views.values()) void this.ensureRendered(v);
  }

  private async ensureRendered(v: PageView): Promise<void> {
    const want = renderDensity(v.w, v.h, this.dpr(), fixedSettings.get().pdfRenderQuality, stepUp(this.z));
    if (v.renderedD >= want - 0.01 && v.renderedD <= want * 1.01 + 0.01) return;
    const token = ++v.token;
    try {
      const m = await this.bitmap(v.index, v.w, v.h, this.z);
      if (token !== v.token || this.destroyed || this.views.get(v.index) !== v) return;
      this.paint(v, m);
    } catch {
      /* 渲染失败：保留旧图 */
    }
  }

  // ───────────── 连续滚动：挂载可见页 ─────────────
  private mountVisible(): void {
    const strip = this.strip;
    const world = this.world;
    if (!strip || !world) return;
    const span = this.boxH / this.z;
    const i0 = strip.indexAt(this.sy - span * 0.6);
    const i1 = strip.indexAt(this.sy + span * 1.6);
    for (const [i, v] of this.views) {
      if (i < i0 || i > i1) {
        v.token++;
        v.el.remove();
        this.views.delete(i);
      }
    }
    for (let i = i0; i <= i1; i++) {
      if (!this.sizeNow.has(i)) {
        void this.sizeOf(i).then((s) => this.learnSize(i, s));
      }
      let v = this.views.get(i);
      const x = strip.pageX(i);
      const y = strip.top(i);
      const w = strip.pageW(i);
      const h = strip.pageH(i);
      if (!v) {
        v = this.makeView(i, x, y, w, h);
        world.appendChild(v.el);
        this.views.set(i, v);
        void this.paintDecos(v);
      }
      this.placeView(v, x, y, w, h);
      void this.ensureRendered(v);
    }
  }

  private placeView(v: PageView, x: number, y: number, w: number, h: number): void {
    if (v.x === x && v.y === y && v.w === w && v.h === h) return;
    v.x = x;
    v.y = y;
    v.el.style.left = `${x}px`;
    v.el.style.top = `${y}px`;
    if (v.w !== w || v.h !== h) {
      v.w = w;
      v.h = h;
      v.el.style.width = `${w}px`;
      v.el.style.height = `${h}px`;
      v.canvas.style.width = `${w}px`;
      v.canvas.style.height = `${h}px`;
      v.renderedD = 0;
    }
  }

  /** 懒加载到真实页尺寸：布局变了就重排，并保持视口顶的位置不跳 */
  private learnSize(i: number, s: Size): void {
    const strip = this.strip;
    if (!strip || this.destroyed) return;
    const a = strip.indexAt(this.sy);
    const off = this.sy - strip.top(a);
    if (!strip.setSize(i, s)) return;
    this.sy = strip.top(a) + off;
    this.clampStrip();
    this.applyTransform();
    this.mountVisible();
  }

  private updateCurrentPage(): void {
    const strip = this.strip;
    if (!strip) return;
    this.page = strip.indexAt(this.sy + this.boxH / this.z / 2);
  }

  /** 连续滚动：滚到某页顶 */
  private scrollToPage(i: number): void {
    const strip = this.strip;
    if (!strip) return;
    this.sy = strip.top(i);
    this.clampStrip();
    this.applyTransform();
    this.mountVisible();
    this.updateCurrentPage();
    this.emitRelocate(true);
  }

  // ───────────── 位置信息 ─────────────
  private flatToc(): Array<{ title: string; section: number }> {
    const out: Array<{ title: string; section: number }> = [];
    const walk = (list: typeof this.book.toc) => {
      for (const e of list) {
        out.push({ title: e.title, section: e.section });
        if (e.children) walk(e.children);
      }
    };
    walk(this.book.toc);
    return out;
  }

  getLocation(): ReaderLocation | null {
    const n = this.book.pageCount;
    if (!n || !this.root || this.destroyed) return null;
    if (!this.views.size && !this.strip) return this.lastLoc;
    const page = this.page;
    const t = this.textNow.get(page);
    let title: string | undefined;
    for (const e of this.flatToc()) if (e.section <= page) title = e.title;
    let atEnd: boolean;
    let atStart: boolean;
    if (this.strip) {
      atStart = this.sy <= 0.5;
      atEnd = this.sy >= this.strip.total() - this.boxH / this.z - 0.5;
    } else {
      const idx = spreadIndices(this.page, this.dual, n);
      atStart = this.page === 0;
      atEnd = idx[idx.length - 1] >= n - 1;
    }
    const last = this.strip ? page : spreadIndices(page, this.dual, n).slice(-1)[0];
    const loc: ReaderLocation = {
      locator: { section: page, offset: 0 },
      progress: n > 1 ? clamp(last / (n - 1), 0, 1) : 0,
      section: page,
      sectionTitle: title,
      page: page + 1,
      pages: n,
      bookPage: page + 1,
      bookPages: n,
      visible: { section: page, start: 0, end: t?.text.length ?? 0 },
      atStart,
      atEnd,
    };
    return loc;
  }

  emitRelocate(immediate = false): void {
    if (this.destroyed) return;
    const fire = () => {
      this.relocateTimer = undefined;
      const loc = this.getLocation();
      if (loc) {
        this.lastLoc = loc;
        this.emit('relocate', loc);
      }
    };
    if (immediate) {
      clearTimeout(this.relocateTimer);
      fire();
    } else if (!this.relocateTimer) this.relocateTimer = setTimeout(fire, 100);
  }

  // ───────────── 翻页 ─────────────
  /** 逻辑方向（1 = 下一页）→ 动画方向（页面向左移为正）。右到左的漫画下一页从左边进来 */
  vis(dir: 1 | -1): 1 | -1 {
    return this.rtl ? ((-dir) as 1 | -1) : dir;
  }

  get pos() {
    return { section: this.page, y: 0 };
  }

  flipAnimation(): number {
    return this.zoomed || this.strip ? 0 : fixedSettings.get().flipPdf;
  }

  async targetOf(visDir: 1 | -1, from: { section: number; y: number }): Promise<{ section: number; y: number } | null> {
    const logical = this.rtl ? -visDir : visDir;
    const n = this.book.pageCount;
    const s = logical > 0 ? nextSpreadStart(from.section, this.dual, n) : prevSpreadStart(from.section, this.dual, n);
    return s === null ? null : { section: spreadStart(s, this.dual, n), y: 0 };
  }

  noTarget(visDir: 1 | -1): void {
    if ((this.rtl ? -visDir : visDir) > 0) this.emit('endOfBook', undefined);
  }

  fail(err: Error): void {
    this.emit('error', err);
  }

  restoreView(): void {
    /* 动画层盖在上面，撤掉即可见原视图 */
  }

  /** 当前屏幕内容 → 整屏纹理（含页边色、夜间反色、当前的缩放平移） */
  private captureScreen(): HTMLCanvasElement {
    const { canvas, ctx } = newScreenCanvas(this.boxW, this.boxH, Math.min(2, this.dpr()), this.marginColor());
    for (const v of this.views.values()) this.drawPage(ctx, v.canvas, this.tx + v.x * this.z, this.ty + v.y * this.z, v.w * this.z, v.h * this.z);
    return canvas;
  }

  private drawPage(ctx: CanvasRenderingContext2D, src: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    const night = this.night;
    const canFilter = 'filter' in ctx;
    if (night && this.book.format === 'pdf' && canFilter) ctx.filter = 'invert(1) hue-rotate(180deg)';
    else if (night && canFilter) ctx.filter = 'brightness(.85)';
    if (!this.isComic) {
      ctx.fillStyle = night && !canFilter ? '#111' : '#fff';
      ctx.fillRect(x, y, w, h);
    }
    ctx.drawImage(src, x, y, w, h);
    if (canFilter) ctx.filter = 'none';
  }

  /** 目标跨页（缩放 1、居中）→ 整屏纹理 */
  private async composeScreen(start: number): Promise<HTMLCanvasElement> {
    const n = this.book.pageCount;
    const idx = spreadIndices(spreadStart(start, this.dual, n), this.dual, n);
    const sizes = await Promise.all(idx.map((i) => this.sizeOf(i)));
    const lay = layoutSpread(idx, sizes, this.rtl, this.fit, this.boxW, this.boxH);
    const masters = await Promise.all(lay.slots.map((s) => this.bitmap(s.index, s.w, s.h, 1)));
    const { canvas, ctx } = newScreenCanvas(this.boxW, this.boxH, Math.min(2, this.dpr()), this.marginColor());
    const c = clampPan(1, this.boxW, this.boxH, lay.gw, lay.gh, 0, 0);
    lay.slots.forEach((s, k) => this.drawPage(ctx, masters[k].src, c.tx + s.x, c.ty + s.y, s.w, s.h));
    return canvas;
  }

  async prepareFlip(anim: number, dir: 1 | -1, from: { section: number; y: number }, target: { section: number; y: number }, click: boolean): Promise<FlipPlan | null> {
    void from;
    try {
      const texA = this.captureScreen();
      const texB = await this.composeScreen(target.section);
      return await textureFlip({ root: this.root, boxW: this.boxW, boxH: this.boxH }, anim, dir, texA, texB, click);
    } catch (e) {
      this.emit('error', e as Error);
      return null;
    }
  }

  async commitFlip(_plan: FlipPlan, target: { section: number; y: number }): Promise<void> {
    await this.showSpread(target.section);
  }

  /** 翻一页（逻辑方向）。单页内容比屏幕高（适合宽度）时先在页内滚动 */
  async turn(logical: 1 | -1, opts: { instant?: boolean; wholePage?: boolean } = {}): Promise<boolean> {
    if (this.turning || this.destroyed || !this.root) return false;
    if (this.strip) return this.scrollPage(logical);
    // 页内先滚：宽度适配的长页、放大后的页
    if (!opts.wholePage && this.canPanY(logical)) {
      const step = this.boxH * 0.9 * logical;
      this.panBy(0, -step);
      this.emitRelocate(true);
      return true;
    }
    this.turning = true;
    try {
      const vis = this.vis(logical);
      const from = { ...this.pos };
      const target = await this.targetOf(vis, from);
      if (!target) {
        this.noTarget(vis);
        return false;
      }
      const anim = opts.instant ? 0 : this.flipAnimation();
      if (anim && this.animator.supports(anim)) {
        const ok = await this.animator.run(vis, from, target, anim);
        if (ok) return true;
      }
      await this.showSpread(target.section, { atBottom: logical < 0 && this.fit === 'width' });
      return true;
    } finally {
      this.turning = false;
    }
  }

  /** 连续滚动：按「一屏」翻 */
  private scrollPage(logical: 1 | -1): boolean {
    if (!this.canPanY(logical)) {
      if (logical > 0) this.emit('endOfBook', undefined);
      return false;
    }
    this.panBy(0, -logical * this.boxH * 0.9);
    this.emitRelocate(true);
    return true;
  }

  async next(): Promise<void> {
    await this.turn(1);
  }
  async prev(): Promise<void> {
    await this.turn(-1);
  }

  async nextSection(): Promise<void> {
    await this.goPage(this.nextTocPage(1) ?? Math.min(this.book.pageCount - 1, this.page + 1));
  }
  async prevSection(): Promise<void> {
    await this.goPage(this.nextTocPage(-1) ?? Math.max(0, this.page - 1));
  }

  private nextTocPage(dir: 1 | -1): number | null {
    const pages = [...new Set(this.flatToc().map((e) => e.section))].sort((a, b) => a - b);
    const p = dir > 0 ? pages.find((x) => x > this.page) : [...pages].reverse().find((x) => x < this.page);
    return p ?? null;
  }

  async goPage(i: number): Promise<void> {
    if (!this.root || this.destroyed) return;
    this.animator.cancel();
    const p = clamp(Math.round(i), 0, Math.max(0, this.book.pageCount - 1));
    if (this.strip) {
      await this.sizeOf(p).then((s) => this.strip?.setSize(p, s));
      this.scrollToPage(p);
      return;
    }
    await this.showSpread(p);
  }

  async goTo(target: GoToTarget): Promise<void> {
    if ('href' in target) return;
    if ('progress' in target) {
      const n = this.book.pageCount;
      return this.goPage(Math.round(clamp(target.progress, 0, 1) * Math.max(0, n - 1)));
    }
    if ('range' in target) {
      await this.goPage(target.range.section);
      if (target.flash) this.flash(target.range);
      return;
    }
    return this.goPage(target.section);
  }

  async relayout(): Promise<void> {
    this.masters.clear();
    await this.rebuild(this.page);
  }

  // ───────────── 文本 ─────────────
  async getSectionText(section: number): Promise<string> {
    return (await this.textOf(section))?.text ?? '';
  }

  getSectionDocument(): Document | null {
    return null;
  }

  async getSectionTextWithBreaks(section: number): Promise<{ text: string; breaks: number[] }> {
    const text = (await this.textOf(section))?.text ?? '';
    const breaks: number[] = [];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n' && i + 1 < text.length) breaks.push(i + 1);
    return { text, breaks };
  }

  // ───────────── 装饰与选择 ─────────────
  setDecorations(layer: string, decorations: Decoration[]): void {
    if (decorations.length) this.decos.set(layer, decorations.slice());
    else this.decos.delete(layer);
    void this.paintAllDecos();
  }

  private flash(range: TextRange): void {
    clearTimeout(this.selFlashTimer);
    this.setDecorations('__flash', [{ id: 'flash', range, style: 'highlight', color: 'rgba(255,120,0,0.45)' }]);
    this.selFlashTimer = setTimeout(() => this.setDecorations('__flash', []), 1400);
  }

  private async paintAllDecos(): Promise<void> {
    await Promise.all([...this.views.values()].map((v) => this.paintDecos(v)));
  }

  private async paintDecos(v: PageView): Promise<void> {
    const all: Decoration[] = [];
    for (const list of this.decos.values()) for (const d of list) if (d.range.section === v.index) all.push(d);
    const sel = this.selRange && this.selRange.section === v.index ? this.selRange : null;
    if (!all.length && !sel) {
      v.deco.replaceChildren();
      return;
    }
    const t = await this.textOf(v.index);
    if (!t || this.views.get(v.index) !== v) return;
    const frag = document.createDocumentFragment();
    const draw = (style: Decoration['style'], color: string, range: TextRange) => {
      const rects = rectsForRange(t.items, range.start, range.end);
      rects.forEach((r, k) => {
        const el = document.createElement('div');
        const base = `position:absolute;left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%;box-sizing:border-box;`;
        switch (style) {
          case 'underline':
            el.style.cssText = `${base}border-bottom:2px solid ${color}`;
            break;
          case 'strikethrough':
            el.style.cssText = `${base}background:linear-gradient(${color},${color}) center/100% 2px no-repeat`;
            break;
          case 'squiggly':
            el.style.cssText = `${base}border-bottom:2px dotted ${color}`;
            break;
          case 'box':
            el.style.cssText = `${base}border:1.5px solid ${color};border-radius:3px`;
            break;
          case 'note-mark':
            if (k !== rects.length - 1) return;
            el.style.cssText = `position:absolute;left:calc(${(r.x + r.w) * 100}% - 2px);top:calc(${r.y * 100}% - 4px);width:10px;height:10px;background:${color};border-radius:2px 2px 2px 0;box-shadow:0 0 2px rgba(0,0,0,.4)`;
            break;
          default:
            el.style.cssText = `${base}background:${color};mix-blend-mode:multiply`;
        }
        frag.appendChild(el);
      });
    };
    for (const d of all) draw(d.style, d.color ?? DECO_DEFAULT_COLOR[d.style], d.range);
    if (sel) draw('highlight', 'rgba(66,133,244,0.40)', sel);
    v.deco.replaceChildren(frag);
  }

  /** 页内归一化矩形 → 浏览器视口矩形 */
  private viewportRects(v: PageView, rects: NRect[]): DOMRect[] {
    const b = v.el.getBoundingClientRect();
    return rects.map((r) => new DOMRect(b.left + r.x * b.width, b.top + r.y * b.height, r.w * b.width, r.h * b.height));
  }

  getRangeRects(range: TextRange): DOMRect[] {
    const v = this.views.get(range.section);
    const t = this.textNow.get(range.section);
    if (!v || !t) return [];
    const box = this.root.getBoundingClientRect();
    return this.viewportRects(v, rectsForRange(t.items, range.start, range.end)).filter((r) => r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right);
  }

  isRangeVisible(range: TextRange): boolean {
    const v = this.views.get(range.section);
    const t = this.textNow.get(range.section);
    if (!v || !t) return false;
    const box = this.root.getBoundingClientRect();
    const rs = this.viewportRects(v, rectsForRange(t.items, range.start, range.end));
    if (!rs.length) return false;
    const eps = 1;
    return rs.every((r) => r.top >= box.top - eps && r.bottom <= box.bottom + eps && r.left >= box.left - eps && r.right <= box.right + eps);
  }

  getSelection(): ReaderSelection | null {
    return this.buildSelection(this.selRange);
  }

  private buildSelection(range: TextRange | null): ReaderSelection | null {
    if (!range) return null;
    const t = this.textNow.get(range.section);
    const v = this.views.get(range.section);
    if (!t || !v) return null;
    const rs = this.viewportRects(v, rectsForRange(t.items, range.start, range.end));
    if (!rs.length) return null;
    const l = Math.min(...rs.map((r) => r.left));
    const tp = Math.min(...rs.map((r) => r.top));
    const r2 = Math.max(...rs.map((r) => r.right));
    const b = Math.max(...rs.map((r) => r.bottom));
    return { range, text: t.text.slice(range.start, range.end), rect: new DOMRect(l, tp, r2 - l, b - tp) };
  }

  setSelection(range: TextRange | null): void {
    const had = this.selRange;
    if (!range || range.end <= range.start) {
      this.selRange = null;
      for (const v of this.views.values()) void this.paintDecos(v);
      if (had) this.emit('selection', null);
      return;
    }
    void this.textOf(range.section).then(() => {
      if (this.destroyed) return;
      this.selRange = range;
      for (const v of this.views.values()) void this.paintDecos(v);
      const s = this.buildSelection(range);
      if (s) this.emit('selection', s);
    });
  }

  /** 选区变化（拖动中）：不等文字层，已缓存时直接生效 */
  updateSelection(range: TextRange): void {
    this.selRange = range;
    for (const v of this.views.values()) if (v.index === range.section) void this.paintDecos(v);
    const s = this.buildSelection(range);
    if (s) this.emit('selection', s);
  }

  /** 长按选词：点 (nx,ny) 所在的词 */
  async selectWord(index: number, offset: number): Promise<boolean> {
    const t = await this.textOf(index);
    if (!t) return false;
    const w = wordAt(t.text, offset);
    if (!w) return false;
    this.setSelection({ section: index, start: w.start, end: w.end });
    return true;
  }

  /** 屏幕点（阅读区坐标）→ 页与页内归一化坐标 */
  pageAt(px: number, py: number): { index: number; nx: number; ny: number } | null {
    if (this.strip) {
      const wx = this.cx + px / this.z;
      const wy = this.sy + py / this.z;
      const i = this.strip.indexAt(wy);
      const x = this.strip.pageX(i);
      const y = this.strip.top(i);
      const w = this.strip.pageW(i);
      const h = this.strip.pageH(i);
      const nx = (wx - x) / w;
      const ny = (wy - y) / h;
      return nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 ? { index: i, nx, ny } : null;
    }
    for (const v of this.views.values()) {
      const nx = ((px - this.tx) / this.z - v.x) / v.w;
      const ny = ((py - this.ty) / this.z - v.y) / v.h;
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) return { index: v.index, nx, ny };
    }
    return null;
  }

  /** 点中的装饰（最上面一条），不含内部图层和搜索/朗读高亮 */
  decorationAt(index: number, offset: number): { layer: string; id: string; range: TextRange } | null {
    let found: { layer: string; id: string; range: TextRange } | null = null;
    for (const [layer, list] of this.decos) {
      if (layer.startsWith('__') || layer === 'search' || layer === 'tts') continue;
      for (const d of list) if (d.range.section === index && offset >= d.range.start && offset < d.range.end) found = { layer, id: d.id, range: d.range };
    }
    return found;
  }

  decorationRect(range: TextRange): DOMRect {
    return this.getRangeRects(range)[0] ?? new DOMRect(0, 0, 0, 0);
  }

  // ───────────── 自动滚屏（连续：像素；单页：按页计时） ─────────────
  // 与可重排引擎同一套触摸手势：单击 = 暂停/继续，上下拖 = 调速，横拖 > 80px = 停止
  private autoSpeedSteps = 0;
  private autoMoved = false;

  private emitAuto(): void {
    const a = this.auto;
    this.emit('autoScroll', { running: !!a && !a.paused, paused: !!a && a.paused, speed: autoScrollSettings.get().autoScrollSpeed });
  }

  /** 自动滚屏已开启（含暂停）：触摸交给自动滚屏手势 */
  get autoEngaged(): boolean {
    return !!this.auto;
  }

  startAutoScroll(): void {
    if (!this.root || this.destroyed) return;
    if (this.auto) {
      if (this.auto.paused) this.resumeAuto();
      return;
    }
    this.auto = { raf: 0, last: performance.now(), count: 0, paused: false };
    this.emitAuto();
    this.auto.raf = requestAnimationFrame(this.autoTick);
  }

  private autoTick = (now: number): void => {
    const a = this.auto;
    if (!a || a.paused) return;
    const dt = Math.min(0.1, (now - a.last) / 1000);
    a.last = now;
    const speed = autoScrollSettings.get().autoScrollSpeed;
    if (this.strip) {
      const px = pixelsPerSecond(2, speed) * dt;
      if (px > 0) {
        const { oy } = this.panBy(0, -px);
        if (Math.abs(oy) > 0.01 && !this.canPanY(1)) {
          this.stopAutoScroll();
          this.emit('endOfBook', undefined);
          return;
        }
      }
    } else {
      a.count += dt * 10;
      if (a.count >= pageThreshold(speed)) {
        a.count = 0;
        void this.turn(1).then((ok) => {
          if (!ok) this.stopAutoScroll();
        });
      }
    }
    a.raf = requestAnimationFrame(this.autoTick);
  };

  private pauseAuto(): void {
    const a = this.auto;
    if (!a || a.paused) return;
    a.paused = true;
    cancelAnimationFrame(a.raf);
    this.emitAuto();
  }

  private resumeAuto(): void {
    const a = this.auto;
    if (!a || !a.paused) return;
    a.paused = false;
    a.last = performance.now();
    this.emitAuto();
    a.raf = requestAnimationFrame(this.autoTick);
  }

  stopAutoScroll(): void {
    const a = this.auto;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    this.auto = undefined;
    this.emitAuto();
  }

  isAutoScrolling(): boolean {
    return !!this.auto && !this.auto.paused;
  }

  autoTouchStart(): void {
    this.autoSpeedSteps = 0;
    this.autoMoved = false;
  }

  autoTouchMove(dx: number, dy: number): void {
    if (!this.auto) return;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this.stopAutoScroll();
      return;
    }
    if (Math.abs(dy) > 6) this.autoMoved = true;
    const steps = Math.trunc(-dy / 20); // 上拖变快：speed 值变小
    if (steps !== this.autoSpeedSteps) {
      const s = clamp(autoScrollSettings.get().autoScrollSpeed - (steps - this.autoSpeedSteps), 0, 100);
      this.autoSpeedSteps = steps;
      autoScrollSettings.set({ autoScrollSpeed: s });
      this.emitAuto();
    }
  }

  autoTouchEnd(dx: number, dy: number, dur: number): void {
    const a = this.auto;
    if (!a) return;
    if (!this.autoMoved && Math.abs(dx) < 10 && Math.abs(dy) < 10 && dur < 800) {
      if (a.paused) this.resumeAuto();
      else this.pauseAuto();
    }
  }

  /** 适配缩放（测试/调试用） */
  fitScaleOf(w: number, h: number): number {
    return fitScale(this.fit, this.boxW, this.boxH, w, h);
  }
}

function invertHex(hex: string): string {
  const m = /^#([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return '#202020';
  const n = parseInt(m[1], 16);
  const c = (v: number) => (255 - v).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
}
