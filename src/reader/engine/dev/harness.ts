// 引擎开发测试页：vite dev 直接打开 /src/reader/engine/dev/harness.html?chapters=3&flip=0
// 通过 window.__h 暴露引擎与设置，供 Playwright 端到端测试驱动。
import { createReader } from '../index';
import { autoScrollSettings, controlSettings, cssSettings, fixedSettings, flipSettings, screenSettings, textSettings, themeSettings } from '../../settings';
import { makeMockBook, makeMockFixedBook } from './mock-book';
import type { ReaderController, ReaderEvents } from '@/core/reader';
import { nameSettings } from '../transforms';
import { rasterizePage } from '../raster';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);

const settings = { textSettings, cssSettings, flipSettings, controlSettings, screenSettings, themeSettings, autoScrollSettings, nameSettings, fixedSettings };
// 每次开页都从默认设置开始（localStorage 里可能有上次的）
for (const s of Object.values(settings)) s.reset();
flipSettings.set({ flipAnimation: num('flip', 0) as never, flipSpeed: num('speed', 30) });
textSettings.set({
  fontSize: num('fs', 18),
  topMargin: num('mt', 20),
  bottomMargin: num('mb', 20),
  leftMargin: num('ml', 20),
  rightMargin: num('mr', 20),
  ...(q.get('theme') === 'night' ? { fontColor: '#CCCCCC', backgroundColor: '#000000' } : {}),
});
if (q.get('dual')) screenSettings.set({ dualPage: q.get('dual') as 'on' | 'off' | 'auto' });
if (q.get('fixed')) {
  fixedSettings.set({
    pdfViewMode: num('view', 1) as 0 | 1 | 2,
    fitMode: (q.get('fit') ?? 'page') as 'page' | 'width' | 'height',
    flipPdf: num('flip', 0) as never,
    pdfTheme: num('night', 0) as 0 | 1,
    comicRtl: q.get('rtl') === '1',
    pdfScrollLock: q.get('lock') === '1',
    fitDifferentPageSize: q.get('unify') === '1',
  });
}

const host = document.getElementById('reader')!;
if (q.has('w')) {
  host.style.inset = 'auto';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = `${num('w', 412)}px`;
  host.style.height = `${num('h', 800)}px`;
}

const nums = (k: string) => (q.get(k) ? q.get(k)!.split(',').map(Number) : undefined);
const loadBook = async () => {
  const src = q.get('src');
  if (src) {
    const { openBook } = await import('@/formats');
    const res = await fetch(src);
    const blob = await res.blob();
    const name = decodeURIComponent(src.split('/').pop() ?? 'book');
    return openBook(new File([blob], name), { fileName: name });
  }
  return q.get('fixed')
  ? makeMockFixedBook({ pages: num('fpages', 12), comic: q.get('comic') === '1', wide: nums('wide'), tall: nums('tall'), direction: q.get('rtl') === '1' ? 'rtl' : undefined, delay: num('delay', 0) })
  : makeMockBook({
  chapters: num('chapters', 3),
  paragraphs: num('paras', 30),
  lang: (q.get('lang') as 'zh' | 'en') ?? 'zh',
  imageEvery: num('img', 0),
  delay: num('delay', 0),
  nonLinear: q.get('nonlinear') ? q.get('nonlinear')!.split(',').map(Number) : undefined,
  css: q.get('css') ?? undefined,
});
};
const book = await loadBook();
const reader = createReader(book) as ReaderController;
const events: Array<{ type: string; payload: unknown; t: number }> = [];
const names: Array<keyof ReaderEvents> = ['relocate', 'sectionReady', 'tap', 'longPress', 'doubleTap', 'swipe', 'verticalDrag', 'pinch', 'selection', 'link', 'image', 'decorationClick', 'key', 'autoScroll', 'endOfBook', 'error'];
for (const n of names) {
  reader.on(n, (payload) => {
    let p: unknown = payload;
    if (n === 'sectionReady') p = { section: (payload as { section: number }).section };
    if (n === 'key') p = { key: (payload as { key: string }).key };
    events.push({ type: n, payload: JSON.parse(JSON.stringify(p ?? null, (_k, v) => (v instanceof DOMRect ? { x: v.x, y: v.y, w: v.width, h: v.height } : v))), t: performance.now() });
  });
}
const h = { reader, book, events, settings, ready: false, error: '' as string };
(window as unknown as { __h: typeof h }).__h = h;
const at = q.has('section') ? { section: num('section', 0), offset: num('offset', 0) } : undefined;
const doOpen = () =>
  reader
    .open(host, at)
    .then(() => (h.ready = true))
    .catch((e) => (h.error = String(e?.stack ?? e)));
Object.assign(h, { open: doOpen, host });
// ?noopen=1：不自动打开，测试自己调 h.open()（验证 open 之前的查询方法不抛错）
if (q.has('noopen')) h.ready = true;
else void doOpen();

// ───── 测试辅助 ─────
type AnyEngine = {
  pos: { section: number; y: number };
  frames: Map<number, { text: { nodes: Text[] }; doc: Document; height: number; origin(): { left: number; top: number }; getLines(): Array<{ top: number; bottom: number }> }>;
  stage: HTMLElement;
  H: number;
  W: number;
  mode: string;
};
const E = () => reader as unknown as AnyEngine;
/** 文字框被窗口上/下边裁掉超过 30% 才算「切行」（字体盒上下有空隙，紧凑标题的字体盒会互相压到几个像素） */
const isCut = (top: number, bottom: number, wTop: number, wBottom: number): boolean => {
  const hgt = Math.max(1, bottom - top);
  return (top < wTop - 1 && bottom > wTop + 2 && (wTop - top) > 0.3 * hgt) || (top < wBottom - 1 && bottom > wBottom + 1 && (bottom - wBottom) > 0.3 * hgt);
};
Object.assign(h, {
  /** 当前窗口里被舞台上下边裁断的文字行（整行翻页应当为 0） */
  cutDetail(): unknown[] {
    const e = E();
    const f = e.frames.get(e.pos.section)!;
    const st = (f as unknown as { host: HTMLElement }).host.getBoundingClientRect();
    const o = f.origin();
    const out: unknown[] = [];
    const r = f.doc.createRange();
    for (const n of f.text.nodes) {
      r.selectNodeContents(n);
      for (const q of Array.from(r.getClientRects())) {
        const top = q.top + o.top;
        const bottom = q.bottom + o.top;
        if (q.height < 1) continue;
        if (isCut(top, bottom, st.top, st.bottom)) out.push({ text: n.data.slice(0, 12), top, bottom, stTop: st.top, stBottom: st.bottom, pos: { ...e.pos }, lines: f.getLines().filter((l) => l.top > e.pos.y - 5 && l.top < e.pos.y + 60).slice(0, 3) });
      }
    }
    return out;
  },
  cutLines(): number {
    const e = E();
    const f = e.frames.get(e.pos.section)!;
    const st = (f as unknown as { host: HTMLElement }).host.getBoundingClientRect();
    const o = f.origin();
    let cut = 0;
    const r = f.doc.createRange();
    for (const n of f.text.nodes) {
      r.selectNodeContents(n);
      for (const q of Array.from(r.getClientRects())) {
        const top = q.top + o.top;
        const bottom = q.bottom + o.top;
        if (q.height < 1) continue;
        if (isCut(top, bottom, st.top, st.bottom)) cut++;
      }
    }
    return cut;
  },
  state() {
    const e = E();
    const f = e.frames.get(e.pos.section);
    return { pos: { ...e.pos }, H: e.H, W: e.W, mode: e.mode, height: f?.height ?? 0, frames: [...e.frames.keys()] };
  },
});

Object.assign(h, {
  async rasterDataUrl(dy = 0) {
    const e = reader as any;
    const f = e.frames.get(e.pos.section);
    const y = e.pos.y + dy;
    const t0 = performance.now();
    const c = await rasterizePage({ frame: f, y, clipH: e.pageClip(f, y), box: { w: e.boxW, h: e.boxH }, inset: { l: e.inset.l, t: e.inset.t }, width: e.W, background: e.root.style.background || e.root.style.backgroundColor, dpr: devicePixelRatio });
    const ms = performance.now() - t0;
    return { url: c.toDataURL('image/png'), ms, w: c.width, h: c.height };
  },
});

Object.assign(h, {
  async freeze(dir: 1 | -1, anim: number, p: number) {
    return (reader as any).animator.debugShow(dir, anim, p);
  },
  freezeKind() {
    return (reader as any).animator.debugKind();
  },
  unfreeze() {
    (reader as any).animator.cancel();
  },
});

Object.assign(h, {
  /** 固定版式引擎状态 */
  fstate() {
    const e = reader as any;
    return { page: e.page, z: e.z, tx: e.tx, ty: e.ty, sy: e.sy, cx: e.cx, mode: e.mode, gw: e.gw, gh: e.gh, views: [...e.views.keys()], boxW: e.boxW, boxH: e.boxH, dual: e.dual, rtl: e.rtl };
  },
});

import { setKV } from '@/storage/db';
import { TEXTURES } from '../textures';
Object.assign(h, {
  setKV,
  textureCount: TEXTURES.length,
  /** 当前章 iframe 里某元素在浏览器视口中的矩形 */
  rectOf(id: string, section?: number) {
    const e = reader as any;
    const f = e.frames.get(section ?? e.pos.section);
    const el = f.doc.getElementById(id);
    if (!el) return null;
    const o = f.origin();
    const r = el.getBoundingClientRect();
    return { x: r.left + o.left, y: r.top + o.top, w: r.width, h: r.height };
  },
  /** 双页状态 */
  dualState() {
    const e = reader as any;
    const sp = e.spares.get(e.pos.section);
    const f = e.frames.get(e.pos.section);
    const box = (x: any) => (x ? (() => { const r = x.host.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vis: x.host.style.visibility }; })() : null);
    return { dual: e.dualNow(), pos: { ...e.pos }, rightTop: f ? e.rightTop(f, e.pos.y) : null, left: box(f), right: box(sp), W: e.W, H: e.H, rightPageX: e.rightPageX };
  },
  /** 取某章 iframe 里元素的计算样式 */
  styleOf(sel: string, prop: string, section?: number) {
    const e = reader as any;
    const f = e.frames.get(section ?? e.pos.section);
    const el = f.doc.querySelector(sel);
    return el ? f.win.getComputedStyle(el)[prop] : null;
  },
});
