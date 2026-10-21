import { describe, expect, it } from 'vitest';
import { historyToCsv, mergeHistory, type DictHistoryItem } from './history';

describe('词典历史', () => {
  it('同词合并并移到最前，计数累加，保留旧上下文', () => {
    let list: DictHistoryItem[] = [];
    list = mergeHistory(list, { word: 'a', at: 1, context: 'ctx a' });
    list = mergeHistory(list, { word: 'b', at: 2 });
    list = mergeHistory(list, { word: 'a', at: 3 });
    expect(list.map((h) => h.word)).toEqual(['a', 'b']);
    expect(list[0]).toMatchObject({ count: 2, at: 3, context: 'ctx a' });
  });
  it('上限', () => {
    let list: DictHistoryItem[] = [];
    for (let i = 0; i < 5; i++) list = mergeHistory(list, { word: 'w' + i, at: i }, 3);
    expect(list.map((h) => h.word)).toEqual(['w4', 'w3', 'w2']);
  });
  it('CSV 转义逗号、引号、换行', () => {
    const csv = historyToCsv([{ word: 'say "hi"', at: 0, count: 1, context: 'a,b\nc' }]);
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"a,b\nc"');
    expect(csv.startsWith('﻿word,count')).toBe(true);
  });
});
