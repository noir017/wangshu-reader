import { describe, expect, it } from 'vitest';
import { classifyHref, openableHref, pickBackLocation } from './links';

describe('链接分类', () => {
  it('web / mailto / tel / 其他', () => {
    expect(classifyHref('https://a.b/c')).toBe('web');
    expect(classifyHref('HTTP://a.b')).toBe('web');
    expect(classifyHref('mailto:a@b.c')).toBe('mailto');
    expect(classifyHref('tel:123')).toBe('tel');
    expect(classifyHref('javascript:alert(1)')).toBe('other');
    expect(classifyHref('chapter2.xhtml#a')).toBe('other');
  });
  it('不放行 javascript:/data:', () => {
    expect(openableHref('javascript:alert(1)')).toBeNull();
    expect(openableHref(' data:text/html,x ')).toBeNull();
    expect(openableHref(' https://a.b ')).toBe('https://a.b');
  });
  it('压栈位置：relocate 刚发生过就取跳转前的位置', () => {
    expect(pickBackLocation('prev', 'cur', 1000, 1050)).toBe('prev');
    expect(pickBackLocation('prev', 'cur', 1000, 2000)).toBe('cur');
    expect(pickBackLocation(undefined, 'cur', 1000, 1010)).toBe('cur');
    expect(pickBackLocation('prev', undefined, 0, 5)).toBe('prev');
  });
});
