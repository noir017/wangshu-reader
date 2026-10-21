import { describe, expect, it } from 'vitest';
import { findAll, hlAllDecorations } from './highlight-all';

describe('高亮本书所有同词', () => {
  it('找出所有不重叠出现', () => {
    expect(findAll('aaaa', 'aa')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
    expect(findAll('abc', '')).toEqual([]);
    expect(findAll('春眠，春眠。', '春眠')).toEqual([{ start: 0, end: 2 }, { start: 3, end: 5 }]);
  });
  it('生成装饰，id 带词序号与位置', () => {
    const d = hlAllDecorations(2, 'foo bar foo', [{ text: 'foo', style: 'underline', color: '#f00' }]);
    expect(d.map((x) => x.id)).toEqual(['hlall:0:0', 'hlall:0:8']);
    expect(d[1]).toMatchObject({ style: 'underline', color: '#f00', range: { section: 2, start: 8, end: 11 } });
  });
});
