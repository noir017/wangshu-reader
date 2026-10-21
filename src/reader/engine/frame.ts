// 章节渲染框：一个同源 iframe（sandbox 不含 allow-scripts，书内脚本不会执行）+ 外面一层裁剪盒。
// iframe 被撑成整章高度（不在 iframe 内滚动），引擎用 transform 平移来显示窗口 [innerTop, innerTop+clipH)，
// 滚动、翻页、动画共用同一套摆放（place）。
import type { SectionContent } from '@/core/book';
import { TextIndex } from './text-index';
import { buildBaseCss, buildDocumentHtml, buildOverrideCss, lineHeightRatio, type RenderConfig } from './css';
import { processBookStyles, type StripFlags } from './book-css';
import { mergeBoxes, type LineBox } from './lines';

export interface Placement {
  x: number;
  y: number;
  /** 裁剪盒高度（分页：页高；连续滚动：整章高度） */
  clipH: number;
  /** iframe 内容向上平移量：窗口顶在章节内的位置 */
  innerTop: number;
  opacity?: number;
  visible?: boolean;
  z?: number;
  /** 追加在 translate 后面的 transform（缩放等） */
  extra?: string;
  /** 额外裁剪 inset(top right bottom left)，用于覆盖翻页的分界线 */
  clip?: string;
  shadow?: string;
  /** 给这一页铺不透明的纸（滚屏卷帘里盖在上面的新页用） */
  bg?: string;
}

export interface FrameLoadOptions {
  content: SectionContent;
  cfg: RenderConfig;
  flags: StripFlags;
  fontFaceCss: string;
  /** 文本索引建好后、测量前的钩子：简繁/名字替换、去空行等显示性处理 */
  post?: (frame: ChapterFrame) => void | Promise<void>;
  /** 书籍语言兜底 */
  lang?: string;
  /** 强制语言（断字语言设置）：优先于章节自带的 lang */
  langOverride?: string;
}

const NEAR = 1.5;

export class ChapterFrame {
  readonly host: HTMLDivElement;
  readonly iframe: HTMLIFrameElement;
  doc!: Document;
  win!: Window;
  text!: TextIndex;
  /** 内容高度（iframe 高度） */
  height = 0;
  width = 0;
  loaded = false;
  /** 同一章的第几个副本（0 = 主，1 = 动画/双页用的副本） */
  slot = 0;
  /** 实际排版后量到的自然行高比 */
  measuredLhRatio = 0;
  /** 页高（窗口高度），表格行是否整行翻页的判断用 */
  pageH = 600;
  private linesCache: LineBox[] | null = null;
  private nodeBoxes: { top: Float64Array; bottom: Float64Array } | null = null;
  private lhCache = new Map<Element, number>();
  private ro?: ResizeObserver;
  /** 内容尺寸在加载后又变了（图片晚加载、字体替换） */
  onLayoutChange?: (f: ChapterFrame) => void;
  private cleanups: Array<() => void> = [];

  constructor(
    readonly stage: HTMLElement,
    readonly section: number,
  ) {
    this.host = document.createElement('div');
    this.host.className = 'mr-frame';
    Object.assign(this.host.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      overflow: 'hidden',
      contain: 'strict',
      visibility: 'hidden',
      pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);
    this.iframe = document.createElement('iframe');
    this.iframe.setAttribute('sandbox', 'allow-same-origin');
    this.iframe.setAttribute('scrolling', 'no');
    this.iframe.setAttribute('tabindex', '-1');
    this.iframe.title = `section-${section}`;
    Object.assign(this.iframe.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      border: '0',
      background: 'transparent',
      display: 'block',
      transformOrigin: '0 0',
    } satisfies Partial<CSSStyleDeclaration>);
    this.host.appendChild(this.iframe);
    stage.appendChild(this.host);
  }

  async load(o: FrameLoadOptions): Promise<void> {
    const { content, cfg } = o;
    this.width = Math.round(cfg.width);
    this.pageH = cfg.height;
    this.iframe.style.width = `${this.width}px`;
    this.iframe.style.height = `${Math.round(cfg.height)}px`;
    this.host.style.width = `${this.width}px`;
    this.host.style.height = `${Math.round(cfg.height)}px`;
    const html = buildDocumentHtml({
      lang: o.langOverride || (content.lang ?? o.lang),
      dir: content.dir,
      bodyAttrs: content.bodyAttrs,
      bodyHtml: content.bodyHtml,
      bookStyles: content.styles,
      baseCss: buildBaseCss(cfg),
      overrideCss: buildOverrideCss(cfg),
      fontFaceCss: o.fontFaceCss,
    });
    await new Promise<void>((resolve) => {
      this.iframe.addEventListener('load', () => resolve(), { once: true });
      this.iframe.srcdoc = html;
    });
    this.doc = this.iframe.contentDocument!;
    this.win = this.iframe.contentWindow!;
    processBookStyles(this.doc, o.flags, { width: cfg.width, height: cfg.height });
    // 文本索引必须在显示性替换之前建（它要记下原文）
    this.text = new TextIndex(this.doc.body);
    await o.post?.(this);
    await this.settle();
    // 自然行高比：行距要按它换算（TYPO-003）
    const ratio = this.measureLhRatio(cfg);
    this.measuredLhRatio = ratio;
    if (Math.abs(ratio - cfg.lhRatio) > 0.005) {
      const cfg2 = { ...cfg, lhRatio: ratio };
      this.applyConfig(cfg2);
    }
    this.measure();
    this.loaded = true;
    // 图片/字体晚到导致的尺寸变化
    const RO = (this.win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO) {
      this.ro = new RO(() => {
        const h = this.contentHeight();
        if (Math.abs(h - this.height) > 1) {
          this.measure();
          this.onLayoutChange?.(this);
        }
      });
      this.ro.observe(this.doc.documentElement);
    }
  }

  /** 等字体与图片就绪（带超时，坏图不卡住） */
  private async settle(): Promise<void> {
    const waits: Promise<unknown>[] = [];
    const fonts = (this.doc as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) waits.push(fonts.ready);
    for (const img of Array.from(this.doc.images)) {
      if (img.complete) continue;
      waits.push(new Promise((r) => {
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
      }));
    }
    if (!waits.length) return;
    await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 1500))]);
  }

  private measureLhRatio(cfg: RenderConfig): number {
    const probe = this.doc.createElement('div');
    probe.textContent = '中Ag';
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:100px;line-height:normal;letter-spacing:0;font-family:${cfg.fontFamily.replace(/"/g, "'")};font-weight:${cfg.text.fontBold ? 'bold' : 'normal'}`;
    // 放在 html 下（body 之外），不进入文本索引
    this.doc.documentElement.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return h > 0 ? h / 100 : 1.3;
  }

  /** 重写样式表（颜色、行高变化等无需重载文档的更新） */
  applyConfig(cfg: RenderConfig): void {
    if (!this.doc) return;
    const set = (id: string, css: string) => {
      const el = this.doc.getElementById(id);
      if (el) el.textContent = css;
    };
    set('mr-base', buildBaseCss(cfg));
    set('mr-override', buildOverrideCss(cfg));
    this.invalidate();
  }

  invalidate(): void {
    this.linesCache = null;
    this.nodeBoxes = null;
    this.lhCache.clear();
  }

  private contentHeight(): number {
    const d = this.doc;
    return Math.ceil(Math.max(d.documentElement.getBoundingClientRect().height, d.body.scrollHeight, d.body.getBoundingClientRect().bottom));
  }

  /** 重新量内容高度并撑开 iframe */
  measure(): number {
    // iframe 高度先降到 1，避免视口高度掩盖内容高度
    this.iframe.style.height = '1px';
    const h = Math.max(1, this.contentHeight());
    this.height = h;
    this.iframe.style.height = `${h}px`;
    this.invalidate();
    return h;
  }

  setWidth(w: number, cfg: RenderConfig): void {
    this.width = Math.round(w);
    this.iframe.style.width = `${this.width}px`;
    this.applyConfig(cfg);
    this.measure();
  }

  place(p: Placement): void {
    const s = this.host.style;
    s.width = `${this.width}px`;
    s.height = `${p.clipH}px`;
    s.transform = `translate3d(${p.x}px,${p.y}px,0)${p.extra ? ' ' + p.extra : ''}`;
    s.visibility = p.visible === false ? 'hidden' : 'visible';
    s.opacity = p.opacity === undefined || p.opacity === 1 ? '' : String(p.opacity);
    s.zIndex = p.z === undefined ? '' : String(p.z);
    s.clipPath = p.clip ?? '';
    s.boxShadow = p.shadow ?? '';
    s.background = p.bg ?? '';
    this.iframe.style.transform = p.innerTop ? `translate3d(0,${-p.innerTop}px,0)` : '';
  }

  // ───────────── 行几何 ─────────────

  private lineHeightOf(el: Element, fallback: number): number {
    let v = this.lhCache.get(el);
    if (v === undefined) {
      const cs = this.win.getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight);
      v = Number.isFinite(lh) ? lh : fallback;
      this.lhCache.set(el, v);
    }
    return v;
  }

  private buildGeometry(): void {
    const doc = this.doc;
    const nodes = this.text.nodes;
    const top = new Float64Array(nodes.length).fill(Infinity);
    const bottom = new Float64Array(nodes.length).fill(-Infinity);
    const boxes: LineBox[] = [];
    const range = doc.createRange();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      range.selectNodeContents(n);
      const rects = range.getClientRects();
      const parent = n.parentElement;
      for (let k = 0; k < rects.length; k++) {
        const r = rects[k];
        if (r.height <= 0.5 || r.width <= 0) continue;
        const lh = parent ? this.lineHeightOf(parent, r.height) : r.height;
        const mid = (r.top + r.bottom) / 2;
        const half = Math.max(lh, r.height) / 2;
        const t = mid - half;
        const b = mid + half;
        boxes.push({ top: t, bottom: b, ink: r.bottom, inkTop: r.top });
        if (t < top[i]) top[i] = t;
        if (b > bottom[i]) bottom[i] = b;
      }
    }
    // 表格行：单元格里的文字可能多行且垂直居中，行与行交错，按整行当作不可拆分块（比页高大的行除外）
    for (const tr of Array.from(doc.querySelectorAll('tr'))) {
      const r = tr.getBoundingClientRect();
      if (r.height > 0.5 && r.height < this.pageH * 0.9) boxes.push({ top: r.top, bottom: r.bottom, atomic: true });
    }
    for (const el of Array.from(doc.querySelectorAll('img,svg,video,canvas,hr,object,iframe'))) {
      // 行内的小图（如表情）会和所在行合并，不单独成行
      const r = el.getBoundingClientRect();
      if (r.height <= 0.5 || r.width <= 0.5) continue;
      if (el.tagName.toLowerCase() !== 'svg' && el.closest('svg')) continue;
      boxes.push({ top: r.top, bottom: r.bottom, atomic: true });
    }
    this.linesCache = mergeBoxes(boxes);
    this.nodeBoxes = { top, bottom };
  }

  /** 行表（文档坐标，已含半行距），首次访问时计算，排版变化后失效 */
  getLines(): LineBox[] {
    if (!this.linesCache) this.buildGeometry();
    return this.linesCache!;
  }

  /** 字符 → 其所在渲染矩形（文档坐标）。字符不可见（折叠的空白）时向后/向前找最近的可见字符 */
  rectOfOffset(offset: number): DOMRect | null {
    const total = this.text.total;
    if (!total) return null;
    const probe = (o: number) => {
      const r = this.text.range(o, o + 1);
      if (!r) return null;
      const list = r.getClientRects();
      for (let i = 0; i < list.length; i++) if (list[i].height > 0.5) return list[i];
      return null;
    };
    const o0 = Math.max(0, Math.min(offset, total - 1));
    for (let d = 0; d < 80 && o0 + d < total; d++) {
      const r = probe(o0 + d);
      if (r) return r;
    }
    for (let d = 1; d < 80 && o0 - d >= 0; d++) {
      const r = probe(o0 - d);
      if (r) return r;
    }
    return null;
  }

  /** 第一个「行底 > y」的字符偏移（窗口顶部第一个可见字符） */
  offsetAtTop(y: number): number {
    this.getLines();
    const nb = this.nodeBoxes!;
    const nodes = this.text.nodes;
    let i = 0;
    while (i < nodes.length && !(nb.bottom[i] > y + NEAR)) i++;
    if (i >= nodes.length) return this.text.total;
    return this.charSearch(i, (r) => r.bottom > y + NEAR);
  }

  /** 最后一个「行顶 < y」的字符之后的偏移（窗口底部可见文字的结尾） */
  offsetAtBottom(y: number): number {
    this.getLines();
    const nb = this.nodeBoxes!;
    const nodes = this.text.nodes;
    let i = nodes.length - 1;
    while (i >= 0 && !(nb.top[i] < y - NEAR)) i--;
    if (i < 0) return 0;
    const first = this.charSearch(i, (r) => r.top >= y - NEAR);
    // charSearch 返回第一个不满足可见条件的字符；其前面的就是最后可见字符
    return Math.max(this.text.starts[i], first);
  }

  /** 在节点 i 内二分：第一个满足 pred 的字符偏移（基准偏移）；都不满足返回节点末尾 */
  private charSearch(i: number, pred: (r: DOMRect) => boolean): number {
    const node = this.text.nodes[i];
    const len = node.data.length;
    const range = this.doc.createRange();
    const rectAt = (k: number): DOMRect | null => {
      for (let j = k; j < Math.min(len, k + 8); j++) {
        range.setStart(node, j);
        range.setEnd(node, j + 1);
        const rs = range.getClientRects();
        for (let q = 0; q < rs.length; q++) if (rs[q].height > 0.5) return rs[q];
      }
      return null;
    };
    let lo = 0;
    let hi = len;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const r = rectAt(mid);
      if (!r || pred(r)) hi = mid;
      else lo = mid + 1;
    }
    return this.text.offsetOfText(node, lo);
  }

  /** 锚点元素在文档里的 y；找不到返回 null */
  anchorY(anchor: string): number | null {
    const el = this.findAnchor(anchor);
    if (!el) return null;
    return el.getBoundingClientRect().top;
  }

  findAnchor(anchor: string): Element | null {
    const id = decodeURIComponent(anchor.replace(/^#/, ''));
    if (!id) return null;
    return this.doc.getElementById(id) ?? this.doc.getElementsByName(id)[0] ?? this.doc.querySelector(`[name="${CSS.escape(id)}"]`);
  }

  /** 注册文档事件，frame 销毁时统一解除 */
  listen<K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    this.doc.addEventListener(type, fn as EventListener, opts);
    this.cleanups.push(() => this.doc?.removeEventListener(type, fn as EventListener, opts));
  }

  /** iframe 左上角在浏览器视口里的位置（含父级 transform） */
  origin(): { left: number; top: number } {
    const r = this.iframe.getBoundingClientRect();
    return { left: r.left, top: r.top };
  }

  destroy(): void {
    this.ro?.disconnect();
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.host.remove();
    this.loaded = false;
  }
}

/** 根据设置推导行高倍数（给 UI/调试用） */
export { lineHeightRatio };
