// 页面栅格化：把章节 iframe 的某个窗口画到 canvas，给仿真翻页做纹理（以及 Canvas2D 降级）。
// 做法：序列化 iframe 文档 → 放进 SVG <foreignObject>（blob: 资源换成 data:）→ 当图片解码 → drawImage。
// 同一份 HTML+CSS 在同样宽度下由浏览器自己排版，所以和屏幕上的页面几乎一致；不依赖第三方库。
// 注意：foreignObject 里没有脚本、不加载外部资源，所以所有图片/字体必须是 data: URL。
import type { ChapterFrame } from './frame';

export interface RasterOptions {
  frame: ChapterFrame;
  /** 窗口顶（章节内容坐标） */
  y: number;
  /** 窗口可见高度 */
  clipH: number;
  /** 整个阅读区（含页边距）尺寸 */
  box: { w: number; h: number };
  /** 文字区左上角在阅读区内的位置 */
  inset: { l: number; t: number };
  /** 文字区宽度 */
  width: number;
  /** 背景（CSS background 简写值）与回退色 */
  background: string;
  dpr: number;
}

const dataUrlCache = new Map<string, Promise<string>>();

function blobToDataUrl(url: string): Promise<string> {
  let p = dataUrlCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(b);
          }),
      );
    dataUrlCache.set(url, p);
  }
  return p;
}

/** 把字符串里所有 blob: URL 换成 data: URL */
export async function inlineBlobUrls(html: string): Promise<string> {
  const urls = Array.from(new Set(html.match(/blob:[^"')\s<>]+/g) ?? []));
  if (!urls.length) return html;
  const map = new Map<string, string>();
  await Promise.all(
    urls.map(async (u) => {
      try {
        map.set(u, await blobToDataUrl(u));
      } catch {
        map.set(u, '');
      }
    }),
  );
  return html.replace(/blob:[^"')\s<>]+/g, (u) => map.get(u) ?? u);
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 序列化缓存：同一章只序列化+内联一次（窗口位置不同只改外层 top） */
const serialCache = new WeakMap<ChapterFrame, Promise<string>>();

function serializeFrame(frame: ChapterFrame): Promise<string> {
  let p = serialCache.get(frame);
  if (!p) {
    const doc = frame.doc;
    // 装饰覆盖层（box/note-mark）随文档一起序列化；CSS Highlight 画的不在 DOM 里，纹理里看不到（翻页瞬间可接受）
    const xml = new XMLSerializer().serializeToString(doc.documentElement);
    p = inlineBlobUrls(xml);
    serialCache.set(frame, p);
  }
  return p;
}

const textureCache = new WeakMap<ChapterFrame, Map<string, Promise<HTMLCanvasElement>>>();

export function invalidateRaster(frame: ChapterFrame): void {
  serialCache.delete(frame);
  textureCache.delete(frame);
}

/** 带缓存的页纹理：翻页后空闲时预取相邻页，手指按下时就不用再等 */
export function getPageTexture(o: RasterOptions): Promise<HTMLCanvasElement> {
  let m = textureCache.get(o.frame);
  if (!m) textureCache.set(o.frame, (m = new Map()));
  const key = `${Math.round(o.y)}|${o.clipH}|${o.box.w}x${o.box.h}|${o.dpr}|${o.background.length}`;
  let p = m.get(key);
  if (!p) {
    p = rasterizePage(o);
    p.catch(() => m!.delete(key));
    m.set(key, p);
    if (m.size > 6) m.delete(m.keys().next().value as string);
  }
  return p;
}

export async function rasterizeSvg(o: RasterOptions): Promise<HTMLImageElement> {
  const html = await serializeFrame(o.frame);
  const { w, h } = o.box;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${escAttr(o.background)}">` +
    `<div style="position:absolute;left:${o.inset.l}px;top:${o.inset.t}px;width:${o.width}px;height:${o.clipH}px;overflow:hidden">` +
    `<div style="position:absolute;left:0;top:${-o.y}px;width:${o.width}px">${html}</div>` +
    `</div></div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

/** 栅格化成 canvas（尺寸 = 阅读区 × dpr） */
export async function rasterizePage(o: RasterOptions): Promise<HTMLCanvasElement> {
  const img = await rasterizeSvg(o);
  const c = document.createElement('canvas');
  c.width = Math.round(o.box.w * o.dpr);
  c.height = Math.round(o.box.h * o.dpr);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** 纹理的平均色（背面着色用）：缩到很小再取均值 */
export function averageColor(c: HTMLCanvasElement): [number, number, number] {
  const s = document.createElement('canvas');
  s.width = 16;
  s.height = 16;
  const ctx = s.getContext('2d')!;
  ctx.drawImage(c, 0, 0, 16, 16);
  let r = 0;
  let g = 0;
  let b = 0;
  try {
    const d = ctx.getImageData(0, 0, 16, 16).data;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    return [r / n, g / n, b / n];
  } catch {
    return [235, 230, 215];
  }
}
