import { describe, expect, it } from 'vitest';
import { alphaOf, argbIntToCss, cssToArgbInt, parseCssColor, rgbOf, sameColor, withAlpha } from './colors';

describe('colors', () => {
  it('原 app 默认高亮色 #7700AAFF（ARGB）↔ CSS #00aaff77', () => {
    const n = 0x7700aaff | 0;
    expect(argbIntToCss(n)).toBe('#00aaff77');
    expect(cssToArgbInt('#00aaff77')).toBe(n);
  });
  it('不透明色省略 alpha，负的有符号 int 也能还原', () => {
    expect(argbIntToCss(0xff555555 | 0)).toBe('#555555');
    expect(cssToArgbInt('#555555')).toBe(0xff555555 | 0);
    expect(cssToArgbInt('#555555')).toBeLessThan(0);
  });
  it('解析、透明度、比较', () => {
    expect(parseCssColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 255 });
    expect(parseCssColor('red')).toBeNull();
    expect(cssToArgbInt('red')).toBe(0);
    expect(alphaOf('#00000080')).toBeCloseTo(0.5, 1);
    expect(withAlpha('#336699', 0.5)).toBe('#33669980');
    expect(rgbOf('#33669980')).toBe('#336699');
    expect(sameColor('#FFAA00', '#ffaa00ff')).toBe(true);
    expect(sameColor('#ffaa00', '#ffaa01')).toBe(false);
  });
});
