import { describe, expect, it } from 'vitest';
import { firstSentenceFrom, wordRangeAt } from './select-word';

describe('点选取词', () => {
  it('英文：点在词中选整词，点在标点上先左移', () => {
    const t = 'Hello, world! Nice day.';
    expect(wordRangeAt(t, 9)).toEqual({ start: 7, end: 12 });
    expect(wordRangeAt(t, 5)).toEqual({ start: 0, end: 5 });
  });
  it('单字模式：汉字只选一个字；英文照常选词', () => {
    expect(wordRangeAt('春眠不觉晓', 2, { oneChar: true })).toEqual({ start: 2, end: 3 });
    expect(wordRangeAt('春眠 abc def', 5, { oneChar: true })).toEqual({ start: 3, end: 6 });
  });
  it('非单字模式：选中点所在的词（分词结果可能因引擎而异，只断言包含点中字且不越界）', () => {
    const t = '我们今天去公园玩';
    const r = wordRangeAt(t, 3, { locale: 'zh' })!;
    expect(r.start).toBeLessThanOrEqual(3);
    expect(r.end).toBeGreaterThan(3);
    expect(r.end - r.start).toBeLessThanOrEqual(4);
  });
  it('代理对（增补汉字）不被截断', () => {
    const t = 'a𠮷b';
    expect(wordRangeAt(t, 2, { oneChar: true })).toEqual({ start: 1, end: 3 });
  });
  it('全是标点/空文本返回 null', () => {
    expect(wordRangeAt('', 0)).toBeNull();
    expect(wordRangeAt('，。！', 1)).toBeNull();
  });
  it('页首第一句', () => {
    expect(firstSentenceFrom('  　第一句。第二句。', 0)).toEqual({ start: 3, end: 7 });
    expect(firstSentenceFrom('   ', 0)).toBeNull();
    expect(firstSentenceFrom('x'.repeat(500), 0, 50)).toEqual({ start: 0, end: 50 });
  });
});
