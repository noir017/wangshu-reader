import { describe, expect, it } from 'vitest';
import { cssSettings } from '../settings';
import { flagsFrom } from './book-css';

const css = (o: Partial<ReturnType<typeof cssSettings.get>>) => ({ ...cssSettings.get(), ...o });

describe('禁用书内 CSS 的分项开关（TYPO-015）', () => {
  it('总开关关着时 8 个分项都不生效（cssJustify 默认 true 也一样）', () => {
    const f = flagsFrom(css({ disableCSS: false, cssFontSize: true, cssJustify: true }));
    expect(f.fontSize).toBe(false);
    expect(f.justify).toBe(false);
    expect(f.align).toBe(false);
  });
  it('总开关开着：各分项独立生效', () => {
    const f = flagsFrom(css({ disableCSS: true, cssFontStyle: true, cssFontSize: false, cssFontColor: true, cssAlignment: false, cssJustify: false, cssIndent: true, cssLineSpace: false, cssOthers: true }));
    expect(f).toMatchObject({ fontStyle: true, fontSize: false, fontColor: true, align: false, justify: false, indent: true, lineSpace: false, others: true });
  });
  it('内嵌字体与链接颜色不受总开关限制', () => {
    const f = flagsFrom(css({ disableCSS: false, useCssFont: false, disableLinkColor: true }));
    expect(f.noEmbeddedFonts).toBe(true);
    expect(f.linkColor).toBe(true);
    expect(flagsFrom(css({ useCssFont: true })).noEmbeddedFonts).toBe(false);
  });
});
