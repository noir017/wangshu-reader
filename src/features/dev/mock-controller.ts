// 开发/测试用的假引擎：实现 core/reader.ts 的 ReaderController，尽量贴近真引擎的语义：
// 每章一个同源 iframe（sectionReady 给出的 doc 就是 iframe 文档，doc.body 是偏移基准的根），
// 用 transform 平移显示窗口；装饰画在 iframe 外的覆盖层里；选择用 iframe 里的原生选择；
// 点击链接/图片/装饰分别派发 link/image/decorationClick。排版只求够用：整章一个长页，按窗口高度翻页。
import type { Locator, ReflowableBook, TextRange } from '@/core/book';
import type { Decoration, GoToTarget, ReaderController, ReaderEvents, ReaderLocation, ReaderSelection } from '@/core/reader';
import { collectTextNodes, offsetsOfRange, rangeFromOffsets, textOf, textWithBreaks } from '@/core/text';

type Listener = (p: never) => void;

const LINE = 32;
const BODY_CSS = `
html{background:#fbf7ee}
body{margin:0;padding:16px 18px;font:18px/1.8 'Noto Serif CJK SC','Songti SC',serif;color:#222;overflow-wrap:anywhere}
h1{font-size:1.4em;margin:.4em 0}
h2{font-size:1.2em;margin:.4em 0}
p{margin:0 0 .6em;text-indent:2em}
img{max-width:100%;height:auto;display:block;margin:0 auto}
a{color:#1a5fb4}
aside{display:none}`;

const DEFAULT_COLOR: Record<string, string> = {
  highlight: '#ffd54f77',
  search: '#ffd54f88',
  tts: '#4fc3f777',
  box: '#e53935',
  underline: '#555555',
  strikethrough: '#555555',
  squiggly: '#00aa00',
  'note-mark': '#555555',
};

export class MockController implements ReaderController {
  readonly book: ReflowableBook;
  private listeners = new Map<string, Set<Listener>>();
  private host!: HTMLElement;
  private viewport!: HTMLElement;
  private overlay!: HTMLElement;
  private iframe: HTMLIFrameElement | null = null;
  private doc: Document | null = null;
  private section = -1;
  private y = 0;
  private contentH = 0;
  private decos = new Map<string, Decoration[]>();
  private cur: { range: TextRange } | null = null;
  private selTimer?: ReturnType<typeof setTimeout>;
  private ro?: ResizeObserver;
  private loading: Promise<void> = Promise.resolve();
  private textCache = new Map<number, { text: string; breaks: number[] }>();
  private lastLoc: ReaderLocation | null = null;
  destroyed = false;
  /** 测试用：翻页/跳转次数 */
  moves = 0;

  constructor(book: ReflowableBook) {
    this.book = book;
  }

  // ───────────── 事件 ─────────────
  on<K extends keyof ReaderEvents>(type: K, fn: (payload: ReaderEvents[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as unknown as Listener);
    return () => set!.delete(fn as unknown as Listener);
  }

  private emit<K extends keyof ReaderEvents>(type: K, payload: ReaderEvents[K]): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) (fn as (p: ReaderEvents[K]) => void)(payload);
  }

  // ───────────── 生命周期 ─────────────
  private get W(): number {
    return this.host.clientWidth || 400;
  }
  private get H(): number {
    return this.host.clientHeight || 700;
  }

  async open(container: HTMLElement, at?: Locator): Promise<void> {
    this.host = container;
    container.style.position ||= 'relative';
    container.innerHTML = '';
    this.viewport = document.createElement('div');
    Object.assign(this.viewport.style, { position: 'absolute', inset: '0', overflow: 'hidden' });
    this.overlay = document.createElement('div');
    this.overlay.setAttribute('data-testid', 'deco-overlay');
    Object.assign(this.overlay.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '5' });
    container.append(this.viewport, this.overlay);
    let lastW = this.W;
    this.ro = new ResizeObserver(() => {
      if (this.W !== lastW || !this.doc) {
        lastW = this.W;
        void this.relayout();
      }
    });
    this.ro.observe(container);
    await this.show(at?.section ?? 0, at?.offset ?? 0);
  }

  destroy(): void {
    this.destroyed = true;
    this.ro?.disconnect();
    clearTimeout(this.selTimer);
    this.listeners.clear();
    this.host?.replaceChildren();
  }

  async relayout(): Promise<void> {
    if (!this.doc) return;
    const start = this.lastLoc?.visible.start ?? 0;
    this.iframe!.style.width = `${this.W}px`;
    await this.measure();
    this.scrollToOffset(start);
    this.afterMove();
  }

  // ───────────── 章节加载 ─────────────
  private async show(section: number, offset: number, opts: { endOfSection?: boolean } = {}): Promise<void> {
    await this.loadSection(section);
    if (opts.endOfSection) this.y = Math.max(0, this.contentH - this.H);
    else this.scrollToOffset(offset);
    this.afterMove();
  }

  private loadSection(section: number): Promise<void> {
    if (section === this.section && this.doc) return this.loading;
    this.loading = this.doLoad(section);
    return this.loading;
  }

  private async doLoad(section: number): Promise<void> {
    const sec = this.book.sections[section];
    if (!sec) throw new Error(`没有第 ${section} 章`);
    const content = await sec.load();
    const iframe = document.createElement('iframe');
    iframe.title = `section-${section}`;
    iframe.setAttribute('sandbox', 'allow-same-origin');
    Object.assign(iframe.style, { position: 'absolute', left: '0', top: '0', width: `${this.W}px`, height: `${this.H}px`, border: '0', background: '#fbf7ee' });
    const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${BODY_CSS}</style></head><body>${content.bodyHtml}</body></html>`;
    await new Promise<void>((resolve) => {
      iframe.addEventListener('load', () => resolve(), { once: true });
      iframe.srcdoc = html;
      this.viewport.replaceChildren(iframe);
    });
    this.iframe = iframe;
    this.doc = iframe.contentDocument!;
    this.section = section;
    this.y = 0;
    await this.measure();
    this.wire(this.doc);
    if (this.cur && this.cur.range.section !== section) this.cur = null;
    this.emit('sectionReady', { section, doc: this.doc });
  }

  private async measure(): Promise<void> {
    const doc = this.doc!;
    // 图片异步加载完才知道高度
    await Promise.all(
      Array.from(doc.images).map((im) => (im.complete ? null : new Promise<void>((r) => ((im.onload = im.onerror = () => r()), undefined)))),
    );
    this.iframe!.style.height = `${this.H}px`;
    this.contentH = Math.max(doc.documentElement.scrollHeight, this.H);
    this.iframe!.style.height = `${this.contentH}px`;
  }

  // ───────────── 位置 ─────────────
  private maxY(): number {
    return Math.max(0, this.contentH - this.H);
  }

  private scrollToOffset(offset: number, frac = 0): void {
    const doc = this.doc;
    if (!doc) return;
    const r = rangeFromOffsets(doc.body, offset, offset + 1);
    const rect = r && Array.from(r.getClientRects())[0];
    const top = rect ? rect.top : 0;
    this.y = Math.max(0, Math.min(this.maxY(), top - frac * this.H));
  }

  private afterMove(): void {
    this.moves++;
    this.iframe!.style.transform = `translateY(${-this.y}px)`;
    this.lastLoc = this.computeLocation();
    this.renderOverlay();
    this.emit('relocate', this.lastLoc);
  }

  private charTop(node: Text, k: number): { top: number; bottom: number } | null {
    const r = this.doc!.createRange();
    for (let i = k; i < Math.min(node.data.length, k + 4); i++) {
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const q = Array.from(r.getClientRects()).find((x) => x.height > 0);
      if (q) return { top: q.top, bottom: q.bottom };
    }
    return null;
  }

  private computeVisible(): TextRange {
    const doc = this.doc!;
    const top = this.y;
    const bottom = this.y + this.H;
    let acc = 0;
    let start = -1;
    let end = -1;
    for (const n of collectTextNodes(doc.body)) {
      const len = n.data.length;
      if (len) {
        const r = doc.createRange();
        r.selectNodeContents(n);
        const rects = Array.from(r.getClientRects()).filter((q) => q.height > 0);
        if (rects.length) {
          const nTop = Math.min(...rects.map((q) => q.top));
          const nBot = Math.max(...rects.map((q) => q.bottom));
          if (nBot > top + 1 && nTop < bottom - 1) {
            // 节点内二分：第一个落在窗口内的字符、最后一个落在窗口内的字符
            let lo = 0;
            let hi = len - 1;
            while (lo < hi) {
              const mid = (lo + hi) >> 1;
              const t = this.charTop(n, mid);
              if (t && t.bottom > top + 1) hi = mid;
              else lo = mid + 1;
            }
            const first = lo;
            lo = first;
            hi = len - 1;
            while (lo < hi) {
              const mid = (lo + hi + 1) >> 1;
              const t = this.charTop(n, mid);
              if (t && t.top < bottom - 1) lo = mid;
              else hi = mid - 1;
            }
            if (start < 0) start = acc + first;
            end = acc + lo + 1;
          }
        }
      }
      acc += len;
    }
    if (start < 0) return { section: this.section, start: 0, end: 0 };
    return { section: this.section, start, end };
  }

  private computeLocation(): ReaderLocation {
    const visible = this.computeVisible();
    const secs = this.book.sections;
    const total = secs.reduce((a, s) => a + s.charCount, 0) || 1;
    const before = secs.slice(0, this.section).reduce((a, s) => a + s.charCount, 0);
    const progress = Math.min(1, (before + (visible.start / Math.max(1, textLen(this.doc!))) * secs[this.section].charCount) / total);
    return {
      locator: { section: this.section, offset: visible.start },
      progress,
      section: this.section,
      sectionTitle: secs[this.section].title,
      page: Math.floor(this.y / this.H) + 1,
      pages: Math.max(1, Math.ceil(this.contentH / this.H)),
      visible,
      atStart: this.section === 0 && this.y <= 0,
      atEnd: this.section === secs.length - 1 && this.y >= this.maxY() - 1,
    };
  }

  getLocation(): ReaderLocation | null {
    return this.doc ? (this.lastLoc ??= this.computeLocation()) : null;
  }

  // ───────────── 翻页 ─────────────
  async next(): Promise<void> {
    await this.loading;
    if (this.y < this.maxY() - 1) {
      this.y = Math.min(this.maxY(), this.y + this.H - LINE);
      this.afterMove();
    } else if (this.section < this.book.sections.length - 1) await this.show(this.section + 1, 0);
    else this.emit('endOfBook', undefined as never);
  }

  async prev(): Promise<void> {
    await this.loading;
    if (this.y > 0) {
      this.y = Math.max(0, this.y - (this.H - LINE));
      this.afterMove();
    } else if (this.section > 0) await this.show(this.section - 1, 0, { endOfSection: true });
  }

  async nextSection(): Promise<void> {
    if (this.section < this.book.sections.length - 1) await this.show(this.section + 1, 0);
  }

  async prevSection(): Promise<void> {
    if (this.section > 0) await this.show(this.section - 1, 0);
  }

  async goTo(t: GoToTarget): Promise<void> {
    await this.loading;
    if ('range' in t) {
      await this.loadSection(t.range.section);
      this.scrollToOffset(t.range.start, 0.25);
      this.afterMove();
      if (t.flash) this.flash(t.range);
      return;
    }
    if ('href' in t) {
      const r = this.book.resolveHref(t.href, t.fromSection ?? Math.max(0, this.section));
      if (r) await this.goTo({ section: r.section, anchor: r.anchor });
      return;
    }
    if ('progress' in t) {
      const secs = this.book.sections;
      const total = secs.reduce((a, s) => a + s.charCount, 0);
      let at = Math.max(0, Math.min(1, t.progress)) * total;
      for (let i = 0; i < secs.length; i++) {
        if (at <= secs[i].charCount || i === secs.length - 1) return this.show(i, Math.round(at));
        at -= secs[i].charCount;
      }
      return;
    }
    if ('offset' in t) return this.show(t.section, t.offset);
    await this.loadSection(t.section);
    if (t.anchor) {
      const el = this.doc!.getElementById(t.anchor) ?? this.doc!.getElementsByName(t.anchor)[0];
      this.y = Math.max(0, Math.min(this.maxY(), el ? el.getBoundingClientRect().top : 0));
    } else this.y = 0;
    this.afterMove();
  }

  private flash(range: TextRange): void {
    this.setDecorations('__flash', [{ id: 'flash', range, style: 'highlight', color: '#ff980088' }]);
    setTimeout(() => this.setDecorations('__flash', []), 700);
  }

  // ───────────── 文本 ─────────────
  private async parsed(section: number): Promise<{ text: string; breaks: number[] }> {
    let e = this.textCache.get(section);
    if (!e) {
      const c = await this.book.sections[section].load();
      const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${c.bodyHtml}</body></html>`, 'text/html');
      e = textWithBreaks(doc.body);
      this.textCache.set(section, e);
    }
    return e;
  }

  async getSectionText(section: number): Promise<string> {
    return (await this.parsed(section)).text;
  }

  async getSectionTextWithBreaks(section: number): Promise<{ text: string; breaks: number[] }> {
    return this.parsed(section);
  }

  // ───────────── 装饰 ─────────────
  setDecorations(layer: string, decorations: Decoration[]): void {
    if (decorations.length) this.decos.set(layer, decorations);
    else this.decos.delete(layer);
    if (this.doc) this.renderOverlay();
  }

  private frameOffset(): { left: number; top: number } {
    const f = this.iframe!.getBoundingClientRect();
    return { left: f.left, top: f.top };
  }

  private rectsOf(range: TextRange): DOMRect[] {
    if (!this.doc || range.section !== this.section) return [];
    const r = rangeFromOffsets(this.doc.body, range.start, range.end);
    return r ? Array.from(r.getClientRects()).filter((q) => q.width > 0 && q.height > 0) : [];
  }

  private renderOverlay(): void {
    const ov = this.overlay;
    ov.replaceChildren();
    if (!this.doc) return;
    const f = this.frameOffset();
    const h = this.host.getBoundingClientRect();
    const dx = f.left - h.left;
    const dy = f.top - h.top;
    for (const [layer, list] of this.decos) {
      for (const d of list) {
        const color = d.color ?? DEFAULT_COLOR[d.style] ?? '#ffd54f77';
        const rects = this.rectsOf(d.range);
        rects.forEach((q, i) => {
          const el = document.createElement('div');
          el.setAttribute('data-deco-layer', layer);
          el.setAttribute('data-deco-id', d.id);
          el.setAttribute('data-deco-style', d.style);
          const base = { position: 'absolute', left: `${q.left + dx}px`, width: `${q.width}px` } as Record<string, string>;
          switch (d.style) {
            case 'underline':
              Object.assign(el.style, base, { top: `${q.bottom + dy - 2}px`, height: '2px', background: color });
              break;
            case 'strikethrough':
              Object.assign(el.style, base, { top: `${q.top + dy + q.height / 2}px`, height: '2px', background: color });
              break;
            case 'squiggly':
              Object.assign(el.style, base, { top: `${q.bottom + dy - 3}px`, height: '3px', background: `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 4px)` });
              break;
            case 'box':
              Object.assign(el.style, base, { top: `${q.top + dy}px`, height: `${q.height}px`, border: `1px solid ${color}` });
              break;
            case 'note-mark':
              if (i > 0) return;
              el.textContent = '✎';
              Object.assign(el.style, { position: 'absolute', left: `${q.left + dx - 2}px`, top: `${q.top + dy - 12}px`, font: '12px sans-serif', color: '#444' });
              break;
            default:
              Object.assign(el.style, base, { top: `${q.top + dy}px`, height: `${q.height}px`, background: color, mixBlendMode: 'multiply' });
          }
          ov.appendChild(el);
        });
      }
    }
  }

  getRangeRects(range: TextRange): DOMRect[] {
    if (!this.doc) return [];
    const f = this.frameOffset();
    const h = this.host.getBoundingClientRect();
    return this.rectsOf(range)
      .map((q) => new DOMRect(q.left + f.left, q.top + f.top, q.width, q.height))
      .filter((q) => q.bottom > h.top && q.top < h.bottom);
  }

  isRangeVisible(range: TextRange): boolean {
    if (!this.doc || range.section !== this.section) return false;
    const rects = this.rectsOf(range);
    if (!rects.length) return false;
    const top = Math.min(...rects.map((q) => q.top));
    const bot = Math.max(...rects.map((q) => q.bottom));
    return top >= this.y - 1 && bot <= this.y + this.H + 1;
  }

  // ───────────── 选择 ─────────────
  private build(range: TextRange): ReaderSelection | null {
    if (!this.doc || range.section !== this.section) return null;
    const r = rangeFromOffsets(this.doc.body, range.start, range.end);
    if (!r) return null;
    const b = r.getBoundingClientRect();
    const f = this.frameOffset();
    return { range, text: r.toString(), rect: new DOMRect(b.left + f.left, b.top + f.top, b.width, b.height) };
  }

  getSelection(): ReaderSelection | null {
    return this.cur ? this.build(this.cur.range) : null;
  }

  setSelection(range: TextRange | null): void {
    const doc = this.doc;
    if (!doc) return;
    const sel = doc.defaultView!.getSelection()!;
    // 真引擎会先加载那一章；假引擎只处理当前章
    if (range && range.section !== this.section) return;
    if (!range || range.end <= range.start) {
      sel.removeAllRanges();
      if (this.cur) {
        this.cur = null;
        this.emit('selection', null);
      }
      return;
    }
    const r = rangeFromOffsets(doc.body, range.start, range.end);
    if (!r) return;
    sel.removeAllRanges();
    sel.addRange(r);
    this.cur = { range };
    const out = this.build(range);
    if (out) this.emit('selection', out);
  }

  private onNativeSelection(): void {
    clearTimeout(this.selTimer);
    this.selTimer = setTimeout(() => {
      const doc = this.doc;
      if (!doc) return;
      const sel = doc.defaultView!.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        if (this.cur) {
          this.cur = null;
          this.emit('selection', null);
        }
        return;
      }
      const { start, end } = offsetsOfRange(doc.body, sel.getRangeAt(0));
      if (end <= start) return;
      if (this.cur && this.cur.range.start === start && this.cur.range.end === end && this.cur.range.section === this.section) return;
      const range = { section: this.section, start, end };
      this.cur = { range };
      const out = this.build(range);
      if (out) this.emit('selection', out);
    }, 120);
  }

  // ───────────── 点击 ─────────────
  private wire(doc: Document): void {
    doc.addEventListener('selectionchange', () => this.onNativeSelection());
    doc.addEventListener('keydown', (e) => this.emit('key', { key: e.key, code: e.code, event: e }));
    doc.addEventListener('click', (e) => this.onClick(e));
  }

  private viewportRect(el: Element | Range): DOMRect {
    const b = el.getBoundingClientRect();
    const f = this.frameOffset();
    return new DOMRect(b.left + f.left, b.top + f.top, b.width, b.height);
  }

  private onClick(e: MouseEvent): void {
    const doc = this.doc!;
    const target = e.target as Element;
    // 拖选结束也会触发 click：有选区就不当作点击
    const sel = doc.defaultView!.getSelection();
    if (sel && !sel.isCollapsed) return;

    const img = target.closest('img');
    if (img) {
      this.emit('image', { src: img.currentSrc || img.src, alt: img.getAttribute('alt') ?? undefined, rect: this.viewportRect(img) });
      return;
    }
    const a = target.closest('a');
    if (a) {
      e.preventDefault();
      void this.onLink(a);
      return;
    }
    // 装饰：后画的在上面
    const f = this.frameOffset();
    let hit: { layer: string; id: string; rect: DOMRect } | null = null;
    for (const [layer, list] of this.decos) {
      if (layer.startsWith('__') || layer === 'search' || layer === 'tts') continue;
      for (const d of list) {
        for (const q of this.rectsOf(d.range)) {
          if (e.clientX >= q.left && e.clientX <= q.right && e.clientY >= q.top - 2 && e.clientY <= q.bottom + 2) {
            hit = { layer, id: d.id, rect: new DOMRect(q.left + f.left, q.top + f.top, q.width, q.height) };
          }
        }
      }
    }
    if (hit) {
      this.emit('decorationClick', hit);
      return;
    }
    this.emit('tap', { x: e.clientX / this.W, y: (e.clientY - this.y) / this.H });
  }

  private async onLink(a: HTMLAnchorElement): Promise<void> {
    const href = a.getAttribute('href') ?? '';
    const rect = this.viewportRect(a);
    const doc = this.doc!;
    if (href.startsWith('#')) {
      const target = doc.getElementById(href.slice(1));
      const isNote = a.getAttribute('epub:type') === 'noteref' || target?.getAttribute('epub:type') === 'footnote';
      if (isNote && target) {
        this.emit('link', { href, internal: true, footnoteHtml: target.innerHTML, rect });
        return;
      }
    }
    const r = this.book.resolveHref(href, this.section);
    if (!r) {
      this.emit('link', { href, internal: false, rect });
      return;
    }
    await this.goTo({ section: r.section, anchor: r.anchor });
    this.emit('link', { href, internal: true, rect });
  }

  // ───────────── 其他 ─────────────
  startAutoScroll(): void {}
  stopAutoScroll(): void {}
  isAutoScrolling(): boolean {
    return false;
  }
}

function textLen(doc: Document): number {
  return textOf(doc.body).length || 1;
}
