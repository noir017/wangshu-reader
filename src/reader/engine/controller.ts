// 阅读引擎（可重排书）：章节 iframe 栈 + 行对齐窗口。实现 core/reader.ts 的 ReaderController。
//
// 位置模型（对应原 app：一段整章文本 + 一个按整行对齐的窗口）：
//   pos = { section, y }：y 是窗口顶在该章节内容流中的位置（px）。
//   分页模式（flipAnimation≠0）：y 总是行顶，窗口底边不切行（lines.ts）；连续滚动模式（=0）：y 任意，章节上下首尾相接。
// 字号/页边距/窗口尺寸变化后：先记下窗口首个可见字符的偏移（字符锚点），重排后把它所在行放回页顶。
import type { Book, Locator, ReflowableBook, SectionContent, TextRange } from '@/core/book';
import { Emitter } from '@/core/emitter';
import { textOfHtml, textWithBreaks } from '@/core/text';
import type { Decoration, GoToTarget, ReaderController, ReaderEvents, ReaderLocation, ReaderSelection } from '@/core/reader';
import { autoScrollSettings, cssSettings, flipSettings, screenSettings, textSettings, themeSettings } from '../settings';
import { effectiveFontSize, fontStack, type RenderConfig } from './css';
import { flagsFrom } from './book-css';
import { ChapterFrame } from './frame';
import { resolveFont, type ResolvedFont } from './fonts';
import { estimatePage, estimatePages, lastPageTop, nextPageTop, oneLineTag, pageClipHeight, prevPageTop, snapToLineTop } from './lines';
import { applyTransforms, nameSettings, type NameRule } from './transforms';
import { applyExtras } from './extras';
import { resolveBackground } from './textures';
import { Gestures } from './gestures';
import { Decorations } from './decorations';
import { SelectionManager } from './selection';
import { Animator, engineFlipHost, type FlipPlan } from './animator';
import { rasterizeSpread } from './raster';
import { textureFlip } from './texflip';
import { AutoScroller } from './autoscroll';

export type Mode = 'paged' | 'scroll';
export interface Pos {
  section: number;
  y: number;
}
export interface TurnTarget {
  section: number;
  y: number;
}

class StaleError extends Error {}

const COLOR_TEXT_KEYS = new Set(['fontColor', 'backgroundColor', 'useBackgroundImage', 'backgroundImage', 'fontShadow']);
const COLOR_CSS_KEYS = new Set(['linkColor', 'linkColorNight', 'linkVisitedColor', 'linkVisitedColorNight', 'noteTextColor', 'noteBackColor', 'noteTextColorNight', 'noteBackColorNight', 'longTapImageFullScreen']);
const IGNORE_TEXT_KEYS = new Set(['txtChapterSplit', 'keepOneLineWhenPaging', 'textEncode']);

function changedKeys<T extends object>(a: T, b: T): string[] {
  return (Object.keys(b) as Array<keyof T>).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(String);
}

export class Engine implements ReaderController {
  readonly book: ReflowableBook;
  private em = new Emitter<{ [K in keyof ReaderEvents]: ReaderEvents[K] }>();
  container?: HTMLElement;
  root?: HTMLDivElement;
  stage?: HTMLDivElement;
  /** 容器尺寸与文字区尺寸（单页） */
  boxW = 0;
  boxH = 0;
  W = 0;
  H = 0;
  inset = { l: 0, t: 0, r: 0, b: 0 };
  pos: Pos = { section: 0, y: 0 };
  frames = new Map<number, ChapterFrame>();
  spares = new Map<number, ChapterFrame>();
  private pending = new Map<number, Promise<ChapterFrame>>();
  private contents = new Map<number, Promise<SectionContent>>();
  private textCache = new Map<number, { text: string; breaks: number[] }>();
  private epoch = 0;
  private destroyed = false;
  private font: ResolvedFont = { css: '' };
  private lhByFont = new Map<string, number>();
  private snap = this.snapshot();
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private ro?: ResizeObserver;
  private unsubs: Array<() => void> = [];
  private relocateTimer?: ReturnType<typeof setTimeout>;
  private lastLoc: ReaderLocation | null = null;
  /** 翻页历史：精确回到翻页前的位置（VIEW-001 yBeforePageDown） */
  private pageStack: Array<{ from: Pos; to: Pos }> = [];
  private prefixChars: number[] = [];
  private totalChars = 0;
  turning = false;
  /** 点过的链接（section|href），重载章节后仍显示为已访问色 */
  private visited = new Set<string>();
  /** 外部（UI）可设置的仅本书名字规则 */
  private bookRules: NameRule[] = [];

  gestures!: Gestures;
  // 这几个在构造时就建好：open 之前、destroy 之后查询类方法也要能安全返回（接口约定不得抛错）
  decorations = new Decorations(this);
  selection = new SelectionManager(this);
  animator = new Animator(engineFlipHost(this));
  autoscroll = new AutoScroller(this);

  constructor(book: ReflowableBook) {
    this.book = book;
    let acc = 0;
    for (const s of book.sections) {
      this.prefixChars.push(acc);
      acc += Math.max(0, s.charCount);
    }
    this.totalChars = acc;
  }

  // ───────────── 设置快照 ─────────────
  private snapshot() {
    return {
      text: textSettings.get(),
      css: cssSettings.get(),
      flip: flipSettings.get(),
      dualPage: screenSettings.get().dualPage,
      night: themeSettings.get().nightMode,
      rules: nameSettings.get().rules,
    };
  }

  /** 自动滚屏期间临时改变排版方式（像素/逐行要连续滚动，卷帘/逐页要整页窗口） */
  autoMode: Mode | null = null;

  get mode(): Mode {
    return this.autoMode ?? (flipSettings.get().flipAnimation === 0 ? 'scroll' : 'paged');
  }

  /** 当前布局是否是双页（已按双页排版） */
  dualNow(): boolean {
    return this.dualLaid;
  }

  /** 双页：右页文字区左缘相对舞台（= 左页文字区左缘）的偏移 */
  get rightPageX(): number {
    return this.W + this.inset.r + this.inset.l;
  }

  /** 自动滚屏开始/结束时，双页状态是否随之变化（需要重排） */
  dualChanged(): boolean {
    return this.dualLaid !== (this.dual && this.mode === 'paged');
  }
  private dualLaid = false;

  /** 双页：on，或 auto 且横屏足够宽；自动滚屏期间不双页 */
  get dual(): boolean {
    if (this.autoscroll?.running) return false;
    const d = screenSettings.get().dualPage;
    if (d === 'on') return this.boxW >= 600;
    return d === 'auto' && this.boxW >= 900 && this.boxW > this.boxH;
  }

  cfg(): RenderConfig {
    const t = textSettings.get();
    const family = fontStack(t.fontName, this.font.family);
    return {
      text: t,
      css: cssSettings.get(),
      night: themeSettings.get().nightMode,
      dual: this.dual,
      width: this.W,
      height: this.H,
      fontFamily: family,
      lang: this.book.metadata.language ?? (t.textCJK ? 'zh' : 'en'),
      lhRatio: this.lhByFont.get(family) ?? 1.3,
    };
  }

  /** 一行露出多大比例才算显示 */
  tag(): number {
    const asian = /^(zh|ja|ko)/i.test(this.book.metadata.language ?? '') || textSettings.get().textCJK;
    return oneLineTag(textSettings.get().lineSpace, asian);
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
    root.className = 'mr-reader';
    Object.assign(root.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      userSelect: 'none',
      touchAction: 'none',
      outline: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    root.tabIndex = 0;
    const stage = (this.stage = document.createElement('div'));
    stage.className = 'mr-stage';
    Object.assign(stage.style, { position: 'absolute', overflow: 'hidden', contain: 'layout paint' } satisfies Partial<CSSStyleDeclaration>);
    root.appendChild(stage);
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(root);

    this.gestures = new Gestures(this);
    this.gestures.attachRoot(root);

    await this.measureBox();
    await this.refreshFont();
    void this.applyBackground();

    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(container);
    this.unsubs.push(
      textSettings.subscribe(() => this.scheduleRefresh()),
      cssSettings.subscribe(() => this.scheduleRefresh()),
      flipSettings.subscribe(() => this.scheduleRefresh()),
      screenSettings.subscribe(() => this.scheduleRefresh()),
      themeSettings.subscribe(() => this.scheduleRefresh()),
      nameSettings.subscribe(() => this.scheduleRefresh()),
    );
    try {
      await this.showAt(at ? { section: at.section, offset: at.offset } : { section: this.firstLinear(), y: 0 });
    } catch (e) {
      this.emit('error', e as Error);
      throw e;
    }
    if (autoScrollSettings.get().startAutoScroll) this.startAutoScroll();
  }

  /** 已 open 且未 destroy */
  private get live(): boolean {
    return !!this.stage && !this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.lastLoc = null;
    this.epoch++;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.relocateTimer);
    this.ro?.disconnect();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.autoscroll?.destroy();
    this.animator?.destroy();
    this.gestures?.destroy();
    this.selection?.destroy();
    for (const f of this.frames.values()) f.destroy();
    for (const f of this.spares.values()) f.destroy();
    this.frames.clear();
    this.spares.clear();
    this.root?.remove();
    this.em.clear();
  }

  // ───────────── 尺寸与背景 ─────────────
  private async measureBox(): Promise<void> {
    const c = this.container!;
    for (let i = 0; i < 60 && (!c.clientWidth || !c.clientHeight); i++) await new Promise((r) => setTimeout(r, 50));
    this.boxW = c.clientWidth || 360;
    this.boxH = c.clientHeight || 640;
    this.updateGeometry();
  }

  /** 由容器尺寸与页边距推文字区 */
  updateGeometry(): void {
    const t = textSettings.get();
    const dual = this.dual && this.mode === 'paged';
    this.dualLaid = dual;
    const l = t.leftMargin;
    const r = t.rightMargin;
    const top = t.topMargin;
    const bottom = t.bottomMargin;
    this.inset = { l, t: top, r, b: bottom };
    const stageW = dual ? Math.floor((this.boxW - 2 * (l + r)) / 2) : this.boxW - l - r;
    this.W = Math.max(80, Math.floor(stageW));
    this.H = Math.max(80, Math.floor(this.boxH - top - bottom));
    const s = this.stage!.style;
    if (dual) {
      // 双页：stage 覆盖整个版心（两页 + 中缝），各页由 render 放置
      s.left = `${l}px`;
      s.width = `${this.boxW - l - r}px`;
    } else {
      s.left = `${l}px`;
      s.width = `${this.W}px`;
    }
    s.top = `${top}px`;
    s.height = `${this.H}px`;
  }

  private async applyBackground(): Promise<void> {
    const t = textSettings.get();
    const css = await resolveBackground({ useImage: t.useBackgroundImage, image: t.backgroundImage, color: t.backgroundColor });
    if (this.root && !this.destroyed) {
      this.root.style.background = css;
      this.root.style.backgroundColor = t.backgroundColor;
    }
  }

  private async refreshFont(): Promise<void> {
    this.font = await resolveFont(textSettings.get().fontName);
  }

  private onResize(): void {
    if (this.destroyed || !this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h || (w === this.boxW && h === this.boxH)) return;
    this.scheduleRefresh(true);
  }

  // ───────────── 设置变化 ─────────────
  private scheduleRefresh(force = false): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(force), 80);
  }

  private async refresh(force: boolean): Promise<void> {
    if (this.destroyed) return;
    const prev = this.snap;
    const next = this.snapshot();
    this.snap = next;
    const textKeys = changedKeys(prev.text, next.text).filter((k) => !IGNORE_TEXT_KEYS.has(k));
    const cssKeys = changedKeys(prev.css, next.css);
    const sizeChanged = this.container!.clientWidth !== this.boxW || this.container!.clientHeight !== this.boxH;
    const flipModeChanged = (prev.flip.flipAnimation === 0) !== (next.flip.flipAnimation === 0);
    const other = prev.dualPage !== next.dualPage || prev.rules !== next.rules;
    const colorOnly =
      !force && !sizeChanged && !flipModeChanged && !other &&
      textKeys.every((k) => COLOR_TEXT_KEYS.has(k)) && cssKeys.every((k) => COLOR_CSS_KEYS.has(k));
    if (!textKeys.length && !cssKeys.length && !flipModeChanged && !other && !sizeChanged && prev.night === next.night && !force) return;
    if (textKeys.includes('backgroundColor') || textKeys.includes('useBackgroundImage') || textKeys.includes('backgroundImage')) void this.applyBackground();
    if (colorOnly) {
      const cfg = this.cfg();
      for (const f of [...this.frames.values(), ...this.spares.values()]) f.applyConfig(cfg);
      return;
    }
    await this.rebuild();
  }

  /** 排版相关设置变了：记下字符锚点，整体重建，再回到锚点 */
  async rebuild(): Promise<void> {
    if (this.destroyed || !this.stage) return;
    const anchor = this.currentAnchor();
    this.animator.cancel();
    this.epoch++;
    const old = [...this.frames.values(), ...this.spares.values()];
    this.frames = new Map();
    this.spares = new Map();
    this.pending.clear();
    this.pageStack = [];
    this.boxW = this.container!.clientWidth || this.boxW;
    this.boxH = this.container!.clientHeight || this.boxH;
    await this.refreshFont();
    this.updateGeometry();
    try {
      await this.showAt(anchor ?? { section: this.firstLinear(), y: 0 });
    } catch (e) {
      if (!(e instanceof StaleError)) this.emit('error', e as Error);
    } finally {
      for (const f of old) f.destroy();
    }
  }

  async relayout(): Promise<void> {
    if (this.live) await this.rebuild();
  }

  // ───────────── 章节加载 ─────────────
  linear(i: number): boolean {
    return this.book.sections[i]?.linear !== false;
  }
  firstLinear(): number {
    const i = this.book.sections.findIndex((s) => s.linear !== false);
    return i < 0 ? 0 : i;
  }
  lastLinear(): number {
    for (let i = this.book.sections.length - 1; i >= 0; i--) if (this.linear(i)) return i;
    return this.book.sections.length - 1;
  }
  nextLinear(i: number): number | null {
    for (let k = i + 1; k < this.book.sections.length; k++) if (this.linear(k)) return k;
    return null;
  }
  prevLinear(i: number): number | null {
    for (let k = i - 1; k >= 0; k--) if (this.linear(k)) return k;
    return null;
  }

  content(section: number): Promise<SectionContent> {
    let p = this.contents.get(section);
    if (!p) {
      const s = this.book.sections[section];
      if (!s) return Promise.reject(new Error(`章节不存在: ${section}`));
      p = s.load();
      this.contents.set(section, p);
      p.catch(() => this.contents.delete(section));
      // 简单 LRU：只留最近的若干章
      if (this.contents.size > 12) {
        const first = this.contents.keys().next().value as number;
        this.contents.delete(first);
      }
    }
    return p;
  }

  private transformOptions() {
    const t = textSettings.get();
    const bookRules = this.bookRules;
    return {
      jian2fan: t.textJian2Fan,
      fan2jian: t.textFan2Jian,
      trimBlank: t.trimBlankSpace,
      rules: [...bookRules, ...nameSettings.get().rules.filter((r) => !r.book || r.book === this.book.metadata.title)],
    };
  }

  private async makeFrame(section: number, slot: 0 | 1): Promise<ChapterFrame> {
    const epoch = this.epoch;
    const content = await this.content(section);
    if (this.destroyed || epoch !== this.epoch) throw new StaleError();
    const f = new ChapterFrame(this.stage!, section);
    f.slot = slot;
    const cfg = this.cfg();
    const family = cfg.fontFamily;
    try {
      await f.load({
        content,
        cfg,
        flags: flagsFrom(cssSettings.get()),
        fontFaceCss: this.font.css,
        lang: this.book.metadata.language,
        langOverride: textSettings.get().textHyphenation ? textSettings.get().hyphenationLang : undefined,
        post: async (fr) => {
          await applyTransforms(fr, this.transformOptions());
          const css = cssSettings.get();
          const zh = /^(zh|ja|ko)/i.test(this.book.metadata.language ?? '');
          await applyExtras(fr, {
            section,
            visited: this.visited,
            chapterEnd: css.chapterEndPrompt && this.nextLinear(section) !== null ? (zh ? '— 本章结束 —' : '— End of chapter —') : null,
            footnote: css.footnoteOnBottom && this.book.getFootnote ? (href) => this.footnoteFor(href, section) : null,
          });
        },
      });
    } catch (e) {
      f.destroy();
      throw e;
    }
    if (this.destroyed || epoch !== this.epoch) {
      f.destroy();
      throw new StaleError();
    }
    if (f.measuredLhRatio) this.lhByFont.set(family, f.measuredLhRatio);
    f.onLayoutChange = (fr) => this.onFrameLayoutChanged(fr);
    this.gestures.attachFrame(f);
    this.decorations.applyTo(f);
    this.emit('sectionReady', { section, doc: f.doc });
    return f;
  }

  /** 主副本（slot 0） */
  ensureFrame(section: number): Promise<ChapterFrame> {
    const have = this.frames.get(section);
    if (have) return Promise.resolve(have);
    let p = this.pending.get(section);
    if (!p) {
      p = this.makeFrame(section, 0).then((f) => {
        this.pending.delete(section);
        this.frames.set(section, f);
        return f;
      });
      p.catch(() => this.pending.delete(section));
      this.pending.set(section, p);
    }
    return p;
  }

  /** 同一章的第二个副本：动画里需要同时显示同一章的两个窗口时用 */
  private sparePending = new Map<number, Promise<ChapterFrame>>();
  ensureSpare(section: number): Promise<ChapterFrame> {
    const have = this.spares.get(section);
    if (have) return Promise.resolve(have);
    let p = this.sparePending.get(section);
    if (!p) {
      p = this.makeFrame(section, 1).then((f) => {
        this.sparePending.delete(section);
        this.spares.set(section, f);
        return f;
      });
      p.catch(() => this.sparePending.delete(section));
      this.sparePending.set(section, p);
    }
    return p;
  }

  /** 把 spare 提升为主副本（动画提交后角色互换，不重载） */
  swapSpare(section: number): void {
    const main = this.frames.get(section);
    const sp = this.spares.get(section);
    if (!main || !sp) return;
    this.frames.set(section, sp);
    this.spares.set(section, main);
    main.slot = 1;
    sp.slot = 0;
  }

  frameOfDoc(doc: Document): ChapterFrame | undefined {
    for (const f of [...this.frames.values(), ...this.spares.values()]) if (f.doc === doc) return f;
    return undefined;
  }

  private onFrameLayoutChanged(fr: ChapterFrame): void {
    if (fr.section !== this.pos.section || this.destroyed) return;
    // 当前章尺寸变了（图片晚加载）：保持锚点
    const anchor = this.currentAnchor();
    if (anchor && anchor.offset !== undefined) {
      void this.showAt(anchor, true);
    }
  }

  // ───────────── 定位 ─────────────
  /** 当前窗口首个可见字符（字符锚点） */
  currentAnchor(): { section: number; offset: number } | null {
    const f = this.frames.get(this.pos.section);
    if (!f?.loaded) return null;
    return { section: this.pos.section, offset: f.offsetAtTop(Math.max(0, this.pos.y)) };
  }

  /** 章节内 offset → 窗口顶 y（行对齐） */
  yOfOffset(f: ChapterFrame, offset: number): number {
    const lines = f.getLines();
    const r = f.rectOfOffset(offset);
    if (!r) return 0;
    const y = snapToLineTop(lines, (r.top + r.bottom) / 2);
    return Math.max(0, y);
  }

  async showAt(target: { section: number; offset?: number; anchor?: string; y?: number }, keepStack = false): Promise<void> {
    const section = Math.max(0, Math.min(this.book.sections.length - 1, target.section));
    const f = await this.ensureFrame(section);
    let y = 0;
    if (target.y !== undefined) y = target.y;
    else if (target.offset !== undefined && target.offset > 0) y = this.yOfOffset(f, target.offset);
    else if (target.anchor) {
      const ay = f.anchorY(target.anchor);
      if (ay !== null) y = snapToLineTop(f.getLines(), ay + 1);
    }
    if (this.mode === 'paged') y = this.clampPagedY(f, y);
    if (this.dualNow()) await this.ensureSpare(section);
    this.pos = { section, y };
    if (!keepStack) this.pageStack = [];
    this.render();
    this.emitRelocate(true);
    void this.preload();
  }

  private clampPagedY(f: ChapterFrame, y: number): number {
    return Math.max(0, Math.min(y, Math.max(0, f.height - 1)));
  }

  /** 摆放可见框：分页模式只显示当前章当前窗口；滚动模式把相邻章首尾相接 */
  render(): void {
    if (!this.stage) return;
    const cur = this.frames.get(this.pos.section);
    if (this.mode === 'paged') {
      this.renderPaged(cur);
      return;
    }
    const all = [...this.frames.values()];
    for (const f of all) f.place({ x: 0, y: 0, clipH: 1, innerTop: 0, visible: false });
    if (!cur) return;
    const place = (f: ChapterFrame, top: number) => {
      f.place({ x: 0, y: top, clipH: f.height, innerTop: 0, visible: top < this.H && top + f.height > 0 });
    };
    let top = -this.pos.y;
    place(cur, top);
    let s = this.pos.section;
    let t = top + cur.height;
    for (let n = this.nextLinear(s); n !== null && t < this.H; n = this.nextLinear(n)) {
      const f = this.frames.get(n);
      if (!f?.loaded) break;
      place(f, t);
      t += f.height;
    }
    t = top;
    for (let p = this.prevLinear(s); p !== null && t > 0; p = this.prevLinear(p)) {
      const f = this.frames.get(p);
      if (!f?.loaded) break;
      t -= f.height;
      place(f, t);
    }
  }

  private renderPaged(cur?: ChapterFrame): void {
    const dual = this.dualNow();
    const right = dual && cur ? this.spares.get(this.pos.section) : undefined;
    const ry = right && cur ? this.rightTop(cur, this.pos.y) : null;
    for (const f of [...this.frames.values(), ...this.spares.values()]) {
      if (f === cur) {
        f.place({ x: 0, y: 0, clipH: this.pageClip(f, this.pos.y), innerTop: this.pos.y, visible: true, z: 1 });
      } else if (f === right && ry !== null) {
        f.place({ x: this.rightPageX, y: 0, clipH: this.pageClip(f, ry), innerTop: ry, visible: true, z: 1 });
      } else {
        f.place({ x: 0, y: 0, clipH: this.H, innerTop: 0, visible: false });
      }
    }
  }

  /** 双页：右页窗口顶（左页之后的下一页）；本章没有下一页返回 null（右页留白） */
  rightTop(f: ChapterFrame, y: number): number | null {
    return nextPageTop(f.getLines(), y, this.H, this.tag(), textSettings.get().keepOneLineWhenPaging);
  }

  /** 分页窗口的实际可见高度（lines.ts pageClipHeight） */
  pageClip(f: ChapterFrame, y: number): number {
    return pageClipHeight(f.getLines(), y, this.H, this.tag());
  }

  /** 预载相邻章并清理远处的章 */
  private async preload(): Promise<void> {
    const s = this.pos.section;
    const keep = new Set<number>([s]);
    const n = this.nextLinear(s);
    const p = this.prevLinear(s);
    if (n !== null) keep.add(n);
    if (p !== null) keep.add(p);
    for (const [k, f] of this.frames) {
      if (!keep.has(k)) {
        f.destroy();
        this.frames.delete(k);
      }
    }
    for (const [k, f] of this.spares) {
      if (k !== s) {
        f.destroy();
        this.spares.delete(k);
      }
    }
    try {
      if (n !== null) await this.ensureFrame(n);
      if (p !== null) await this.ensureFrame(p);
    } catch (e) {
      if (!(e instanceof StaleError)) this.emit('error', e as Error);
    }
    if (this.mode === 'scroll') this.render();
  }

  // ───────────── 位置信息 ─────────────
  private sectionTitle(section: number, f: ChapterFrame | undefined, y: number): string | undefined {
    const flat: Array<{ title: string; section: number; anchor?: string }> = [];
    const walk = (list: typeof this.book.toc) => {
      for (const e of list) {
        flat.push({ title: e.title, section: e.section, anchor: e.anchor });
        if (e.children) walk(e.children);
      }
    };
    walk(this.book.toc);
    let best: string | undefined;
    for (const e of flat) {
      if (e.section > section) continue;
      if (e.section < section) {
        best = e.title;
        continue;
      }
      if (e.anchor && f?.loaded) {
        const ay = f.anchorY(e.anchor);
        if (ay !== null && ay > y + this.H * 0.5) continue;
      }
      best = e.title;
    }
    return best ?? this.book.sections[section]?.title;
  }

  progressOf(section: number, offset: number, textLen: number): number {
    if (this.totalChars <= 0) return this.book.sections.length > 1 ? section / this.book.sections.length : 0;
    const sec = this.book.sections[section];
    const frac = textLen > 0 ? Math.min(1, offset / textLen) : 0;
    return Math.max(0, Math.min(1, (this.prefixChars[section] + frac * Math.max(0, sec?.charCount ?? 0)) / this.totalChars));
  }

  getLocation(): ReaderLocation | null {
    if (!this.live) return null;
    const section = this.pos.section;
    const f = this.frames.get(section);
    if (!f?.loaded) return this.lastLoc;
    const y = Math.max(0, this.pos.y);
    const start = f.offsetAtTop(y);
    const dualRy = this.mode === 'paged' && this.dualNow() ? this.rightTop(f, y) : null;
    const end = Math.max(start, f.offsetAtBottom(Math.min((dualRy ?? y) + this.H, f.height)));
    const total = f.text.total;
    const lines = f.getLines();
    const tag = this.tag();
    const atFirst = section === this.firstLinear() || this.prevLinear(section) === null;
    const hasNext = this.nextLinear(section) !== null;
    let atEnd: boolean;
    if (this.mode === 'paged') {
      if (this.dualNow()) atEnd = !hasNext && (dualRy === null || nextPageTop(lines, dualRy, this.H, tag) === null);
      else atEnd = !hasNext && nextPageTop(lines, y, this.H, tag) === null;
    } else atEnd = !hasNext && y + this.H >= f.height - 1;
    const pages = estimatePages(f.height, this.H);
    const pagesLeft = nextPageTop(lines, y, this.H, tag) === null;
    const page = estimatePage(y, f.height, this.H, pagesLeft && this.mode === 'paged');
    const charCount = Math.max(1, this.book.sections[section]?.charCount ?? total);
    const ppc = pages / charCount;
    const bookPages = this.totalChars > 0 ? Math.max(1, Math.round(this.totalChars * ppc)) : undefined;
    const bookPage = bookPages ? Math.min(bookPages, Math.round(this.prefixChars[section] * ppc + page)) : undefined;
    const loc: ReaderLocation = {
      locator: { section, offset: start },
      progress: atEnd && !hasNext ? 1 : this.progressOf(section, start, total),
      section,
      sectionTitle: this.sectionTitle(section, f, y),
      page,
      pages,
      bookPage,
      bookPages,
      visible: { section, start, end },
      atStart: atFirst && y <= 0.5,
      atEnd,
    };
    return loc;
  }

  /** 位置变化后通知。滚动中节流，翻页/跳转立即 */
  emitRelocate(immediate = false): void {
    if (this.destroyed) return;
    if (immediate) {
      clearTimeout(this.relocateTimer);
      this.relocateTimer = undefined;
      const loc = this.getLocation();
      if (loc) {
        this.lastLoc = loc;
        this.emit('relocate', loc);
      }
      return;
    }
    if (this.relocateTimer) return;
    this.relocateTimer = setTimeout(() => {
      this.relocateTimer = undefined;
      const loc = this.getLocation();
      if (loc) {
        this.lastLoc = loc;
        this.emit('relocate', loc);
      }
    }, 100);
  }

  // ───────────── 翻页 ─────────────
  /** 下一页/上一页的目标位置；null = 书首/书尾 */
  async targetOf(dir: 1 | -1, from: Pos = this.pos): Promise<TurnTarget | null> {
    const f = await this.ensureFrame(from.section);
    const lines = f.getLines();
    const tag = this.tag();
    const keepOne = textSettings.get().keepOneLineWhenPaging;
    if (this.dualNow()) return this.dualTarget(dir, from, f);
    if (dir > 0) {
      const top = nextPageTop(lines, from.y, this.H, tag, keepOne);
      if (top !== null) return { section: from.section, y: top };
      const n = this.nextLinear(from.section);
      return n === null ? null : { section: n, y: 0 };
    }
    // 向上：优先弹历史栈
    const hist = this.pageStack[this.pageStack.length - 1];
    if (hist && hist.to.section === from.section && Math.abs(hist.to.y - from.y) < 1) return { ...hist.from };
    const top = prevPageTop(lines, from.y, this.H, tag);
    if (top !== null) return { section: from.section, y: top };
    const p = this.prevLinear(from.section);
    if (p === null) return null;
    const pf = await this.ensureFrame(p);
    return { section: p, y: lastPageTop(pf.getLines(), this.H, tag) };
  }

  /** 双页一次翻两页：向后 = 右页之后的下一页；向前 = 回退两页（优先弹历史栈） */
  private async dualTarget(dir: 1 | -1, from: Pos, f: ChapterFrame): Promise<TurnTarget | null> {
    const lines = f.getLines();
    const tag = this.tag();
    const keepOne = textSettings.get().keepOneLineWhenPaging;
    if (dir > 0) {
      const r = nextPageTop(lines, from.y, this.H, tag, keepOne);
      const n = r === null ? null : nextPageTop(lines, r, this.H, tag, keepOne);
      if (n !== null) return { section: from.section, y: n };
      const nx = this.nextLinear(from.section);
      return nx === null ? null : { section: nx, y: 0 };
    }
    const hist = this.pageStack[this.pageStack.length - 1];
    if (hist && hist.to.section === from.section && Math.abs(hist.to.y - from.y) < 1) return { ...hist.from };
    const p1 = prevPageTop(lines, from.y, this.H, tag);
    if (p1 !== null) return { section: from.section, y: prevPageTop(lines, p1, this.H, tag) ?? p1 };
    const p = this.prevLinear(from.section);
    if (p === null) return null;
    const pl = (await this.ensureFrame(p)).getLines();
    const last = lastPageTop(pl, this.H, tag);
    return { section: p, y: prevPageTop(pl, last, this.H, tag) ?? last };
  }

  /** 双页一屏（左页 + 右页）的窗口表，供栅格化 */
  private async spreadWindows(pos: Pos) {
    const f = await this.ensureFrame(pos.section);
    const sp = await this.ensureSpare(pos.section);
    const ry = this.rightTop(f, pos.y);
    const wins = [{ frame: f, y: pos.y, clipH: this.pageClip(f, pos.y), left: this.inset.l, top: this.inset.t, width: this.W }];
    if (ry !== null) wins.push({ frame: sp, y: ry, clipH: this.pageClip(sp, ry), left: this.inset.l + this.rightPageX, top: this.inset.t, width: this.W });
    return wins;
  }

  /** 双页翻页动画：两屏整屏纹理 + 纹理翻页 */
  async dualFlip(anim: number, dir: 1 | -1, from: Pos, target: TurnTarget, click: boolean): Promise<FlipPlan | null> {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bg = this.root!.style.background || this.root!.style.backgroundColor;
    const box = { w: this.boxW, h: this.boxH };
    let texA: HTMLCanvasElement;
    let texB: HTMLCanvasElement;
    try {
      [texA, texB] = await Promise.all([
        this.spreadWindows(from).then((windows) => rasterizeSpread({ box, background: bg, dpr, windows })),
        this.spreadWindows(target).then((windows) => rasterizeSpread({ box, background: bg, dpr, windows })),
      ]);
    } catch {
      return null; // 栅格化失败：调用方直接无动画翻页
    }
    return textureFlip({ root: this.root!, boxW: this.boxW, boxH: this.boxH }, anim, dir, texA, texB, click);
  }

  /** 提交一次翻页（动画结束后或无动画时） */
  commit(target: TurnTarget, dir: 1 | -1, from: Pos): void {
    if (dir > 0) {
      this.pageStack.push({ from: { ...from }, to: { ...target } });
      if (this.pageStack.length > 60) this.pageStack.shift();
    } else if (this.pageStack.length) {
      const h = this.pageStack[this.pageStack.length - 1];
      if (h.from.section === target.section && Math.abs(h.from.y - target.y) < 1) this.pageStack.pop();
    }
    this.pos = { section: target.section, y: target.y };
    this.render();
    this.emitRelocate(true);
    void this.preload();
  }

  /** 翻一页。animation 缺省按设置；gesture 为 true 表示由手势触发（动画选择不同） */
  async turn(dir: 1 | -1, opts: { animation?: number; instant?: boolean } = {}): Promise<boolean> {
    if (this.turning) return false;
    this.turning = true;
    try {
      const from = { ...this.pos };
      const target = await this.targetOf(dir, from);
      if (!target) {
        if (dir > 0) this.emit('endOfBook', undefined);
        return false;
      }
      const anim = opts.instant ? 0 : opts.animation ?? (this.mode === 'paged' ? flipSettings.get().flipAnimation : 0);
      if (anim && this.animator.supports(anim)) {
        const ok = await this.animator.run(dir, from, target, anim);
        if (ok) return true;
      }
      if (this.dualNow()) await this.ensureSpare(target.section);
      this.commit(target, dir, from);
      return true;
    } finally {
      this.turning = false;
    }
  }

  next(): Promise<void> {
    if (!this.live) return Promise.resolve();
    return this.mode === 'scroll' ? this.turn(1, { instant: true }).then(() => undefined) : this.turn(1).then(() => undefined);
  }
  prev(): Promise<void> {
    if (!this.live) return Promise.resolve();
    return this.mode === 'scroll' ? this.turn(-1, { instant: true }).then(() => undefined) : this.turn(-1).then(() => undefined);
  }

  async nextSection(): Promise<void> {
    if (!this.live) return;
    const n = this.nextLinear(this.pos.section);
    if (n === null) {
      this.emit('endOfBook', undefined);
      return;
    }
    await this.showAt({ section: n, y: 0 });
  }

  async prevSection(): Promise<void> {
    if (!this.live) return;
    const p = this.prevLinear(this.pos.section);
    if (p === null) return;
    await this.showAt({ section: p, y: 0 });
  }

  // 滚动模式：按像素滚动；返回实际位移（到书首尾会被截断）
  scrollBy(dy: number): number {
    if (this.mode !== 'scroll' || !dy) return 0;
    const before = this.absY();
    let { section, y } = this.pos;
    y += dy;
    for (;;) {
      const f = this.frames.get(section);
      if (!f) break;
      if (y >= f.height) {
        const n = this.nextLinear(section);
        const nf = n === null ? undefined : this.frames.get(n);
        if (n !== null && nf?.loaded) {
          y -= f.height;
          section = n;
          continue;
        }
        y = Math.min(y, Math.max(0, f.height - this.H));
        break;
      }
      if (y < 0) {
        const p = this.prevLinear(section);
        const pf = p === null ? undefined : this.frames.get(p);
        if (p !== null && pf?.loaded) {
          y += pf.height;
          section = p;
          continue;
        }
        y = 0;
        break;
      }
      break;
    }
    const sectionChanged = section !== this.pos.section;
    this.pos = { section, y };
    this.render();
    if (sectionChanged) void this.preload();
    this.emitRelocate(false);
    return this.absY() - before;
  }

  /** 以首章为原点的绝对滚动位置（仅用于计算位移，章节未加载的部分按 0 计） */
  private absY(): number {
    let acc = 0;
    for (let i = 0; i < this.pos.section; i++) acc += this.frames.get(i)?.height ?? 0;
    return acc + this.pos.y;
  }

  // ───────────── goTo ─────────────
  async goTo(target: GoToTarget): Promise<void> {
    if (!this.live) return;
    this.animator.cancel();
    if ('href' in target) {
      const r = this.book.resolveHref(target.href, target.fromSection ?? this.pos.section);
      if (r) await this.showAt({ section: r.section, anchor: r.anchor });
      return;
    }
    if ('progress' in target) {
      const p = Math.max(0, Math.min(1, target.progress));
      const want = p * this.totalChars;
      let sec = this.book.sections.findIndex((_s, i) => this.prefixChars[i] + Math.max(0, this.book.sections[i].charCount) > want);
      if (sec < 0) sec = this.lastLinear();
      const len = Math.max(1, this.book.sections[sec].charCount);
      const frac = Math.max(0, Math.min(1, (want - this.prefixChars[sec]) / len));
      const f = await this.ensureFrame(sec);
      await this.showAt({ section: sec, offset: Math.floor(frac * f.text.total) });
      return;
    }
    if ('range' in target) {
      await this.showAt({ section: target.range.section, offset: target.range.start });
      if (target.flash) this.decorations.flash(target.range);
      return;
    }
    if ('offset' in target) {
      await this.showAt({ section: target.section, offset: target.offset });
      return;
    }
    await this.showAt({ section: target.section, anchor: target.anchor });
  }

  // ───────────── 文本访问 ─────────────
  async getSectionText(section: number): Promise<string> {
    return (await this.getSectionTextWithBreaks(section)).text;
  }

  async getSectionTextWithBreaks(section: number): Promise<{ text: string; breaks: number[] }> {
    try {
      return await this.sectionTextWithBreaks(section);
    } catch {
      return { text: '', breaks: [] }; // 章节不存在 / 书已释放：查询类方法不抛错
    }
  }

  private async sectionTextWithBreaks(section: number): Promise<{ text: string; breaks: number[] }> {
    const have = this.textCache.get(section);
    if (have) return have;
    const loaded = this.frames.get(section);
    let out: { text: string; breaks: number[] };
    if (loaded?.loaded) {
      // 已加载章节：文本节点可能被简繁替换，取索引里的原文；段落边界仍从 DOM 取
      const wb = textWithBreaks(loaded.doc.body);
      out = { text: loaded.text.text(), breaks: wb.breaks };
    } else {
      const c = await this.content(section);
      const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${c.bodyHtml}</body></html>`, 'text/html');
      out = textWithBreaks(doc.body);
    }
    this.textCache.set(section, out);
    if (this.textCache.size > 30) this.textCache.delete(this.textCache.keys().next().value as number);
    return out;
  }

  /** textOfHtml 的别名，给外部离线取文本 */
  static textOfHtml = textOfHtml;

  // ───────────── 装饰 / 选择 ─────────────
  setDecorations(layer: string, decorations: Decoration[]): void {
    this.decorations.set(layer, decorations);
  }
  getRangeRects(range: TextRange): DOMRect[] {
    return this.live ? this.decorations.rects(range) : [];
  }
  isRangeVisible(range: TextRange): boolean {
    return this.live ? this.decorations.isVisible(range) : false;
  }
  getSelection(): ReaderSelection | null {
    return this.live ? this.selection.get() : null;
  }
  setSelection(range: TextRange | null): void {
    if (this.live) this.selection.set(range);
  }

  // ───────────── 自动滚屏 ─────────────
  startAutoScroll(): void {
    if (this.live) this.autoscroll.start();
  }
  stopAutoScroll(): void {
    this.autoscroll.stop();
  }
  isAutoScrolling(): boolean {
    return this.live && this.autoscroll.running;
  }

  /** 设置仅本书生效的名字替换规则（reader/ui 的「名字替换」对话框用），随后重排 */
  setNameRules(rules: NameRule[]): void {
    this.bookRules = rules;
    void this.rebuild();
  }

  // ───────────── 链接与图片 ─────────────
  imageLongTap(): boolean {
    return cssSettings.get().longTapImageFullScreen;
  }

  private viewportRect(f: ChapterFrame, el: Element): DOMRect {
    const o = f.origin();
    const r = el.getBoundingClientRect();
    return new DOMRect(r.left + o.left, r.top + o.top, r.width, r.height);
  }

  /** 点到链接：脚注 → 弹窗事件；书内链接 → 自己跳转；外链 → 只上报 */
  async followLink(f: ChapterFrame, a: Element): Promise<void> {
    const href = a.getAttribute('href') ?? '';
    const rect = this.viewportRect(f, a);
    if (!href) return;
    this.visited.add(`${f.section}|${href}`);
    a.classList.add('mr-visited');
    const target = this.book.resolveHref(href, f.section);
    if (!target) {
      this.emit('link', { href, internal: false, rect });
      return;
    }
    try {
      const html = await this.book.getFootnote?.(href, f.section);
      if (html) {
        this.emit('link', { href, internal: true, footnoteHtml: html, rect });
        return;
      }
    } catch {
      /* 脚注取不到就当普通链接 */
    }
    await this.showAt({ section: target.section, anchor: target.anchor });
    this.emit('link', { href, internal: true, rect });
  }

  /** 页底注解用：该链接指向书内注解时取注解 HTML */
  private async footnoteFor(href: string, section: number): Promise<string | null> {
    if (!href || !this.book.resolveHref(href, section)) return null;
    return (await this.book.getFootnote?.(href, section)) ?? null;
  }

  openImage(f: ChapterFrame, img: Element): void {
    const tag = img.tagName.toLowerCase();
    let src = '';
    if (tag === 'img') src = (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src;
    else {
      const im = tag === 'image' ? img : img.querySelector('image');
      src = im?.getAttribute('href') ?? im?.getAttribute('xlink:href') ?? '';
    }
    if (!src) return;
    this.emit('image', { src, alt: img.getAttribute('alt') ?? undefined, rect: this.viewportRect(f, img) });
  }

  // ───────────── 坐标 ─────────────
  /** iframe 内坐标 → 阅读区(root)坐标 */
  toRoot(frame: ChapterFrame, x: number, y: number): { x: number; y: number } {
    const o = frame.origin();
    const rr = this.root!.getBoundingClientRect();
    return { x: x + o.left - rr.left, y: y + o.top - rr.top };
  }

  /** 字号（含双页加减），给 UI 与滚屏算行高用 */
  fontSize(): number {
    return effectiveFontSize({ text: textSettings.get(), dual: this.dual });
  }
}
