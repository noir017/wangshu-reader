// 颜色换算：原 app 用有符号 int ARGB（0xAARRGGBB），web 用 CSS #rrggbb / #rrggbbaa。

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..255 */
  a: number;
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** 解析 #rgb / #rrggbb / #rrggbbaa；其他写法（rgb()、颜色名）返回 null */
export function parseCssColor(c: string): Rgba | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((x) => x + x).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255,
  };
}

export function toCss({ r, g, b, a }: Rgba): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a >= 255 ? '' : hex2(a)}`;
}

/** 有符号 ARGB int → CSS */
export function argbIntToCss(n: number): string {
  const u = n >>> 0;
  return toCss({ a: (u >>> 24) & 255, r: (u >>> 16) & 255, g: (u >>> 8) & 255, b: u & 255 });
}

/** CSS → 有符号 ARGB int；无法解析返回 0（原 app 里 0 = 无色） */
export function cssToArgbInt(css: string): number {
  const c = parseCssColor(css);
  if (!c) return 0;
  return ((c.a << 24) | (c.r << 16) | (c.g << 8) | c.b) | 0;
}

/** 取 CSS 颜色的不透明度 0..1（无法解析按 1） */
export function alphaOf(css: string): number {
  return (parseCssColor(css)?.a ?? 255) / 255;
}

export function withAlpha(css: string, alpha01: number): string {
  const c = parseCssColor(css);
  if (!c) return css;
  return toCss({ ...c, a: Math.round(Math.max(0, Math.min(1, alpha01)) * 255) });
}

/** 去掉 alpha，只留 #rrggbb（给 <input type=color> 用） */
export function rgbOf(css: string): string {
  const c = parseCssColor(css);
  return c ? toCss({ ...c, a: 255 }) : '#000000';
}

/** 颜色是否相同（忽略大小写、alpha 缺省视为 ff） */
export function sameColor(a: string, b: string): boolean {
  const x = parseCssColor(a);
  const y = parseCssColor(b);
  if (!x || !y) return a.toLowerCase() === b.toLowerCase();
  return x.r === y.r && x.g === y.g && x.b === y.b && x.a === y.a;
}
