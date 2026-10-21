import { describe, expect, it } from 'vitest';
import type { AnnotationRecord } from '@/core/library';
import { annotationIdOfDecoration, findSamePosition, matchFilter, matchKeyword, quoteAround, relocate, sortAnnotations, toDecorations, usedColors } from './model';
import { generateBookmarkName } from './bookmark-name';

const TEXT = '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。春眠不觉晓，处处蚊子咬。';

function rec(p: Partial<AnnotationRecord> & Pick<AnnotationRecord, 'id'>): AnnotationRecord {
  return {
    bookId: 'b',
    kind: 'highlight',
    range: { section: 0, start: 0, end: 4 },
    text: '春眠不觉',
    color: '#00aaff77',
    style: 'highlight',
    createdAt: 1,
    updatedAt: 1,
    ...p,
  };
}

describe('quoteAround / relocate', () => {
  it('截取前后文', () => {
    expect(quoteAround(TEXT, 12, 16, 4)).toEqual({ prefix: TEXT.slice(8, 12), suffix: TEXT.slice(16, 20) });
    expect(quoteAround('abc', 1, 2, 32)).toEqual({ prefix: 'a', suffix: 'c' });
  });

  it('偏移仍然有效时原样返回', () => {
    const a = rec({ id: '1', range: { section: 0, start: 12, end: 16 }, text: '夜来风雨' });
    expect(relocate(TEXT, a)).toEqual({ start: 12, end: 16, moved: false });
  });

  it('文本前面多了内容：按原文找到新位置', () => {
    const shifted = '序言。' + TEXT;
    const a = rec({ id: '1', range: { section: 0, start: 12, end: 16 }, text: '夜来风雨' });
    expect(relocate(shifted, a)).toEqual({ start: 15, end: 19, moved: true });
  });

  it('原文有多处出现时，用前后文挑对的那一处', () => {
    // 「春眠不觉」出现两次：第二处前面是「花落知多少。」
    const second = TEXT.indexOf('春眠不觉', 4);
    const q = quoteAround(TEXT, second, second + 4);
    const shifted = '前言前言前言。' + TEXT;
    const a = rec({ id: '2', range: { section: 0, start: second, end: second + 4 }, text: '春眠不觉', ...q });
    const r = relocate(shifted, a)!;
    expect(r.start).toBe(second + 7);
    expect(shifted.slice(r.start, r.end)).toBe('春眠不觉');
  });

  it('同分时取离原偏移最近的一处', () => {
    const t = 'abc abc abc';
    const a = rec({ id: '3', range: { section: 0, start: 8, end: 11 }, text: 'abc' });
    // 原偏移 8 处恰好就是 abc，原样返回
    expect(relocate(t, a)).toEqual({ start: 8, end: 11, moved: false });
    const a2 = rec({ id: '3', range: { section: 0, start: 5, end: 8 }, text: 'abc' });
    expect(relocate('x' + t, a2)).toEqual({ start: 5, end: 8, moved: false });
  });

  it('原文被改写但前后文还在：夹出区间', () => {
    const before = '他走进了房间，看见桌上放着一本旧书，于是坐下。';
    const s = before.indexOf('桌上');
    const e = s + 8;
    const q = quoteAround(before, s, e, 12);
    const a = rec({ id: '4', range: { section: 0, start: s, end: e }, text: before.slice(s, e), ...q });
    const edited = before.replace('桌上放着一本旧书', '桌上摆着一本旧书');
    const r = relocate(edited, a)!;
    expect(r).not.toBeNull();
    expect(edited.slice(r.start, r.end)).toBe('桌上摆着一本旧书');
  });

  it('长度不变、字形不同（简繁）保持原偏移；完全找不到返回 null', () => {
    const a = rec({ id: '5', range: { section: 0, start: 0, end: 4 }, text: '春眠不觉' });
    expect(relocate('春眠不覺曉，', a)).toEqual({ start: 0, end: 4, moved: false });
    expect(relocate('完全不同的一段话而已', rec({ id: '6', text: '春眠不觉' }))).toBeNull();
  });

  it('书签（空原文）只钳位', () => {
    const a = rec({ id: '7', kind: 'bookmark', text: '', range: { section: 0, start: 5, end: 5 } });
    expect(relocate('abc', a)).toBeNull();
    expect(relocate('abcdefgh', a)).toEqual({ start: 5, end: 5, moved: false });
  });
});

describe('toDecorations', () => {
  it('高亮转装饰；笔记另加 note-mark；书签与已删除的不画', () => {
    const list = [
      rec({ id: 'a', note: '批注' }),
      rec({ id: 'b', style: 'underline', color: '#555555', range: { section: 1, start: 5, end: 9 } }),
      rec({ id: 'c', kind: 'bookmark', range: { section: 0, start: 3, end: 3 } }),
      rec({ id: 'd', deletedAt: 5 }),
    ];
    const d = toDecorations(list);
    expect(d.map((x) => x.id)).toEqual(['a', 'a:note', 'b']);
    expect(d[1]).toMatchObject({ style: 'note-mark', range: { section: 0, start: 0, end: 1 } });
    expect(d[2]).toMatchObject({ style: 'underline', color: '#555555', range: { section: 1, start: 5, end: 9 } });
    expect(annotationIdOfDecoration('a:note')).toBe('a');
    expect(annotationIdOfDecoration('a')).toBe('a');
  });

  it('重定位覆盖', () => {
    const d = toDecorations([rec({ id: 'a' })], new Map([['a', { start: 10, end: 14 }]]));
    expect(d[0].range).toMatchObject({ start: 10, end: 14 });
  });
});

describe('筛选与排序', () => {
  const list = [
    rec({ id: '1', kind: 'bookmark', title: '(1.0%) 开头', text: '', range: { section: 0, start: 2, end: 2 }, createdAt: 30 }),
    rec({ id: '2', note: '这里写错了', text: 'Hello World', range: { section: 1, start: 5, end: 16 }, createdAt: 10 }),
    rec({ id: '3', text: '另一段', range: { section: 0, start: 50, end: 53 }, createdAt: 20, color: '#ff9200' }),
  ];
  it('筛选 0/1/2/3', () => {
    expect(list.filter((a) => matchFilter(a, 0))).toHaveLength(3);
    expect(list.filter((a) => matchFilter(a, 1)).map((a) => a.id)).toEqual(['1']);
    expect(list.filter((a) => matchFilter(a, 2)).map((a) => a.id)).toEqual(['2']);
    expect(list.filter((a) => matchFilter(a, 3)).map((a) => a.id)).toEqual(['3']);
  });
  it('关键字不分大小写，匹配书签名或 笔记+原文', () => {
    expect(list.filter((a) => matchKeyword(a, 'hello')).map((a) => a.id)).toEqual(['2']);
    expect(list.filter((a) => matchKeyword(a, '写错')).map((a) => a.id)).toEqual(['2']);
    expect(list.filter((a) => matchKeyword(a, '开头')).map((a) => a.id)).toEqual(['1']);
  });
  it('按位置 / 按时间 / 倒序', () => {
    expect(sortAnnotations(list, false, false).map((a) => a.id)).toEqual(['1', '3', '2']);
    expect(sortAnnotations(list, true, false).map((a) => a.id)).toEqual(['1', '3', '2']);
    expect(sortAnnotations(list, false, true).map((a) => a.id)).toEqual(['2', '3', '1']);
  });
  it('同位置去重、已用颜色', () => {
    expect(findSamePosition(list, { kind: 'bookmark', range: { section: 0, start: 2, end: 2 } })?.id).toBe('1');
    expect(findSamePosition(list, { kind: 'highlight', range: { section: 1, start: 5, end: 16 } })?.id).toBe('2');
    expect(findSamePosition(list, { kind: 'highlight', range: { section: 1, start: 5, end: 17 } })).toBeUndefined();
    expect(usedColors(list)).toEqual(['#00aaff77', '#ff9200']);
  });
});

describe('书签名', () => {
  it('(进度%) 页首文本...，换行与全角空格变空格', () => {
    const name = generateBookmarkName({ sectionText: 'ab\ncd　ef', offset: 0, progress: 0.1234, chinese: true, fallback: 'T' });
    expect(name).toBe('(12.3%) ab cd ef...');
  });
  it('中文 60 / 其他 100 字符；在最后空格处截断避免半词', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const en = generateBookmarkName({ sectionText: words, offset: 0, progress: 0.5, chinese: false, fallback: '' });
    const body = en.replace(/^\(50\.0%\) /, '').replace(/\.\.\.$/, '');
    expect(body.length).toBeLessThanOrEqual(100);
    expect(words.startsWith(body)).toBe(true);
    expect(/word\d+$/.test(body)).toBe(true);
    const zh = generateBookmarkName({ sectionText: '字'.repeat(200), offset: 0, progress: 0, chinese: true, fallback: '' });
    expect(zh).toBe(`(0.0%) ${'字'.repeat(60)}...`);
  });
  it('偏移之后的文本太短时用日期时间', () => {
    expect(generateBookmarkName({ sectionText: 'ab', offset: 0, progress: 0, chinese: false, fallback: '2026-10-21 10:00' })).toBe('(0.0%) 2026-10-21 10:00...');
  });
});
