// 文字选择：桌面用浏览器原生选择（selectionchange 去抖后上报）；触屏长按选词 + 程序化选区（手柄由 features 画，拖动时调 setSelection）。
// 触屏上正文是 user-select:none（避免系统自带的选择菜单/手柄和我们的冲突），所以选区高亮走装饰层 '__selection'。
import type { TextRange } from '@/core/book';
import type { ReaderSelection } from '@/core/reader';
import { caretAt } from './gestures';
import type { ChapterFrame } from './frame';
import type { Engine } from './controller';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const SEP = /[\s　/,.;?"':(){}[\]!，。；＂”“：？《》（）、！’‘\n\t<>—-]/;

export class SelectionManager {
  private cur: { range: TextRange; frame: ChapterFrame } | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private silent = 0;
  private coarse: boolean;

  constructor(private e: Engine) {
    this.coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  destroy(): void {
    clearTimeout(this.timer);
  }

  private build(frame: ChapterFrame, range: TextRange): ReaderSelection | null {
    const r = frame.text.range(range.start, range.end);
    if (!r) return null;
    const o = frame.origin();
    const b = r.getBoundingClientRect();
    return { range, text: r.toString(), rect: new DOMRect(b.left + o.left, b.top + o.top, b.width, b.height) };
  }

  get(): ReaderSelection | null {
    if (!this.cur) return null;
    return this.build(this.cur.frame, this.cur.range);
  }

  set(range: TextRange | null): void {
    const e = this.e;
    const had = this.cur;
    if (!range || range.end <= range.start) {
      this.clearVisual();
      this.cur = null;
      if (had) e.emit('selection', null);
      return;
    }
    let frame = e.frames.get(range.section);
    // 双页：区间起点在右页窗口里时，选区要落在副本上才能看见
    const sp = e.dualNow() ? e.spares.get(range.section) : undefined;
    if (frame?.loaded && sp?.loaded && e.pos.section === range.section) {
      const ry = e.rightTop(frame, e.pos.y);
      if (ry !== null && range.start >= sp.offsetAtTop(ry)) frame = sp;
    }
    if (!frame?.loaded) {
      void e.ensureFrame(range.section).then(() => this.set(range)).catch(() => undefined);
      return;
    }
    const dom = frame.text.range(range.start, range.end);
    if (!dom) return;
    this.clearVisual();
    if (this.coarse) {
      e.decorations.set('__selection', [{ id: 'sel', range, style: 'highlight', color: 'rgba(66,133,244,0.40)' }]);
    } else {
      const sel = frame.win.getSelection();
      if (sel) {
        this.silent++;
        sel.removeAllRanges();
        sel.addRange(dom);
      }
    }
    this.cur = { range, frame };
    const out = this.build(frame, range);
    if (out) e.emit('selection', out);
  }

  private clearVisual(): void {
    if (this.coarse) this.e.decorations.set('__selection', []);
    const f = this.cur?.frame;
    const sel = f?.win?.getSelection();
    if (sel && sel.rangeCount) {
      this.silent++;
      sel.removeAllRanges();
    }
  }

  /** 原生选择变化（桌面鼠标拖选、双击选词、键盘扩选） */
  onNativeChange(frame: ChapterFrame): void {
    if (this.silent > 0) {
      this.silent--;
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const sel = frame.win.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        if (this.cur) {
          this.cur = null;
          this.e.emit('selection', null);
        }
        return;
      }
      const { start, end } = frame.text.offsetsOfRange(sel.getRangeAt(0));
      if (end <= start) return;
      const range = { section: frame.section, start, end };
      this.cur = { range, frame };
      const out = this.build(frame, range);
      if (out) this.e.emit('selection', out);
    }, 180);
  }

  /** 长按选词（ANNO-001）：CJK 单字，其它语言按单词。pt 为阅读区坐标。成功返回 true */
  selectWordAt(frame: ChapterFrame, rootX: number, rootY: number): boolean {
    const o = this.e.toRoot(frame, 0, 0);
    const x = rootX - o.x;
    const y = rootY - o.y;
    const caret = caretAt(frame.doc, x, y);
    if (!caret) return false;
    let node = caret.node;
    let off = caret.offset;
    if (node.nodeType !== 3) {
      // 落在元素上：取该位置附近的文本节点
      const child = node.childNodes[Math.min(off, node.childNodes.length - 1)];
      const w = frame.doc.createTreeWalker(child ?? node, 4);
      const t = w.nextNode();
      if (!t) return false;
      node = t;
      off = 0;
    }
    const text = (node as Text).data;
    if (!text) return false;
    // 点位必须真的压在字上（点空白处不选）
    const probe = (k: number): boolean => {
      if (k < 0 || k >= text.length) return false;
      const r = frame.doc.createRange();
      r.setStart(node, k);
      r.setEnd(node, k + 1);
      for (const q of Array.from(r.getClientRects())) {
        if (x >= q.left - 6 && x <= q.right + 6 && y >= q.top - 4 && y <= q.bottom + 4) return true;
      }
      return false;
    };
    let at = off;
    if (!probe(at)) {
      if (probe(at - 1)) at -= 1;
      else return false;
    }
    if (at >= text.length) at = text.length - 1;
    let s = at;
    let en = at + 1;
    const ch = text[at];
    if (SEP.test(ch)) return false;
    if (!CJK.test(ch)) {
      const seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<{ index: number; segment: string; isWordLike?: boolean }> } }).Segmenter;
      if (seg) {
        for (const g of new seg(undefined, { granularity: 'word' }).segment(text)) {
          if (at >= g.index && at < g.index + g.segment.length) {
            s = g.index;
            en = g.index + g.segment.length;
            break;
          }
        }
      } else {
        while (s > 0 && !SEP.test(text[s - 1]) && !CJK.test(text[s - 1])) s--;
        while (en < text.length && !SEP.test(text[en]) && !CJK.test(text[en])) en++;
      }
    }
    const a = frame.text.offsetOfText(node as Text, s);
    const b = frame.text.offsetOfText(node as Text, en);
    if (a < 0 || b <= a) return false;
    this.set({ section: frame.section, start: a, end: b });
    return true;
  }
}
