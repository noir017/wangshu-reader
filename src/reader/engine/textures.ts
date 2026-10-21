// 内置背景纹理（THEME-006 / §5.3）：不复制 apk 里的图片，全部程序生成——纯色底 + SVG feTurbulence 噪点 + 暗角。
// 每个纹理的均色/风格参照规格 §5.3 的表格（小图平铺的均色是实测值，大图只有目视描述，均色是按主题字色/用途推的）。
// 导出清单给 reader/ui 的选择器用：{ id:'tex:…', name, avgColor, css }，css 可直接赋给 style.background。
import { getKV } from '@/storage/db';

export interface Texture {
  /** 'tex:<原图文件名去扩展名>'，对应设置 backgroundImage */
  id: string;
  name: string;
  avgColor: string;
  /** 完整的 background 简写值 */
  css: string;
  /** 原图是小图平铺（true）还是大图拉伸（false），仅作说明 */
  tile: boolean;
}

interface Spec {
  name: string;
  avg: string;
  tile: boolean;
  /** 噪点强度 0..1 */
  grain?: number;
  /** 噪点基础频率（越大越细） */
  freq?: number;
  /** 暗角强度 0..1 */
  vignette?: number;
  /** 横向纸纹线条强度 */
  fiber?: number;
}

const enc = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`;

function noiseSvg(size: number, freq: number, alpha: number, dark: boolean): string {
  // 噪点转成半透明黑/白点：alpha = k*R + b；黑色噪点 + 白色高光两张叠加更像纸
  const c = dark ? 1 : 0;
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<filter id='n' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='3' seed='7' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${c}  0 0 0 0 ${c}  0 0 0 0 ${c}  ${(alpha * 2).toFixed(3)} 0 0 0 ${(-alpha * 0.45).toFixed(3)}'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#n)'/></svg>`
  );
}

function fiberSvg(alpha: number, dark: boolean): string {
  const c = dark ? 255 : 0;
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>` +
    `<filter id='f' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.012 0.55' numOctaves='2' seed='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${c / 255}  0 0 0 0 ${c / 255}  0 0 0 0 ${c / 255}  ${(alpha * 2.2).toFixed(3)} 0 0 0 ${(-alpha).toFixed(3)}'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#f)'/></svg>`
  );
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return 0.299 * n(0) + 0.587 * n(2) + 0.114 * n(4);
}

function build(id: string, s: Spec): Texture {
  const dark = luminance(s.avg) < 110;
  const layers: string[] = [];
  const v = s.vignette ?? 0;
  if (v > 0) {
    const edge = dark ? `rgba(0,0,0,${(0.55 * v).toFixed(2)})` : `rgba(60,40,10,${(0.32 * v).toFixed(2)})`;
    layers.push(`radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 52%, ${edge} 100%) 0 0/100% 100% no-repeat`);
  }
  if ((s.fiber ?? 0) > 0) layers.push(`${enc(fiberSvg(s.fiber!, dark))} 0 0/240px 240px repeat`);
  if ((s.grain ?? 0) > 0) {
    const size = s.tile ? 80 : 160;
    layers.push(`${enc(noiseSvg(size, s.freq ?? 0.8, s.grain!, dark))} 0 0/${size}px ${size}px repeat`);
  }
  layers.push(s.avg);
  return { id: `tex:${id}`, name: s.name, avgColor: s.avg, css: layers.join(', '), tile: s.tile };
}

// 小图（80×80 平铺）的均色取规格实测值；大图按用途估色
const SPECS: Record<string, Spec> = {
  day161: { name: '日间纸 (day161)', avg: '#DCD8D1', tile: true, grain: 0.1, freq: 0.9 },
  night161: { name: '夜间磨砂 (night161)', avg: '#3A3A3A', tile: true, grain: 0.14, freq: 0.9 },
  readbg_00: { name: '米白 (00)', avg: '#F4F0E5', tile: true, grain: 0.07, freq: 0.85 },
  readbg_01: { name: '青灰 (01)', avg: '#99BABC', tile: true, grain: 0.1, freq: 0.8 },
  readbg_02: { name: '沙色 (02)', avg: '#DDC3A2', tile: true, grain: 0.1, freq: 0.8 },
  readbg_03: { name: '草绿 (03)', avg: '#8FAA7A', tile: true, grain: 0.1, freq: 0.8 },
  readbg_04: { name: '粉灰 (04)', avg: '#DAC5C3', tile: true, grain: 0.09, freq: 0.8 },
  readbg_05: { name: '炭黑 (05)', avg: '#232323', tile: true, grain: 0.16, freq: 0.9 },
  readbg_06: { name: '浅灰 (06)', avg: '#DCD7D1', tile: true, grain: 0.1, freq: 0.9 },
  readbg_11: { name: '淡黄纸 (11)', avg: '#EFEAD6', tile: false, grain: 0.08, freq: 0.85, vignette: 0.5, fiber: 0.04 },
  readbg_12: { name: '浅褐纸 (12)', avg: '#E4D9BC', tile: false, grain: 0.09, freq: 0.8, vignette: 0.6, fiber: 0.05 },
  readbg_13: { name: '近白纸 (13)', avg: '#F3F2EE', tile: false, grain: 0.05, freq: 0.85, vignette: 0.45 },
  readbg_14: { name: '米色颗粒 (14)', avg: '#EADFC8', tile: false, grain: 0.14, freq: 0.7, vignette: 0.3 },
  readbg_15: { name: '羊皮 (15)', avg: '#E6D5AE', tile: false, grain: 0.12, freq: 0.6, vignette: 0.7, fiber: 0.05 },
  readbg201: { name: '自然 (201)', avg: '#E3E8CD', tile: false, grain: 0.1, freq: 0.7, vignette: 0.4, fiber: 0.04 },
  readbg202: { name: '暖黄 (202)', avg: '#F1E2B8', tile: false, grain: 0.09, freq: 0.75, vignette: 0.5 },
  readbg203: { name: '古卷 (203)', avg: '#E9DDBF', tile: false, grain: 0.11, freq: 0.65, vignette: 0.55, fiber: 0.06 },
  readbg204: { name: '古卷深 (204)', avg: '#DFD0AB', tile: false, grain: 0.12, freq: 0.65, vignette: 0.65, fiber: 0.06 },
  readbg205: { name: '浅蓝灰 (205)', avg: '#DCE3E6', tile: false, grain: 0.07, freq: 0.8, vignette: 0.4 },
  readbg221: { name: '深青 (221)', avg: '#2A3638', tile: false, grain: 0.1, freq: 0.7, vignette: 0.8 },
  readbg222: { name: '石墨 (222)', avg: '#2D3033', tile: false, grain: 0.1, freq: 0.7, vignette: 0.8 },
  readbg223: { name: '深蓝灰 (223)', avg: '#3A3F48', tile: false, grain: 0.1, freq: 0.7, vignette: 0.9 },
  page0: { name: '页 0', avg: '#F0EBDD', tile: false, grain: 0.08, freq: 0.8, vignette: 0.45, fiber: 0.03 },
  page205: { name: '页 205', avg: '#E8DDC6', tile: false, grain: 0.09, freq: 0.75, vignette: 0.5 },
  page222: { name: '页 222', avg: '#D7D2C5', tile: false, grain: 0.1, freq: 0.75, vignette: 0.5 },
  page3: { name: '页 3', avg: '#EDE7D3', tile: false, grain: 0.08, freq: 0.8, vignette: 0.4 },
  page301: { name: '深蓝 (301)', avg: '#065C87', tile: true, grain: 0.12, freq: 0.8 },
  page302: { name: '墨绿 (302)', avg: '#1F4742', tile: true, grain: 0.12, freq: 0.8 },
  page303: { name: '藏青 (303)', avg: '#2C4559', tile: true, grain: 0.12, freq: 0.8 },
  page305: { name: '银白 (305)', avg: '#EDEDED', tile: true, grain: 0.05, freq: 0.9 },
  page306: { name: '淡粉 (306)', avg: '#FFE1E1', tile: true, grain: 0.06, freq: 0.9 },
  pagefb: { name: '素纸 (fb)', avg: '#F2EEE3', tile: true, grain: 0.07, freq: 0.9 },
};

export const TEXTURES: Texture[] = Object.entries(SPECS).map(([id, s]) => build(id, s));

const byId = new Map(TEXTURES.map((t) => [t.id, t]));

export function textureById(id: string): Texture | undefined {
  return byId.get(id.startsWith('tex:') ? id : `tex:${id}`);
}

/** THEME-006：位图宽高都 <100 → 平铺，否则拉伸铺满（不保持比例） */
export function userImageBackground(url: string, width: number, height: number): string {
  return width < 100 && height < 100 ? `url("${url}") 0 0/auto repeat` : `url("${url}") center/100% 100% no-repeat`;
}

const userUrls = new Map<string, string>();

async function loadUserImage(key: string): Promise<{ url: string; w: number; h: number } | null> {
  const v = await getKV<unknown>(key);
  let url: string | undefined;
  if (typeof v === 'string') url = v;
  else if (v instanceof Blob) url = userUrls.get(key) ?? URL.createObjectURL(v);
  else if (v && typeof v === 'object' && (v as { blob?: unknown }).blob instanceof Blob) url = userUrls.get(key) ?? URL.createObjectURL((v as { blob: Blob }).blob);
  if (!url) return null;
  userUrls.set(key, url);
  const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url!;
  });
  return dims ? { url, ...dims } : null;
}

/**
 * 解析当前主题背景：返回可赋给 style.background 的值。
 * 图缺失（找不到纹理/用户图读不到）→ 退回纯色 backgroundColor。
 */
export async function resolveBackground(opts: { useImage: boolean; image: string; color: string }): Promise<string> {
  if (!opts.useImage || !opts.image) return opts.color;
  if (opts.image.startsWith('img:')) {
    const u = await loadUserImage(opts.image.slice(4)).catch(() => null);
    return u ? `${userImageBackground(u.url, u.w, u.h)}, ${opts.color}` : opts.color;
  }
  const t = textureById(opts.image);
  return t ? t.css : opts.color;
}
