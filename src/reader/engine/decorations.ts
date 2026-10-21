// 装饰（高亮/下划线/删除线/波浪线/搜索/朗读高亮/选区）：不改文本节点，偏移不受影响。
// 首选 CSS Custom Highlight API（浏览器负责在文字下面绘制，不用管布局变化）；box/note-mark 以及没有该 API 的浏览器用覆盖层。
// 命中检测（decorationClick）靠偏移区间比较：装饰按图层存放，后加入的图层、后出现的装饰在上。
import type { Decoration, DecorationStyle } from '@/core/reader';
import type { TextRange } from '@/core/book';
import type { ChapterFrame } from './frame';
import type { Engine } from './controller';
import { invalidateRaster } from './raster';

export const DECO_DEFAULT_COLOR: Record<DecorationStyle, string> = {
  highlight: 'rgba(255,213,0,0.40)',
  underline: '#e53935',
  strikethrough: '#e53935',
  squiggly: '#e53935',
  box: '#1e88e5',
  'note-mark': '#f9a825',
  search: 'rgba(255,152,0,0.50)',
  tts: 'rgba(66,133,244,0.38)',
};

interface HighlightApi {
  highlights: Map<string, unknown>;
}

function hasHighlightApi(win: Window): boolean {
  const w = win as unknown as { CSS?: HighlightApi; Highlight?: unknown };
  return !!w.CSS?.highlights && typeof w.Highlight === 'function';
}

function declFor(style: DecorationStyle, color: string): string {
  switch (style) {
    case 'underline':
      return `text-decoration:underline solid ${color} 2px;text-underline-offset:3px;background:none`;
    case 'strikethrough':
      return `text-decoration:line-through solid ${color} 2px;background:none`;
    case 'squiggly':
      return `text-decoration:underline wavy ${color} 1.5px;text-underline-offset:3px;background:none`;
    default:
      return `background-color:${color}`;
  }
}

export class Decorations {
  private layers = new Map<string, Decoration[]>();
  private flashTimer?: ReturnType<typeof setTimeout>;

  constructor(private e: Engine) {}

  set(layer: string, list: Decoration[]): void {
    if (list.length) this.layers.set(layer, list.slice());
    else this.layers.delete(layer);
    for (const f of this.e.frames.values()) this.applyTo(f);
    for (const f of this.e.spares.values()) this.applyTo(f);
  }

  /** 该图层某章节的装饰数（测试/调试用） */
  count(layer: string, section: number): number {
    return (this.layers.get(layer) ?? []).filter((d) => d.range.section === section).length;
  }

  /** 把全部图层画到某个章节框里（章节加载完成、装饰变化、布局变化后调用） */
  applyTo(f: ChapterFrame): void {
    if (!f.loaded && !f.doc) return;
    const doc = f.doc;
    if (!doc?.body) return;
    invalidateRaster(f);
    const win = f.win;
    const useApi = hasHighlightApi(win);
    // 清理旧覆盖层与旧样式
    doc.getElementById('mr-deco-style')?.remove();
    doc.getElementById('mr-deco-overlay')?.remove();
    const w = win as unknown as { CSS: HighlightApi; Highlight: new (...r: Range[]) => unknown };
    if (useApi) for (const k of [...w.CSS.highlights.keys()]) if (String(k).startsWith('mr-')) w.CSS.highlights.delete(k);

    const groups = new Map<string, { style: DecorationStyle; color: string; ranges: Range[] }>();
    const overlayItems: Array<{ style: DecorationStyle; color: string; range: Range }> = [];
    for (const [, list] of this.layers) {
      for (const d of list) {
        if (d.range.section !== f.section) continue;
        const r = f.text.range(d.range.start, d.range.end);
        if (!r || r.collapsed) continue;
        const color = d.color ?? DECO_DEFAULT_COLOR[d.style];
        if (!useApi || d.style === 'box' || d.style === 'note-mark') {
          overlayItems.push({ style: d.style, color, range: r });
          continue;
        }
        const key = `${d.style}|${color}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { style: d.style, color, ranges: [] }));
        g.ranges.push(r);
      }
    }
    if (groups.size) {
      let css = '';
      let i = 0;
      for (const g of groups.values()) {
        const name = `mr-${i++}`;
        css += `::highlight(${name}){${declFor(g.style, g.color)}}`;
        w.CSS.highlights.set(name, new w.Highlight(...g.ranges));
      }
      const st = doc.createElement('style');
      st.id = 'mr-deco-style';
      st.textContent = css;
      doc.head.appendChild(st);
    }
    if (overlayItems.length) this.paintOverlay(f, overlayItems);
  }

  /** 覆盖层：绝对定位的小块，放在 html 下（body 之外，不进入文本索引） */
  private paintOverlay(f: ChapterFrame, items: Array<{ style: DecorationStyle; color: string; range: Range }>): void {
    const doc = f.doc;
    const host = doc.createElement('div');
    host.id = 'mr-deco-overlay';
    host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2';
    for (const it of items) {
      const rects = Array.from(it.range.getClientRects());
      rects.forEach((r, idx) => {
        if (r.width < 0.5 || r.height < 0.5) return;
        const el = doc.createElement('div');
        const base = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;`;
        switch (it.style) {
          case 'box':
            el.style.cssText = `${base}border:1.5px solid ${it.color};border-radius:3px`;
            break;
          case 'note-mark':
            if (idx !== rects.length - 1) return;
            el.style.cssText = `position:absolute;left:${r.right - 2}px;top:${r.top - 4}px;width:10px;height:10px;background:${it.color};border-radius:2px 2px 2px 0;box-shadow:0 0 2px rgba(0,0,0,.4)`;
            break;
          case 'underline':
            el.style.cssText = `${base}border-bottom:2px solid ${it.color}`;
            break;
          case 'strikethrough':
            el.style.cssText = `${base}background:linear-gradient(${it.color},${it.color}) center/100% 2px no-repeat`;
            break;
          case 'squiggly':
            el.style.cssText = `${base}border-bottom:2px dotted ${it.color}`;
            break;
          default:
            el.style.cssText = `${base}background:${it.color};mix-blend-mode:multiply`;
        }
        host.appendChild(el);
      });
    }
    doc.documentElement.appendChild(host);
  }

  /** 闪一下某个区间（goTo 的 flash） */
  flash(range: TextRange): void {
    clearTimeout(this.flashTimer);
    this.set('__flash', [{ id: 'flash', range, style: 'highlight', color: 'rgba(255,120,0,0.45)' }]);
    this.flashTimer = setTimeout(() => this.set('__flash', []), 1400);
  }

  /** 偏移处最上面的那条装饰（不含内部图层 __ 开头的） */
  hit(f: ChapterFrame, offset: number): { layer: string; id: string; range: TextRange } | null {
    let found: { layer: string; id: string; range: TextRange } | null = null;
    for (const [layer, list] of this.layers) {
      if (layer.startsWith('__') || layer === 'search' || layer === 'tts') continue;
      for (const d of list) {
        if (d.range.section === f.section && offset >= d.range.start && offset < d.range.end) found = { layer, id: d.id, range: d.range };
      }
    }
    return found;
  }

  rectOfDecoration(f: ChapterFrame, d: { range: TextRange }): DOMRect {
    const rs = this.rectsIn(f, d.range);
    return rs[0] ?? new DOMRect(0, 0, 0, 0);
  }

  /** 区间在浏览器视口中的矩形；不在当前屏的部分不返回 */
  private rectsIn(f: ChapterFrame, range: TextRange): DOMRect[] {
    const r = f.text.range(range.start, range.end);
    if (!r) return [];
    const o = f.origin();
    return Array.from(r.getClientRects()).map((q) => new DOMRect(q.left + o.left, q.top + o.top, q.width, q.height));
  }

  /** 双页时同一章有主/副两个副本，各自露出一个窗口：矩形要从露出该行的那个副本取 */
  private dualFrames(section: number): ChapterFrame[] {
    const e = this.e;
    const f = e.frames.get(section);
    if (!f?.loaded) return [];
    const sp = e.dualNow() ? e.spares.get(section) : undefined;
    return sp?.loaded ? [f, sp] : [f];
  }

  private inHost(r: DOMRect, fr: ChapterFrame, eps = 1): boolean {
    if (fr.host.style.visibility === 'hidden') return false;
    const h = fr.host.getBoundingClientRect();
    return r.top >= h.top - eps && r.bottom <= h.bottom + eps && r.left >= h.left - eps && r.right <= h.right + eps;
  }

  rects(range: TextRange): DOMRect[] {
    const e = this.e;
    const f = e.frames.get(range.section);
    if (!f?.loaded) return [];
    if (e.dualNow()) {
      const out: DOMRect[] = [];
      for (const fr of this.dualFrames(range.section)) {
        const h = fr.host.getBoundingClientRect();
        if (fr.host.style.visibility === 'hidden') continue;
        for (const r of this.rectsIn(fr, range)) {
          if (r.bottom > h.top && r.top < h.bottom && r.right > h.left && r.left < h.right) out.push(r);
        }
      }
      return out;
    }
    const stage = e.stage!.getBoundingClientRect();
    return this.rectsIn(f, range).filter((r) => r.bottom > stage.top && r.top < stage.bottom && r.right > stage.left && r.left < stage.right);
  }

  /** 区间是否完整落在当前窗口内（朗读判断要不要翻页） */
  isVisible(range: TextRange): boolean {
    const e = this.e;
    const f = e.frames.get(range.section);
    if (!f?.loaded) return false;
    // 当前屏 = 当前章当前窗口（分页模式只有当前章可见）
    if (e.mode === 'paged' && range.section !== e.pos.section) return false;
    const rs = this.rectsIn(f, range);
    if (!rs.length) return false;
    if (e.dualNow()) {
      const sp = e.spares.get(range.section);
      const rb = sp?.loaded ? this.rectsIn(sp, range) : [];
      return rs.every((r, i) => this.inHost(r, f) || (!!sp && !!rb[i] && this.inHost(rb[i], sp)));
    }
    const stage = e.stage!.getBoundingClientRect();
    const eps = 1;
    const first = rs[0];
    const last = rs[rs.length - 1];
    return first.top >= stage.top - eps && last.bottom <= stage.bottom + eps && rs.every((r) => r.left >= stage.left - eps && r.right <= stage.right + eps);
  }
}
