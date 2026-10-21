import { describe, expect, it } from 'vitest';
import type { AnnotationRecord, BookRecord } from '@/core/library';
import { decodeAnText } from '@/storage/moon-formats';
import { toMarkdown, toMrexpt, toShareText } from './notes-export';

const book = { id: 'b', fileName: 'x.epub', size: 1234, title: '三体', authors: ['刘慈欣'] } as BookRecord;
const a = (p: Partial<AnnotationRecord>): AnnotationRecord => ({
  id: String(Math.random()),
  bookId: 'b',
  kind: 'highlight',
  range: { section: 0, start: 0, end: 5 },
  text: '文',
  color: '#ffeb3b',
  style: 'highlight',
  createdAt: 1,
  updatedAt: 1,
  ...p,
});
const anns = [
  a({ text: '第二章的句子', range: { section: 1, start: 3, end: 9 }, chapterTitle: '第二章', note: '有笔记' }),
  a({ text: '第一章的句子', range: { section: 0, start: 10, end: 16 }, chapterTitle: '第一章' }),
  a({ kind: 'bookmark', title: '我的书签', text: '', range: { section: 0, start: 0, end: 0 } }),
  a({ text: '已删除', deletedAt: 5 }),
];

describe('标注导出', () => {
  it('分享文本：头统计高亮/标注数，按位置排序并插入章名', () => {
    const t = toShareText(book, anns);
    expect(t.split('\n')[0]).toBe('三体 - 刘慈欣 (高亮: 1; 标注: 1)');
    expect(t.indexOf('第一章的句子')).toBeLessThan(t.indexOf('第二章的句子'));
    expect(t).toContain('◆ 第二章');
    expect(t).toContain('▪ 第二章的句子 (有笔记)');
    expect(t).not.toContain('已删除');
    expect(toShareText(book, anns, false)).not.toContain('◆');
  });
  it('Markdown：章节标题、引用、书签', () => {
    const m = toMarkdown(book, anns);
    expect(m).toContain('# 三体');
    expect(m).toContain('## 第一章');
    expect(m).toContain('> 第一章的句子');
    expect(m).toContain('- 我的书签');
  });
  it('.mrexpt 能被原版格式解码回来，墓碑保留', () => {
    const text = toMrexpt(book, anns);
    const back = decodeAnText(text)!;
    expect(back.fileSize).toBe(1234);
    expect(back.notes).toHaveLength(4);
    expect(back.notes.filter((n) => n.bak === '*DELETED*')).toHaveLength(1);
  });
});
