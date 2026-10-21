import { describe, expect, it } from 'vitest';
import { buildRegExp, findMatches, makeSnippet, snippetRadius } from './engine';

const opts = { caseSensitive: false, wholeWord: false, regex: true };

describe('搜索：正则与命中', () => {
  it('默认不区分大小写、按正则', () => {
    expect(findMatches('Foo foo FOO', buildRegExp('foo', opts)).map((m) => m.start)).toEqual([0, 4, 8]);
    expect(findMatches('a1 b22 c333', buildRegExp('\\d+', opts)).map((m) => [m.start, m.end])).toEqual([[1, 2], [4, 6], [8, 11]]);
  });
  it('区分大小写；按字面（特殊字符不当正则）', () => {
    expect(findMatches('Foo foo', buildRegExp('foo', { ...opts, caseSensitive: true })).map((m) => m.start)).toEqual([4]);
    expect(findMatches('a.b axb', buildRegExp('a.b', { ...opts, regex: false })).map((m) => m.start)).toEqual([0]);
    expect(findMatches('a.b axb', buildRegExp('a.b', opts)).map((m) => m.start)).toEqual([0, 4]);
  });
  it('单词模式：不把 cat 匹配进 concatenate；CJK 相邻字不算词内', () => {
    const re = buildRegExp('cat', { ...opts, wholeWord: true });
    expect(findMatches('cat concatenate cat_ a cat.', re).map((m) => m.start)).toEqual([0, 23]);
    // 汉字也是「单词字符」：夹在汉字里的不算单词，被空格/标点隔开的算
    expect(findMatches('我们春眠不觉晓 春眠，', buildRegExp('春眠', { ...opts, wholeWord: true })).map((m) => m.start)).toEqual([8]);
  });
  it('语法错误抛 SyntaxError；零长度匹配不死循环', () => {
    expect(() => buildRegExp('(', opts)).toThrow(SyntaxError);
    expect(() => buildRegExp('', opts)).toThrow(SyntaxError);
    expect(findMatches('abc', buildRegExp('x*', opts))).toEqual([]);
    expect(findMatches('aXbX', buildRegExp('x', opts), 1)).toHaveLength(1);
  });
  it('非整词模式下 u 标志过严的写法回退可用', () => {
    expect(findMatches('a_b', buildRegExp('a\\_b', opts)).length).toBe(1);
  });
});

describe('搜索：摘要', () => {
  it('半径：亚洲手机 30 / 平板 60，其他手机 60 / 平板 100', () => {
    expect([snippetRadius(true, false), snippetRadius(true, true), snippetRadius(false, false), snippetRadius(false, true)]).toEqual([30, 60, 60, 100]);
  });
  it('起点收缩到命中前 ≥10 字符处的标点之后，终点取最后一个标点；两端加 ...', () => {
    const text = '前面的一句话已经结束了。这里是一段比较长的需要搜索的关键词所在的这一句话，后面还有很多很多内容可以继续往下写。';
    const s = text.indexOf('关键词');
    const r = makeSnippet(text, s, s + 3, 30);
    expect(r.hit).toBe('关键词');
    expect(r.pre).toBe('...这里是一段比较长的需要搜索的');
    expect(r.post).toBe('所在的这一句话，后面还有很多很多内容可以继续往下写。...');
  });
  it('标点离命中太近（<10 字符）时不用它，退回固定 15 字符', () => {
    const text = '前面的一句话已经结束了。这里是需要搜索的关键词所在。';
    const s = text.indexOf('关键词');
    const r = makeSnippet(text, s, s + 3, 30);
    expect(r.pre).toBe('...' + text.slice(s - 15, s));
  });
  it('没有标点时退到空格，再退到固定 15 字符', () => {
    const t = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh HIT iiii jjjj kkkk llll mmmm nnnn oooo';
    const i = t.indexOf('HIT');
    const r = makeSnippet(t, i, i + 3, 30);
    expect(r.hit).toBe('HIT');
    expect(r.pre.length).toBeLessThanOrEqual(3 + 30);
    expect(r.post.endsWith('...')).toBe(true);
    const flat = 'x'.repeat(100) + 'HIT' + 'y'.repeat(100);
    const f = makeSnippet(flat, 100, 103, 30);
    expect(f.pre).toBe('...' + 'x'.repeat(15));
    expect(f.post).toBe('y'.repeat(15) + '...');
  });
  it('文本开头/结尾的命中不越界；换行与制表符被去掉', () => {
    const r = makeSnippet('Hi\n　there\tfriend', 0, 2, 30);
    expect(r.pre).toBe('...');
    expect(r.post).toBe('therefriend...'); // 原版把 \n 和 \t 直接删掉
    expect(r.post.includes('\n')).toBe(false);
    expect(r.post.includes('\t')).toBe(false);
  });
});
