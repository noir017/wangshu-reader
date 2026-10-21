// 开发/测试用的假引擎：实现 core/reader.ts 的 ReaderController，能派发 tap/longPress/key/verticalDrag/relocate/autoScroll 等事件。
// 排版是极简的「按字数分页」：够验证界面（菜单、设置即时生效、进度条、状态栏、自动滚屏）即可，不追求真实排版。
import type { Book, Locator, TextRange } from '@/core/book';
import type { Decoration, GoToTarget, ReaderController, ReaderEvents, ReaderLocation, ReaderSelection } from '@/core/reader';
import { textSettings } from '@/reader/settings';
import { mockChapterText } from './mock-book';

type Listener = (p: never) => void;

export class MockReader implements ReaderController {
  readonly book: Book;
  private container: HTMLElement | null = null;
  private pageEl: HTMLElement | null = null;
  private section = 0;
  private offset = 0;
  private cpp = 400; // 每页字数
  private texts: string[] = [];
  private listeners = new Map<string, Set<Listener>>();
  private auto: ReturnType<typeof setInterval> | undefined;
  private offSettings: (() => void) | undefined;
  private decorations = new Map<string, Decoration[]>();
  destroyed = false;
  /** 测试用：事件日志 */
  readonly calls: string[] = [];

  constructor(book: Book) {
    this.book = book;
    const n = book.kind === 'fixed' ? book.pageCount : book.sections.length;
    this.texts = Array.from({ length: n }, (_, i) => (book.kind === 'fixed' ? `page ${i + 1}` : mockChapterText(i).join('')));
  }

  // ───────── 生命周期 ─────────
  async open(container: HTMLElement, at?: Locator): Promise<void> {
    this.calls.push('open');
    this.container = container;
    this.section = Math.max(0, Math.min(this.texts.length - 1, at?.section ?? 0));
    this.offset = at?.offset ?? 0;
    container.tabIndex = 0;
    container.style.outline = 'none';
    container.innerHTML = '';
    this.pageEl = document.createElement('div');
    this.pageEl.setAttribute('data-mock-page', '');
    Object.assign(this.pageEl.style, { position: 'absolute', inset: '0', overflow: 'hidden', whiteSpace: 'pre-wrap' });
    container.appendChild(this.pageEl);
    this.bindPointer(container);
    this.offSettings = textSettings.subscribe(() => void this.relayout());
    await this.relayout();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopAutoScroll();
    this.offSettings?.();
    this.container && (this.container.innerHTML = '');
    this.listeners.clear();
  }

  // ───────── 排版/渲染 ─────────
  async relayout(): Promise<void> {
    const c = this.container;
    if (!c || !this.pageEl) return;
    const t = textSettings.get();
    const w = Math.max(100, (c.clientWidth || 360) - t.leftMargin - t.rightMargin);
    const h = Math.max(100, (c.clientHeight || 640) - t.topMargin - t.bottomMargin);
    const lh = t.fontSize * (1.3 + t.lineSpace / 10 - 0.3);
    this.cpp = Math.max(40, Math.floor(Math.floor(w / (t.fontSize * 1.05)) * Math.floor(h / lh) * 0.85));
    this.draw();
    this.emitRelocate();
  }

  private draw(): void {
    const el = this.pageEl;
    if (!el) return;
    const t = textSettings.get();
    const page = Math.floor(this.offset / this.cpp);
    const text = this.texts[this.section].slice(page * this.cpp, (page + 1) * this.cpp);
    el.style.padding = `${t.topMargin}px ${t.rightMargin}px ${t.bottomMargin}px ${t.leftMargin}px`;
    el.style.color = t.fontColor;
    el.style.fontSize = `${t.fontSize}px`;
    el.style.lineHeight = String(1.3 + t.lineSpace / 10 - 0.3);
    el.style.fontFamily = /^(font|server):/.test(t.fontName) ? 'serif' : t.fontName;
    el.style.fontWeight = t.fontBold ? '700' : '400';
    el.style.fontStyle = t.fontItalic ? 'italic' : 'normal';
    el.style.textDecoration = t.fontUnderline ? 'underline' : 'none';
    el.style.textAlign = t.textJustified ? 'justify' : 'left';
    el.style.letterSpacing = `${t.fontSpace / 20}em`;
    el.style.textShadow = t.fontShadow ? '1px 1px 1px #8888' : 'none';
    el.textContent = `${text}`;
  }

  // ───────── 位置 ─────────
  private get totalChars(): number {
    return this.texts.reduce((a, s) => a + s.length, 0);
  }

  getLocation(): ReaderLocation | null {
    if (!this.container) return null;
    const len = this.texts[this.section].length;
    const pages = Math.max(1, Math.ceil(len / this.cpp));
    const page = Math.min(pages, Math.floor(this.offset / this.cpp) + 1);
    const before = this.texts.slice(0, this.section).reduce((a, s) => a + s.length, 0);
    const progress = (before + Math.floor(this.offset / this.cpp) * this.cpp) / Math.max(1, this.totalChars);
    const last = this.texts.length - 1;
    const sec = this.book.kind === 'fixed' ? undefined : this.book.sections[this.section];
    return {
      locator: { section: this.section, offset: Math.floor(this.offset / this.cpp) * this.cpp },
      progress: Math.min(1, progress),
      section: this.section,
      sectionTitle: sec?.title,
      page,
      pages,
      bookPage: Math.floor((before + this.offset) / this.cpp) + 1,
      bookPages: Math.ceil(this.totalChars / this.cpp),
      visible: { section: this.section, start: (page - 1) * this.cpp, end: Math.min(len, page * this.cpp) },
      atStart: this.section === 0 && page === 1,
      atEnd: this.section === last && page === pages,
    };
  }

  private emitRelocate(): void {
    const loc = this.getLocation();
    if (loc) this.emit('relocate', loc);
  }

  async next(): Promise<void> {
    this.calls.push('next');
    const len = this.texts[this.section].length;
    const page = Math.floor(this.offset / this.cpp);
    if ((page + 1) * this.cpp < len) this.offset = (page + 1) * this.cpp;
    else if (this.section < this.texts.length - 1) {
      this.section++;
      this.offset = 0;
    } else {
      this.emit('endOfBook', undefined as never);
      return;
    }
    this.draw();
    this.emitRelocate();
  }

  async prev(): Promise<void> {
    this.calls.push('prev');
    const page = Math.floor(this.offset / this.cpp);
    if (page > 0) this.offset = (page - 1) * this.cpp;
    else if (this.section > 0) {
      this.section--;
      this.offset = Math.max(0, Math.floor((this.texts[this.section].length - 1) / this.cpp) * this.cpp);
    } else return;
    this.draw();
    this.emitRelocate();
  }

  async nextSection(): Promise<void> {
    this.calls.push('nextSection');
    if (this.section < this.texts.length - 1) {
      this.section++;
      this.offset = 0;
      this.draw();
      this.emitRelocate();
    }
  }

  async prevSection(): Promise<void> {
    this.calls.push('prevSection');
    if (this.offset > 0) this.offset = 0;
    else if (this.section > 0) this.section--;
    this.draw();
    this.emitRelocate();
  }

  async goTo(target: GoToTarget): Promise<void> {
    this.calls.push(`goTo:${JSON.stringify(target)}`);
    if ('progress' in target) {
      let at = Math.floor(target.progress * this.totalChars);
      let s = 0;
      while (s < this.texts.length - 1 && at >= this.texts[s].length) at -= this.texts[s++].length;
      this.section = s;
      this.offset = Math.max(0, at);
    } else if ('range' in target) {
      this.section = target.range.section;
      this.offset = target.range.start;
    } else if ('section' in target && 'offset' in target) {
      this.section = Math.max(0, Math.min(this.texts.length - 1, target.section));
      this.offset = target.offset;
    } else if ('section' in target) {
      this.section = Math.max(0, Math.min(this.texts.length - 1, target.section));
      this.offset = 0;
    }
    this.draw();
    this.emitRelocate();
  }

  async getSectionText(section: number): Promise<string> {
    return this.texts[section] ?? '';
  }

  async getSectionTextWithBreaks(section: number): Promise<{ text: string; breaks: number[] }> {
    return { text: await this.getSectionText(section), breaks: [] };
  }

  // ───────── 装饰/选择（假实现） ─────────
  setDecorations(layer: string, decorations: Decoration[]): void {
    this.decorations.set(layer, decorations);
  }
  getRangeRects(_range: TextRange): DOMRect[] {
    return [];
  }
  isRangeVisible(_range: TextRange): boolean {
    return false;
  }
  getSelection(): ReaderSelection | null {
    return null;
  }
  setSelection(_range: TextRange | null): void {}

  // ───────── 自动滚屏（每 700ms 翻一页） ─────────
  startAutoScroll(): void {
    this.calls.push('startAutoScroll');
    if (this.auto) return;
    this.auto = setInterval(() => void this.next(), 700);
    this.emit('autoScroll', { running: true, speed: 50 });
  }
  stopAutoScroll(): void {
    if (!this.auto) return;
    this.calls.push('stopAutoScroll');
    clearInterval(this.auto);
    this.auto = undefined;
    this.emit('autoScroll', { running: false, speed: 50 });
  }
  isAutoScrolling(): boolean {
    return !!this.auto;
  }

  // ───────── 事件 ─────────
  on<K extends keyof ReaderEvents>(type: K, fn: (payload: ReaderEvents[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as Listener);
    return () => set!.delete(fn as Listener);
  }

  emit<K extends keyof ReaderEvents>(type: K, payload: ReaderEvents[K]): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) (fn as (p: ReaderEvents[K]) => void)(payload);
  }

  /** 把容器上的指针/键盘操作翻译成引擎事件（真实引擎的职责） */
  private bindPointer(c: HTMLElement): void {
    let down: { x: number; y: number; t: number; timer?: ReturnType<typeof setTimeout>; fired: boolean; moved: boolean } | null = null;
    const norm = (e: PointerEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };
    c.addEventListener('pointerdown', (e) => {
      const { x, y } = norm(e);
      down = { x: e.clientX, y: e.clientY, t: Date.now(), fired: false, moved: false };
      down.timer = setTimeout(() => {
        if (down && !down.moved) {
          down.fired = true;
          this.emit('longPress', { x, y });
        }
      }, 450);
    });
    c.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dy = e.clientY - down.y;
      if (Math.abs(dy) > 6 || Math.abs(e.clientX - down.x) > 6) down.moved = true;
      if (down.moved) {
        const r = c.getBoundingClientRect();
        this.emit('verticalDrag', { startX: down.x - r.left, dy, phase: 'move' });
      }
    });
    const up = (e: PointerEvent) => {
      if (!down) return;
      clearTimeout(down.timer);
      const d = down;
      down = null;
      if (d.moved) {
        const r = c.getBoundingClientRect();
        this.emit('verticalDrag', { startX: d.x - r.left, dy: e.clientY - d.y, phase: 'end' });
        return;
      }
      if (!d.fired) this.emit('tap', norm(e));
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => down && clearTimeout(down.timer));
    c.addEventListener('keydown', (e) => this.emit('key', { key: e.key, code: e.code, event: e }));
  }
}
