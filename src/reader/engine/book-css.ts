// 书内 CSS 处理（TYPO-015 / FMT-009）：
// 1) 「禁用书内 CSS」的 8 个分项：直接从书内样式表（以及行内 style）里剔除对应属性。
//    不用 `* {x: inherit !important}` 的覆盖法，因为那会连 <b>/<i> 标签自带的粗斜体一起抹掉，而原 app 只关 CSS、标签语义保留。
// 2) 视口单位（vh/vw/vmin/vmax）折算成 px：章节 iframe 被撑成整章高度，vh 会随内容自我放大，必须用页面尺寸固定下来。
// 3) useCssFont=false：删掉 @font-face 与 font-family，让用户选的字体生效。
import type { CssSettings } from './css';

export interface StripFlags {
  fontStyle: boolean;
  fontSize: boolean;
  fontColor: boolean;
  align: boolean;
  justify: boolean;
  indent: boolean;
  lineSpace: boolean;
  others: boolean;
  noEmbeddedFonts: boolean;
  linkColor: boolean;
}

/** 8 个分项只有总开关 disableCSS 开着才生效（规格 TYPO-015） */
export function flagsFrom(c: CssSettings): StripFlags {
  const on = c.disableCSS;
  return {
    fontStyle: on && c.cssFontStyle,
    fontSize: on && c.cssFontSize,
    fontColor: on && c.cssFontColor,
    align: on && c.cssAlignment,
    justify: on && c.cssJustify,
    indent: on && c.cssIndent,
    lineSpace: on && c.cssLineSpace,
    others: on && c.cssOthers,
    noEmbeddedFonts: !c.useCssFont,
    linkColor: c.disableLinkColor,
  };
}

const FONT_STYLE = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'font-variant', 'font-variant-caps']);
const LINE_SPACE = new Set(['margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'margin-block-start', 'margin-block-end', 'padding-block-start', 'padding-block-end', 'line-height']);
const ALIGN_LRC = /^(left|right|center|start|end|-webkit-(left|right|center)|-moz-(left|right|center))$/i;

function shouldRemove(name: string, value: string, f: StripFlags, selector: string): boolean {
  if (f.fontStyle && FONT_STYLE.has(name)) return true;
  if (f.fontSize && name === 'font-size') return true;
  if (f.fontColor && (name === 'color' || name === 'background-color' || name === '-webkit-text-fill-color')) return true;
  if (f.align && name === 'text-align' && ALIGN_LRC.test(value.trim())) return true;
  if (f.justify && name === 'text-align' && /justify/i.test(value)) return true;
  if (f.indent && name === 'text-indent') return true;
  if (f.lineSpace && LINE_SPACE.has(name)) return true;
  if (f.others) {
    if (name.startsWith('border') || name.startsWith('outline')) return true;
    if (name === 'background-image' || name === 'box-shadow' || name === 'float' || name === 'clear') return true;
  }
  if (f.noEmbeddedFonts && name === 'font-family') return true;
  if (f.linkColor && name === 'color' && /(^|[\s>+~,])a\b|:link|:visited/i.test(selector)) return true;
  return false;
}

export interface Viewport {
  width: number;
  height: number;
}

const VP_UNIT = /(-?\d*\.?\d+)(dvh|svh|lvh|vh|dvw|svw|lvw|vw|vmin|vmax)\b/gi;

function convertViewportUnits(value: string, vp: Viewport): string {
  if (!VP_UNIT.test(value)) return value;
  VP_UNIT.lastIndex = 0;
  return value.replace(VP_UNIT, (_m, n: string, unit: string) => {
    const u = unit.toLowerCase();
    const base = u.endsWith('h') ? vp.height : u.endsWith('w') ? vp.width : u === 'vmin' ? Math.min(vp.width, vp.height) : Math.max(vp.width, vp.height);
    return `${((parseFloat(n) * base) / 100).toFixed(2)}px`;
  });
}

function processStyle(style: CSSStyleDeclaration, f: StripFlags, vp: Viewport, selector: string): void {
  for (let i = style.length - 1; i >= 0; i--) {
    const name = style[i];
    const value = style.getPropertyValue(name);
    if (shouldRemove(name, value, f, selector)) {
      style.removeProperty(name);
      continue;
    }
    const converted = convertViewportUnits(value, vp);
    if (converted !== value) style.setProperty(name, converted, style.getPropertyPriority(name));
  }
}

function processRules(rules: CSSRuleList, parent: { deleteRule(i: number): void }, f: StripFlags, vp: Viewport): void {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    // CSSRule.type：1 STYLE，5 FONT_FACE，4 MEDIA，12 SUPPORTS
    if (rule.type === 5) {
      if (f.noEmbeddedFonts) parent.deleteRule(i);
    } else if (rule.type === 1) {
      const sr = rule as CSSStyleRule;
      processStyle(sr.style, f, vp, sr.selectorText);
      // 嵌套规则（CSS nesting）
      const nested = (sr as unknown as { cssRules?: CSSRuleList }).cssRules;
      if (nested?.length) processRules(nested, sr as unknown as { deleteRule(i: number): void }, f, vp);
    } else if ((rule as CSSGroupingRule).cssRules) {
      processRules((rule as CSSGroupingRule).cssRules, rule as CSSGroupingRule, f, vp);
    }
  }
}

/** 处理章节文档里 class=mr-book 的样式表与行内 style。需在文档加载完成后调用一次 */
export function processBookStyles(doc: Document, f: StripFlags, vp: Viewport): void {
  const anyStrip = Object.values(f).some(Boolean);
  for (const sheet of Array.from(doc.styleSheets)) {
    const owner = sheet.ownerNode as HTMLElement | null;
    if (!owner?.classList?.contains('mr-book')) continue;
    try {
      processRules(sheet.cssRules, sheet, f, vp);
    } catch {
      /* 跨域/非法样式表：跳过 */
    }
  }
  const hasVp = (s: string) => /v(h|w|min|max)\b/i.test(s);
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[style]'))) {
    const raw = el.getAttribute('style') ?? '';
    if (!anyStrip && !hasVp(raw)) continue;
    processStyle(el.style, f, vp, el.tagName.toLowerCase());
  }
}
