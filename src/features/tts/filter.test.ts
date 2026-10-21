import { describe, expect, it } from 'vitest';
import { applyFilter, DEFAULT_FILTERS, filtersToJson, parseFilters, toSpeakText } from './filter';

describe('朗读过滤', () => {
  it('出厂规则：破折号、连字符、单引号两侧变空格', () => {
    expect(toSpeakText('well-known — fact', DEFAULT_FILTERS, false)).toBe('well known   fact');
    expect(toSpeakText("it 's a 'test' here", DEFAULT_FILTERS, false)).toBe('it s a test here');
  });
  it('字面替换与正则替换；坏正则忽略该条', () => {
    expect(applyFilter('a.b.c', { from: '.', to: '' }, false)).toBe('abc');
    expect(applyFilter('a1b22c', { from: '\\d+', to: '#' }, true)).toBe('a#b#c');
    expect(applyFilter('abc', { from: '(', to: 'x' }, true)).toBe('abc');
    expect(applyFilter('abc', { from: '', to: 'x' }, false)).toBe('abc');
  });
  it('硬编码：「」→引号，’‘→空格，换行→空格，去首尾引号括号空格', () => {
    expect(toSpeakText('「你好」', [], false)).toBe('你好');
    expect(toSpeakText('他说“你好\n再见”', [], false)).toBe('他说“你好 再见');
    expect(toSpeakText('(括号内容)', [], false)).toBe('括号内容');
  });
  it('没有任何文字/数字的行返回空串', () => {
    expect(toSpeakText('……', [], false)).toBe('');
    expect(toSpeakText(' — ', DEFAULT_FILTERS, false)).toBe('');
    expect(toSpeakText('3.14', [], false)).toBe('3.14');
  });
  it('规则表导出/导入：JSON 往返；兼容原 app 的 原文#->#替换', () => {
    const list = [{ from: 'A', to: 'B' }, { from: '\\n+', to: ' ' }];
    expect(parseFilters(filtersToJson(list))).toEqual(list);
    expect(parseFilters('—#-># \n-#->#,\nbroken line')).toEqual([{ from: '—', to: ' ' }, { from: '-', to: ',' }]);
    expect(parseFilters('')).toEqual([]);
    expect(parseFilters('什么都不是')).toBeNull();
  });
});
