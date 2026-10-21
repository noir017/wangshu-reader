import { describe, expect, it } from 'vitest';
import { isAvailable, splitTtsLines, MAX_LINE_CHARS } from './split';

const texts = (t: string, m: 0 | 1 | 2 | 3) => splitTtsLines(t, m).map((l) => l.text);

describe('朗读分句', () => {
  it('句号级（默认）：按 。；？！ 和 ". " 切，句内逗号与句末标点留在文本里', () => {
    expect(texts('春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少？再来一句！', 1)).toEqual(['春眠不觉晓，处处闻啼鸟。', '夜来风雨声，花落知多少？', '再来一句！']);
  });

  it('逗号级：逗号、冒号、括号也切，且段边界上的标点全部修剪掉', () => {
    expect(texts('春眠不觉晓，处处闻啼鸟。夜来风雨声：花落知多少', 0)).toEqual(['春眠不觉晓', '处处闻啼鸟', '夜来风雨声', '花落知多少']);
  });

  it('整段：只按换行切；整页：不切', () => {
    expect(texts('第一段。还是第一段。\n第二段。\r\n第三段', 2)).toEqual(['第一段。还是第一段。', '第二段。', '第三段']);
    expect(texts('第一句。第二句。\n第三句。', 3)).toEqual(['第一句。第二句。\n第三句。']);
    expect(splitTtsLines('   ', 3)).toEqual([]);
  });

  it('区间对得上原文；逗号级修剪掉的句末标点仍计入 end（高亮用）', () => {
    const t = '你好。世界！再见';
    const lines = splitTtsLines(t, 1);
    expect(lines.map((l) => [l.start, l.end])).toEqual([[0, 3], [3, 6], [6, 8]]);
    for (const l of lines) expect(t.slice(l.start, l.start + l.text.length)).toBe(l.text);
    const c = splitTtsLines('你好，世界。再见', 0);
    expect(c.map((l) => l.text)).toEqual(['你好', '世界', '再见']);
    expect(c.map((l) => [l.start, l.end])).toEqual([[0, 3], [3, 6], [6, 8]]);
  });

  it('偏移基准 base：区间整体平移', () => {
    expect(splitTtsLines('甲乙。丙丁。', 1, 100).map((l) => [l.start, l.end])).toEqual([[100, 103], [103, 106]]);
  });

  it('Mr./Mrs./Dr. 的句点不算句末，且区间不错位', () => {
    const t = 'Mr. Smith met Dr. Jones. They talked.';
    const lines = splitTtsLines(t, 1);
    expect(lines.map((l) => l.text)).toEqual(['Mr. Smith met Dr. Jones.', 'They talked.']);
    expect(t.slice(lines[1].start, lines[1].end)).toBe('They talked.');
  });

  it('制表符、换行都是切分点；逗号级下段首的引号、括号被修剪', () => {
    expect(texts('“你好。”\n（再见）\t结束', 0)).toEqual(['你好', '再见', '结束']);
    expect(texts('“你好。”\n（再见）\t结束', 1)).toEqual(['“你好。', '（再见）', '结束']);
  });

  it('单字符行：标点/图片占位丢弃，普通字符保留', () => {
    expect(isAvailable({ text: '，', start: 0, end: 1 })).toBe(false);
    expect(isAvailable({ text: '￼', start: 0, end: 1 })).toBe(false);
    expect(isAvailable({ text: '好', start: 0, end: 1 })).toBe(true);
    expect(isAvailable({ text: 'ab', start: 3, end: 3 })).toBe(false);
    expect(texts('好。。。！！！啊', 1)).toEqual(['好。', '啊']);
  });

  it('没有分隔符时整段是一句；空文本没有句子', () => {
    expect(texts('没有句号的一段话', 1)).toEqual(['没有句号的一段话']);
    expect(texts('', 1)).toEqual([]);
  });

  it('超长句被截成 3950 字符一段，区间连续', () => {
    const t = '字'.repeat(MAX_LINE_CHARS * 2 + 10);
    const lines = splitTtsLines(t, 1);
    expect(lines.map((l) => l.text.length)).toEqual([MAX_LINE_CHARS, MAX_LINE_CHARS, 10]);
    expect(lines[1].start).toBe(MAX_LINE_CHARS);
  });
});
