import { describe, expect, it } from 'vitest';
import { textSettings, cssSettings } from '../settings';
import { buildBaseCss, buildDocumentHtml, buildOverrideCss, effectiveFontSize, fontStack, isWhiteFont, lineHeightRatio, paragraphGap, parseColor, textShadow, type RenderConfig } from './css';

const cfg = (over: Partial<ReturnType<typeof textSettings.get>> = {}, css: Partial<ReturnType<typeof cssSettings.get>> = {}, extra: Partial<RenderConfig> = {}): RenderConfig => ({
  text: { ...textSettings.get(), fontSize: 20, lineSpace: 3, paragraphSpace: 7, fontSpace: 0, fontScale: 0, textJustified: false, textCJK: false, indentParagraph: false, textHyphenation: false, ...over },
  css: { ...cssSettings.get(), ...css },
  night: false,
  dual: false,
  width: 360,
  height: 640,
  fontFamily: 'serif',
  lang: 'en',
  lhRatio: 1.2,
  ...extra,
});

describe('排版换算', () => {
  it('行高 = 自然行高比 × (1 + lineSpace/10)', () => {
    expect(lineHeightRatio(cfg())).toBeCloseTo(1.2 * 1.3, 6);
    expect(lineHeightRatio(cfg({ lineSpace: -5 }))).toBeCloseTo(0.6, 6);
    expect(lineHeightRatio(cfg({ lineSpace: 20 }))).toBeCloseTo(3.6, 6);
  });
  it('双页字号 += dualFontSizeAdd，下限 6', () => {
    expect(effectiveFontSize({ text: cfg({ dualFontSizeAdd: 3 }).text, dual: true })).toBe(23);
    expect(effectiveFontSize({ text: cfg({ dualFontSizeAdd: 3 }).text, dual: false })).toBe(20);
    expect(effectiveFontSize({ text: cfg({ fontSize: 2 }).text, dual: false })).toBe(6);
  });
  it('段间距 = 行高×p/10 − fontSize/7；=10 不缩；=0 只剩 8% 行高（TYPO-004）', () => {
    const lh = 20 * 1.2 * 1.3;
    expect(paragraphGap(cfg({ paragraphSpace: 7 }))).toBeCloseTo(lh * 0.7 - 20 / 7, 6);
    expect(paragraphGap(cfg({ paragraphSpace: 10 }))).toBeCloseTo(lh, 6);
    expect(paragraphGap(cfg({ paragraphSpace: 0 }))).toBeCloseTo(lh * 0.08, 6);
    expect(paragraphGap(cfg({ paragraphSpace: 20 }))).toBeCloseTo(lh * 2, 6);
  });
  it('字体阴影规则：深字灰影；白字黑影；纯黑底白字灰影；关闭 none（TYPO-001）', () => {
    expect(textShadow(cfg({ fontShadow: false }).text)).toBe('none');
    expect(textShadow(cfg({ fontShadow: true, fontColor: '#111111' }).text)).toContain('136,136,136');
    expect(textShadow(cfg({ fontShadow: true, fontColor: '#eeeeee', backgroundColor: '#222222' }).text)).toBe('1px 1px 1px #000000');
    expect(textShadow(cfg({ fontShadow: true, fontColor: '#eeeeee', backgroundColor: '#000000', useBackgroundImage: false }).text)).toBe('1px 1px 1px #888888');
  });
  it('isWhiteFont：R+G+B > 355', () => {
    expect(isWhiteFont('#FFFFFF')).toBe(true);
    expect(isWhiteFont('#ABABAB')).toBe(true); // 171*3 = 513
    expect(isWhiteFont('#777777')).toBe(true); // 119*3 = 357 > 355
    expect(isWhiteFont('#767676')).toBe(false); // 354
    expect(isWhiteFont('#000')).toBe(false);
  });
  it('parseColor：#RGB / #RRGGBB / #RRGGBBAA', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#336699')).toEqual([51, 102, 153, 1]);
    expect(parseColor('#33669980')![3]).toBeCloseTo(128 / 255, 5);
    expect(parseColor('red')).toBeNull();
  });
  it('fontStack：通用族、用户字体、系统字体族名', () => {
    expect(fontStack('serif')).toContain('Noto Serif CJK');
    expect(fontStack('', 'mrf-1')).toMatch(/^"mrf-1"/);
    expect(fontStack('Arial')).toMatch(/^"Arial"/);
    expect(fontStack('A"rial')).not.toContain('A"r');
  });
});

describe('样式表生成', () => {
  it('基础样式：颜色、字号、字距、对齐、断字、首行缩进', () => {
    const css = buildBaseCss(cfg({ fontColor: '#123456', fontSpace: 4, textJustified: true, indentParagraph: true, indentLength: 3, fontBold: true }));
    expect(css).toContain('color:#123456');
    expect(css).toContain('font-size:20px');
    expect(css).toContain('letter-spacing:0.200em');
    expect(css).toContain('text-align:justify');
    expect(css).toContain('text-indent:3em');
    expect(css).toContain('font-weight:bold');
    expect(buildBaseCss(cfg({ textHyphenation: true }))).toContain('hyphens:auto');
    expect(buildBaseCss(cfg({ textHyphenation: false }))).toContain('hyphens:manual');
    // 断字自动同时两端对齐
    expect(buildBaseCss(cfg({ textHyphenation: true, textJustified: false }))).toContain('text-align:justify');
  });
  it('东亚排版：按字折行、避头尾；紧凑模式放宽', () => {
    const c = buildBaseCss(cfg({ textCJK: true }));
    expect(c).toContain('line-break:strict');
    expect(c).toContain('text-justify:inter-character');
    expect(buildBaseCss(cfg({ textCJK: true, textDense: true }))).toContain('line-break:loose');
  });
  it('链接色：夜间用夜间色；disableLinkColor 加 !important（用 :where 让书内样式可覆盖）', () => {
    const day = buildBaseCss(cfg({}, { linkColor: '#112233', linkColorNight: '#445566' }));
    expect(day).toContain(':where(a){color:#112233');
    const night = buildBaseCss(cfg({}, { linkColor: '#112233', linkColorNight: '#445566' }, { night: true }));
    expect(night).toContain('#445566');
    expect(buildBaseCss(cfg({}, { disableLinkColor: true }))).toContain('!important');
  });
  it('覆盖样式：页边距清零、图片不超出页、fontScale 横向伸缩', () => {
    const o = buildOverrideCss(cfg());
    expect(o).toContain('margin:0!important');
    expect(o).toContain('max-height:640px');
    expect(o).not.toContain('scaleX');
    const s = buildOverrideCss(cfg({ fontScale: 5 }));
    expect(s).toContain('scaleX(1.500)');
    expect(s).toContain(`width:${(360 / 1.5).toFixed(2)}px`);
    expect(buildOverrideCss(cfg({}, { fitImageToScreen: true }))).toContain('width:100%!important');
    expect(buildOverrideCss(cfg({}, { imageWhiteTransparent: true }))).toContain('multiply');
  });
  it('文档拼装顺序：字体 → 基础 → 书内 → 覆盖；过滤危险的 body 属性；转义 </style>', () => {
    const html = buildDocumentHtml({
      lang: 'zh-CN',
      dir: 'rtl',
      bodyAttrs: { class: 'a b', onload: 'alert(1)', style: 'x', 'data-x': 'y"z' },
      bodyHtml: '<p>hi</p>',
      bookStyles: ['p{color:red}</style><script>x</script>'],
      baseCss: 'BASE',
      overrideCss: 'OVR',
      fontFaceCss: 'FACE',
    });
    expect(html.indexOf('FACE')).toBeLessThan(html.indexOf('BASE'));
    expect(html.indexOf('BASE')).toBeLessThan(html.indexOf('p{color:red}'));
    expect(html.indexOf('p{color:red}')).toBeLessThan(html.indexOf('OVR'));
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('class="a b"');
    expect(html).not.toContain('onload');
    expect(html).toContain('data-x="y&quot;z"');
    expect(html).not.toMatch(/<\/style><script>/);
  });
});
