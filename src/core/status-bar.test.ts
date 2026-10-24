import { describe, expect, it } from 'vitest';
import { compositeLayers, isLightColor, parseCssColor, toHex } from './status-bar';

describe('状态栏取色', () => {
  it('解析 getComputedStyle 的几种颜色写法', () => {
    expect(parseCssColor('rgb(30, 136, 229)')).toEqual([30, 136, 229, 1]);
    expect(parseCssColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5]);
    expect(parseCssColor('rgb(30 136 229 / 0.25)')).toEqual([30, 136, 229, 0.25]);
    expect(parseCssColor('color(srgb 1 0.5 0 / 0.5)')).toEqual([255, 127.5, 0, 0.5]);
    expect(parseCssColor('transparent')).toBeNull();
    expect(parseCssColor('color(display-p3 1 0 0)')).toBeNull();
  });

  it('半透明层自上而下叠加，最底下垫白', () => {
    expect(toHex(compositeLayers([]))).toBe('#ffffff');
    expect(toHex(compositeLayers([[30, 136, 229, 1]]))).toBe('#1e88e5');
    // 对话框遮罩（黑 40%）盖在蓝色标题栏上
    expect(toHex(compositeLayers([[0, 0, 0, 0.4], [30, 136, 229, 1]]))).toBe('#125289');
    expect(toHex(compositeLayers([[0, 0, 0, 0.5]]))).toBe('#808080');
  });

  it('浅色底配深色图标', () => {
    expect(isLightColor([250, 250, 250])).toBe(true);
    expect(isLightColor([30, 136, 229])).toBe(false);
    expect(isLightColor([18, 18, 18])).toBe(false);
  });
});
