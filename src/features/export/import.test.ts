import { describe, expect, it } from 'vitest';
import { bookmarkKey, bookmarkPercent, locateRecord, sizeMatches, type LocateContext } from './import';
import type { MrexptRecord } from './mrexpt';

const sections = [
  '第一章 开端\n这是第一章的内容。春眠不觉晓，处处闻啼鸟。',
  '第二章 发展\n夜来风雨声，花落知多少。第二章里也有一句春眠不觉晓。',
  '第三章 结尾\n全书终。',
];
const ctx: LocateContext = { count: sections.length, getText: async (i) => sections[i], charCounts: sections.map((s) => s.length) };

function rec(p: Partial<MrexptRecord>): MrexptRecord {
  return { id: 1, book: '', filename: '', lowerFilename: '', chapter: 0, split: 0, position: 0, length: 0, color: 0, time: 0, bookmark: '', note: '', original: '', underline: false, strikethrough: false, squiggly: false, deleted: false, ...p };
}

describe('导入定位', () => {
  it('章号+偏移对得上：直接用', async () => {
    const pos = sections[1].indexOf('夜来风雨声');
    expect(await locateRecord(rec({ chapter: 1, position: pos, original: '夜来风雨声' }), ctx)).toEqual({ section: 1, start: pos, end: pos + 5 });
  });

  it('偏移不对：在该章里找最近的出现', async () => {
    const first = sections[1].indexOf('春眠不觉晓');
    expect(await locateRecord(rec({ chapter: 1, position: first + 7, original: '春眠不觉晓' }), ctx)).toEqual({ section: 1, start: first, end: first + 5 });
  });

  it('原 app 的 TXT：章号 0、位置是全书偏移 → 按累计偏移换算到章', async () => {
    const global = sections[0].length + sections[1].indexOf('花落知多少');
    expect(await locateRecord(rec({ chapter: 0, position: global, original: '花落知多少' }), ctx)).toEqual({ section: 1, start: sections[1].indexOf('花落知多少'), end: sections[1].indexOf('花落知多少') + 5 });
  });

  it('章号越界：全书搜索；找不到返回 null', async () => {
    expect(await locateRecord(rec({ chapter: 99, position: 0, original: '全书终' }), ctx)).toEqual({ section: 2, start: sections[2].indexOf('全书终'), end: sections[2].indexOf('全书终') + 3 });
    expect(await locateRecord(rec({ chapter: 0, position: 0, original: '根本不存在的句子' }), ctx)).toBeNull();
  });

  it('书签：用书签名里的页首文字定位；找不到时按百分比估章', async () => {
    expect(bookmarkKey('(12.3%) 夜来风雨声，花落知多少。...')).toBe('夜来风雨声，花落知多少。');
    expect(bookmarkPercent('(50.0%) x...')).toBe(0.5);
    const pos = sections[1].indexOf('夜来风雨声');
    expect(await locateRecord(rec({ chapter: 1, position: 0, bookmark: '(40.0%) 夜来风雨声，花落知多少。...' }), ctx)).toEqual({ section: 1, start: pos, end: pos });
    const est = await locateRecord(rec({ chapter: 0, position: 0, bookmark: '(99.0%) 不存在的页首...' }), ctx);
    expect(est).toEqual({ section: 2, start: 0, end: 0 });
  });

  it('大小差 ≤ 100000 字节算同一本书', () => {
    expect(sizeMatches({ size: 1_000_000, indent: false, trim: false, records: [] }, 1_050_000)).toBe(true);
    expect(sizeMatches({ size: 1_000_000, indent: false, trim: false, records: [] }, 1_200_000)).toBe(false);
  });
});
