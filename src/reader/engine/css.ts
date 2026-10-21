// 排版 CSS 生成：把 reader.text / reader.css 设置翻译成注入章节 iframe 的样式表。
// 分两层：base 放在书内 CSS 之前（用户设置作为默认值，书内样式可以覆盖，对应 TYPO-015「默认让书的 CSS 起作用」），
// override 放在书内 CSS 之后（页边距、背景、图片尺寸上限等引擎必须掌控的东西，用 !important）。
// 8 个「禁用书内 CSS」分项不在这里做，而是在 book-css.ts 里直接从书内样式里剔除对应属性，这样标签自带的粗体/斜体不受影响。
import type { cssSettings, textSettings } from '../settings';

export type TextSettings = ReturnType<typeof textSettings.get>;
export type CssSettings = ReturnType<typeof cssSettings.get>;

export interface RenderConfig {
  text: TextSettings;
  css: CssSettings;
  night: boolean;
  /** 双页模式：字号叠加 dualFontSizeAdd */
  dual: boolean;
  /** 单页文字区尺寸（CSS px，已扣页边距） */
  width: number;
  height: number;
  /** 解析后的 font-family 值（含用户字体 @font-face 对应的族名） */
  fontFamily: string;
  /** 书籍语言（断字、CJK 判断用） */
  lang: string;
  /** 字体自然行高 / 字号（测量得到；未测量时用 1.3） */
  lhRatio: number;
}

export const GENERIC_FONTS: Record<string, string> = {
  serif: 'serif, "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun"',
  'sans-serif': 'sans-serif, "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei"',
  monospace: 'monospace, "Noto Sans Mono CJK SC", "SimSun"',
};

/** 字体名 → font-family 值。font:/server: 前缀由调用方先解析成族名再传进来 */
export function fontStack(name: string, resolvedFamily?: string): string {
  if (resolvedFamily) return `"${resolvedFamily}", ${GENERIC_FONTS.serif}`;
  if (!name) return GENERIC_FONTS.serif;
  if (GENERIC_FONTS[name]) return GENERIC_FONTS[name];
  return `"${name.replace(/"/g, '')}", ${GENERIC_FONTS.serif}`;
}

/** R+G+B > 355 视为白字（THEME-007 isWhiteFont） */
export function isWhiteFont(color: string): boolean {
  const c = parseColor(color);
  return !!c && c[0] + c[1] + c[2] > 355;
}

export function parseColor(color: string): [number, number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  if (h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), n(6) / 255];
}

/** TYPO-001 字体阴影：深色字灰影；白字黑影；纯黑底白字用灰影 */
export function textShadow(t: TextSettings): string {
  if (!t.fontShadow) return 'none';
  if (isWhiteFont(t.fontColor)) {
    const pureBlack = !t.useBackgroundImage && t.backgroundColor.toLowerCase() === '#000000';
    return pureBlack ? '1px 1px 1px #888888' : '1px 1px 1px #000000';
  }
  return '1px 1px 1px rgba(136,136,136,0.67)';
}

export function effectiveFontSize(c: Pick<RenderConfig, 'text' | 'dual'>): number {
  return Math.max(6, c.text.fontSize + (c.dual ? c.text.dualFontSizeAdd : 0));
}

/** 行高倍数（相对字号）：自然行高 × (1 + lineSpace/10) */
export function lineHeightRatio(c: Pick<RenderConfig, 'text' | 'lhRatio'>): number {
  return Math.max(0.5, c.lhRatio * (1 + c.text.lineSpace / 10));
}

/** 段间距 px（TYPO-004）：行高 × paragraphSpace/10 − fontSize/7；=10 不缩短；=0 只剩 8% 行高 */
export function paragraphGap(c: Pick<RenderConfig, 'text' | 'dual' | 'lhRatio'>): number {
  const fs = effectiveFontSize(c);
  const lh = fs * lineHeightRatio(c);
  const p = c.text.paragraphSpace;
  if (p >= 10) return lh * (p / 10);
  if (p <= 0) return lh * 0.08;
  return Math.max(0, lh * (p / 10) - fs / 7);
}

const esc = (s: string) => s.replace(/[<>]/g, '');

export function buildBaseCss(c: RenderConfig): string {
  const t = c.text;
  const fs = effectiveFontSize(c);
  const lh = lineHeightRatio(c);
  const justify = t.textJustified || t.textHyphenation;
  const cjk = t.textCJK && !t.textHyphenation;
  const indent = t.indentParagraph ? t.indentLength : 0;
  const decoration = t.fontUnderline ? `underline ${t.dashUnderline ? 'dashed' : 'solid'}` : 'none';
  const linkColor = c.night ? c.css.linkColorNight : c.css.linkColor;
  const visited = c.night ? c.css.linkVisitedColorNight : c.css.linkVisitedColor;
  const important = c.css.disableLinkColor ? ' !important' : '';
  const out: string[] = [];
  out.push(`
html{font-size:${fs}px;-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{
  color:${t.fontColor};
  font-family:${c.fontFamily};
  font-size:${fs}px;
  line-height:${lh.toFixed(4)};
  font-weight:${t.fontBold ? 'bold' : 'normal'};
  font-style:${t.fontItalic ? 'italic' : 'normal'};
  text-decoration:${decoration};
  text-shadow:${textShadow(t)};
  letter-spacing:${(t.fontSpace / 20).toFixed(3)}em;
  text-align:${justify ? 'justify' : 'start'};
  text-justify:${cjk || /^(zh|ja|ko)/i.test(c.lang) ? 'inter-character' : 'inter-word'};
  overflow-wrap:break-word;
  ${cjk ? 'line-break:strict;word-break:normal;text-spacing-trim:space-first;' : 'line-break:auto;'}
  ${t.textDense ? 'line-break:loose;text-spacing-trim:normal;' : ''}
  ${t.textHyphenation ? '-webkit-hyphens:auto;hyphens:auto;' : '-webkit-hyphens:manual;hyphens:manual;'}
  font-synthesis:weight style;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
p{margin-top:0;margin-bottom:${paragraphGap(c).toFixed(2)}px;${indent ? `text-indent:${indent}em;` : ''}}
h1,h2,h3,h4,h5,h6{text-indent:0}
:where(a){color:${linkColor}${important};text-decoration:none}
:where(a.mr-visited){color:${visited}${important}}
::selection{background:rgba(66,133,244,.38)}
`);
  return out.join('');
}

export function buildOverrideCss(c: RenderConfig): string {
  const t = c.text;
  const H = Math.max(40, Math.floor(c.height));
  const fs = effectiveFontSize(c);
  const scale = 1 + t.fontScale / 10;
  const parts: string[] = [];
  parts.push(`
html,body{margin:0!important;padding:0!important;background:transparent!important;font-size:${fs}px!important;
  -webkit-tap-highlight-color:transparent;user-select:text;-webkit-user-select:text;touch-action:none}
html{width:${c.width}px;overflow:hidden!important}
body{width:auto!important;max-width:none!important;min-width:0!important;height:auto!important;min-height:0!important;position:static!important;
  ${scale !== 1 ? `width:${(c.width / scale).toFixed(2)}px!important;transform:scaleX(${scale.toFixed(3)});transform-origin:0 0;` : ''}}
img,svg,video,canvas,image{max-width:100%!important;max-height:${H}px!important}
img,video,canvas{height:auto;object-fit:contain}
pre{white-space:pre-wrap;word-wrap:break-word}
table{max-width:100%}
${c.css.imageWhiteTransparent ? 'img{mix-blend-mode:multiply}' : ''}
${c.css.fitImageToScreen ? 'img{width:100%!important;height:auto!important}' : ''}
.mr-hide{display:none!important}
body.mr-imgonly{display:flex!important;flex-direction:column;align-items:center;justify-content:center;min-height:${H}px!important}
.mr-note::before{content:attr(data-mr-note);display:block;font-size:.8em;line-height:1.4;text-indent:0;text-align:start;background:rgba(126,126,126,.12);margin:.5em 0;padding:.5em;border:1px dotted #888;border-radius:10px;white-space:pre-wrap}
.mr-end::before{content:attr(data-mr-end);display:block;text-align:center;text-indent:0;opacity:.55;font-size:.85em;margin:1.5em 0 .5em}
`);
  return parts.join('');
}

/** 注入 iframe 的完整 head：base → 书内样式 → override */
export function buildDocumentHtml(opts: {
  lang?: string;
  dir?: string;
  bodyAttrs?: Record<string, string>;
  bodyHtml: string;
  bookStyles: string[];
  baseCss: string;
  overrideCss: string;
  fontFaceCss: string;
}): string {
  const attrs = Object.entries(opts.bodyAttrs ?? {})
    .filter(([k]) => /^[a-zA-Z_:][-\w:.]*$/.test(k) && !/^on/i.test(k) && k.toLowerCase() !== 'style')
    .map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`)
    .join('');
  const lang = opts.lang ? ` lang="${esc(opts.lang)}"` : '';
  const dir = opts.dir ? ` dir="${opts.dir}"` : '';
  return (
    `<!doctype html><html${lang}${dir}><head><meta charset="utf-8">` +
    `<style id="mr-fonts">${opts.fontFaceCss}</style>` +
    `<style id="mr-base">${opts.baseCss}</style>` +
    opts.bookStyles.map((s) => `<style class="mr-book">${s.replace(/<\/style/gi, '<\\/style')}</style>`).join('') +
    `<style id="mr-override">${opts.overrideCss}</style>` +
    `</head><body${attrs}>${opts.bodyHtml}</body></html>`
  );
}
