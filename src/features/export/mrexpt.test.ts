import { describe, expect, it } from 'vitest';
import type { AnnotationRecord } from '@/core/library';
import { annotationsToMrexpt, encodeMrexpt, flagsToStyle, MrexptError, parseMrexpt, recordColor } from './mrexpt';

const ctx = { title: '三体', fileName: '三体.epub', size: 123456, defaultHighlightColor: '#00aaff77' };

function hl(p: Partial<AnnotationRecord>): AnnotationRecord {
  return { id: 'x', bookId: 'b', kind: 'highlight', range: { section: 3, start: 100, end: 108 }, text: '春眠不觉晓，处处', color: '#00aaff77', style: 'highlight', createdAt: 1, updatedAt: 1700000000000, ...p };
}

describe('.mrexpt', () => {
  it('往返：高亮、下划线、笔记（含换行）、书签', () => {
    const list = [
      hl({ id: '1' }),
      hl({ id: '2', style: 'underline', color: '#555555', note: '第一行\n第二行', text: '多行\n原文' }),
      hl({ id: '3', style: 'squiggly', range: { section: 3, start: 200, end: 203 } }),
      { ...hl({ id: '4', kind: 'bookmark', color: '#ff0000', text: '', title: '(12.3%) 书签名...' }), range: { section: 5, start: 40, end: 40 } },
      { ...hl({ id: '5', kind: 'bookmark', color: '', text: '', title: '(1.0%) 无色书签...' }), range: { section: 0, start: 0, end: 0 } },
    ];
    const text = encodeMrexpt(annotationsToMrexpt(list, ctx));
    expect(text.startsWith('123456\nindent:false\ntrim:false\n#\n1\n三体\n三体.epub\n三体.epub\n3\n0\n100\n8\n')).toBe(true);
    const back = parseMrexpt(text);
    expect(back.size).toBe(123456);
    expect(back.records).toHaveLength(5);
    const [a, b, c, d, e] = back.records;
    expect(a).toMatchObject({ chapter: 3, split: 0, position: 100, length: 8, original: '春眠不觉晓，处处', bookmark: '', deleted: false });
    expect(recordColor(a)).toBe('#00aaff77');
    expect(flagsToStyle(b)).toBe('underline');
    expect(b.note).toBe('第一行\n第二行');
    expect(b.original).toBe('多行\n原文');
    expect(recordColor(b)).toBe('#555555');
    expect(flagsToStyle(c)).toBe('squiggly');
    expect(d).toMatchObject({ bookmark: '(12.3%) 书签名...', chapter: 5, position: 40 });
    expect(recordColor(d)).toBe('#ff0000');
    expect(recordColor(e)).toBe('');
  });

  it('文本里的换行都写成 <BR>，所以每条记录恰好 17 行', () => {
    const text = encodeMrexpt(annotationsToMrexpt([hl({ note: 'a\nb\r\nc', text: 'x\ny' })], ctx));
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(3 + 17);
    expect(lines[3 + 12]).toBe('a<BR>b<BR>c');
  });

  it('墓碑：16 列，最后一列 *DELETED*', () => {
    const text = encodeMrexpt(annotationsToMrexpt([], ctx, [hl({ id: 'd', deletedAt: 1700000001000 })]));
    const lines = text.trimEnd().split('\n');
    expect(lines.slice(3)).toEqual(['#', '0', '0', '0', '0', '3', '0', '100', '0', '0', '1700000001000', '', '', '0', '0', '0', '*DELETED*']);
    const back = parseMrexpt(text);
    expect(back.records[0]).toMatchObject({ deleted: true, chapter: 3, position: 100, time: 1700000001000 });
  });

  it('解析原 app 导出的样本（CRLF、负的 ARGB 颜色、末尾不完整记录被忽略）', () => {
    const sample = [
      '987654', 'indent:true', 'trim:false',
      '#', '12', '红楼梦', '/sdcard/Books/红楼梦.txt', '/sdcard/books/红楼梦.txt', '0', '0', '5230', '24', String(0x7700aaff | 0), '1600000000000', '', '', '满纸荒唐言，一把辛酸泪', '0', '0', '0',
      '#', '13', '红楼梦', '/sdcard/Books/红楼梦.txt', '/sdcard/books/红楼梦.txt', '0', '0', '9000', String(0xffff0000 | 0), String(0x7700aaff | 0), '1600000001000', '(3.2%) 甲戌本凡例...', '', '', '0', '0', '0',
      '#', '14', 'tail', 'broken',
    ].join('\r\n');
    const f = parseMrexpt(sample);
    expect(f).toMatchObject({ size: 987654, indent: true, trim: false });
    expect(f.records).toHaveLength(2);
    expect(f.records[0]).toMatchObject({ position: 5230, length: 24, original: '满纸荒唐言，一把辛酸泪' });
    expect(recordColor(f.records[0])).toBe('#00aaff77');
    expect(f.records[1].bookmark).toBe('(3.2%) 甲戌本凡例...');
    expect(recordColor(f.records[1])).toBe('#ff0000');
  });

  it('不是 mrexpt 文件时报错', () => {
    expect(() => parseMrexpt('hello world')).toThrow(MrexptError);
    expect(() => parseMrexpt('')).toThrow(MrexptError);
  });
});
