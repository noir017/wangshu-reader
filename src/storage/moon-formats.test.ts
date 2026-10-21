import { describe, expect, it } from 'vitest';
import {
  annotationToMoonNote,
  argbToCss,
  compressAn,
  cssToArgb,
  decodeAnText,
  decodePo,
  decodeRecent,
  decompressAn,
  DELETED,
  encodeAnText,
  encodePo,
  encodeRecent,
  formatCategory,
  formatPositionString,
  formatStatDates,
  moonNoteToAnnotation,
  parseCategory,
  parsePositionString,
  parseStatDates,
} from './moon-formats';
import type { AnnotationRecord } from '@/core/library';

describe('位置串', () => {
  it('解析各种写法', () => {
    expect(parsePositionString('3@0#12345:45.67%')).toEqual({ chapter: 3, split: 0, position: 12345, percent: 45.67 });
    expect(parsePositionString('3#12345')).toEqual({ chapter: 3, split: 0, position: 12345, percent: undefined });
    expect(parsePositionString('2@5#77:100%')).toMatchObject({ chapter: 2, split: 5, position: 77, percent: 100 });
    // PDF/CBZ：无 #，冒号前整体为位置
    expect(parsePositionString('12:45.6%')).toEqual({ chapter: 0, split: 0, position: 12, percent: 45.6 });
    expect(parsePositionString('')).toBeNull();
  });
  it('生成并往返', () => {
    expect(formatPositionString({ chapter: 3, position: 12345, percent: 45.678 })).toBe('3@0#12345:45.68%');
    expect(formatPositionString({ chapter: 3, position: 9, percent: 100 })).toBe('3@0#9:100%');
    expect(formatPositionString({ chapter: 12, position: 0, percent: 45.66 }, true)).toBe('12:45.7%');
    const s = formatPositionString({ chapter: 7, split: 1, position: 22, percent: 10 });
    expect(parsePositionString(s)).toMatchObject({ chapter: 7, split: 1, position: 22 });
  });
});

describe('.po / recent.list', () => {
  it('po 往返，带 webY', () => {
    const t = encodePo({ deviceId: '1698000000000', position: '3@0#12345:45.67%', webY: 1200 });
    expect(t).toBe('1698000000000*3@0#12345:45.67%|1200');
    expect(decodePo(t)).toEqual({ deviceId: '1698000000000', position: '3@0#12345:45.67%', webY: 1200 });
    expect(decodePo('abc*1#2')).toEqual({ deviceId: 'abc', position: '1#2', webY: undefined });
    expect(decodePo('garbage')).toBeNull();
  });
  it('recent.list 往返', () => {
    const r = { cloudPath: '/Apps/Books/a.epub', title: '书名', at: 1700000000000, size: 12345, localPath: '/sdcard/a.epub', deviceId: 'dev1', position: '1@0#5:3.00%' };
    expect(decodeRecent(encodeRecent(r))).toEqual(r);
    expect(decodeRecent('x')).toBeNull();
  });
});

describe('.an / .mrexpt', () => {
  const ann = (p: Partial<AnnotationRecord>): AnnotationRecord => ({
    id: 'a1',
    bookId: 'b',
    kind: 'highlight',
    range: { section: 2, start: 100, end: 120 },
    text: '被标注的\n原文',
    note: '笔记',
    color: '#ffeb3b',
    style: 'highlight',
    createdAt: 5,
    updatedAt: 9,
    ...p,
  });
  it('编码后能解码，换行用 <BR> 保存', () => {
    const notes = [annotationToMoonNote(ann({}), { fileName: 'x.epub' }), annotationToMoonNote(ann({ id: 'a2', kind: 'bookmark', title: '书签1', range: { section: 1, start: 5, end: 5 } }), { fileName: 'x.epub' })];
    const text = encodeAnText({ fileSize: 5000, notes });
    expect(text.split('\n').slice(0, 4)).toEqual(['5000', 'indent:false', 'trim:false', '#']);
    expect(text).toContain('被标注的<BR>原文');
    const back = decodeAnText(text)!;
    expect(back.fileSize).toBe(5000);
    expect(back.notes).toHaveLength(2);
    expect(back.notes[0]).toMatchObject({ chapter: 2, position: 100, length: 20, original: '被标注的\n原文', note: '笔记', bookmark: '' });
    expect(back.notes[1]).toMatchObject({ chapter: 1, position: 5, bookmark: '书签1' });
  });
  it('zlib 压缩往返，也认未压缩的 .mrexpt', () => {
    const text = encodeAnText({ fileSize: 1, notes: [] });
    const z = compressAn(text);
    expect(z[0]).toBe(0x78);
    expect(decompressAn(z)).toBe(text);
    expect(decompressAn(new TextEncoder().encode(text))).toBe(text);
  });
  it('墓碑与样式、颜色映射', () => {
    const del = annotationToMoonNote(ann({ deletedAt: 10 }), { fileName: 'x.epub' });
    expect(del.bak).toBe(DELETED);
    const sq = annotationToMoonNote(ann({ style: 'squiggly' }), { fileName: 'x.epub' });
    expect(sq.bak).toBe('1');
    const back = moonNoteToAnnotation(sq, 'b', 'n1');
    expect(back.style).toBe('squiggly');
    expect(back.range).toEqual({ section: 2, start: 100, end: 120 });
    const ul = moonNoteToAnnotation({ ...sq, bak: '0', underline: 1 }, 'b', 'n2');
    expect(ul.style).toBe('underline');
  });
  it('颜色 ARGB 与 CSS 互转', () => {
    expect(argbToCss(cssToArgb('#ffeb3b'))).toBe('#ffeb3b');
    expect(argbToCss(0x7700aaff)).toBe('#00aaff77');
    expect(argbToCss(-1)).toBe('#ffffff');
    expect(cssToArgb('#00aaff77') >>> 0).toBe(0x7700aaff);
  });
  it('字段不足 16 行的残缺记录被忽略', () => {
    const t = '100\nindent:false\ntrim:false\n#\n1\n2\n3\n';
    expect(decodeAnText(t)!.notes).toHaveLength(0);
    expect(decodeAnText('abc')).toBeNull();
  });
});

describe('统计日期与 category', () => {
  it('日期往返、兼容旧版', () => {
    const t = '19000|60000@300\n19001|1000@5\n19002';
    const d = parseStatDates(t);
    expect(d[19000]).toEqual({ ms: 60000, words: 300 });
    expect(d[19002]).toEqual({ ms: 0, words: 0 });
    expect(formatStatDates({ 19001: { ms: 5, words: 1 }, 19000: { ms: 1, words: 2 } })).toBe('19000|1@2\n19001|5@1');
  });
  it('标签+系列', () => {
    const c = parseCategory('<三体>\n#2.5#\n科幻\n#隐藏\n小说\n');
    expect(c.tags).toEqual(['科幻', '小说']);
    expect(c.series).toEqual({ name: '三体', index: 2.5 });
    expect(formatCategory(['a', 'b'], { name: 'S', index: 1 })).toBe('<S>\n#1#\na\nb\n');
    expect(formatCategory([])).toBe('');
  });
});
