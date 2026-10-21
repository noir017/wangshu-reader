import { describe, expect, it } from 'vitest';
import type { AnnotationRecord } from '@/core/library';
import { buildShareText, countKinds, selectForShare } from './text-export';

function a(p: Partial<AnnotationRecord> & { id: string }): AnnotationRecord {
  return { bookId: 'b', kind: 'highlight', range: { section: 0, start: 0, end: 1 }, text: 't', color: '#fff', style: 'highlight', createdAt: 1, updatedAt: 1, ...p };
}

const list = [
  a({ id: '3', text: '第二章的话', range: { section: 2, start: 10, end: 15 }, chapterTitle: '第二章', note: '我的想法' }),
  a({ id: '1', text: '序里的话', range: { section: 0, start: 5, end: 9 }, chapterTitle: '序' }),
  a({ id: '2', text: '序里的另一句', range: { section: 0, start: 50, end: 56 }, chapterTitle: '序' }),
  a({ id: 'b', kind: 'bookmark', text: '', title: '(1%) x', range: { section: 1, start: 0, end: 0 } }),
  a({ id: 'd', text: '已删除', deletedAt: 9 }),
];
const ctx = { title: '红楼梦', author: '曹雪芹', withChapter: false };

describe('标注导出文本', () => {
  it('统计：无笔记的算高亮，有笔记的算标注；书签/已删除不算', () => {
    expect(countKinds(selectForShare(list, false))).toEqual({ highlights: 2, notes: 1 });
  });

  it('纯文本（不含章节）：头 + 分隔线 + ▪ 原文 (笔记)，保持列表顺序', () => {
    expect(buildShareText(list, ctx)).toBe(
      ['红楼梦 - 曹雪芹 (高亮: 2; 标注: 1)', '───────────────', '', '▪ 第二章的话 (我的想法)', '', '▪ 序里的话', '', '▪ 序里的另一句', ''].join('\n'),
    );
  });

  it('含章节信息：按位置排序，章变化处插 ◆，条目缩进', () => {
    expect(buildShareText(list, { ...ctx, withChapter: true })).toBe(
      ['红楼梦 - 曹雪芹 (高亮: 2; 标注: 1)', '───────────────', '', '◆ 序', '', '  ▪ 序里的话', '', '  ▪ 序里的另一句', '', '◆ 第二章', '', '  ▪ 第二章的话 (我的想法)', ''].join('\n'),
    );
  });

  it('没有作者时只写书名；英文标签', () => {
    expect(buildShareText([a({ id: '1', text: 'x' })], { title: 'Dune', author: '', withChapter: false, lang: 'en' }).split('\n')[0]).toBe('Dune (Highlights: 1; Notes: 0)');
  });

  it('Markdown：标题、章节二级标题、引用块、笔记', () => {
    const md = buildShareText(list, { ...ctx, withChapter: true }, 'markdown');
    expect(md).toContain('# 红楼梦 - 曹雪芹');
    expect(md).toContain('## 序');
    expect(md).toContain('> 序里的话');
    expect(md).toContain('> 第二章的话\n\n我的想法');
  });

  it('HTML：转义特殊字符，包含笔记段', () => {
    const html = buildShareText([a({ id: '1', text: '<b>&"', note: 'n<1>' })], ctx, 'html');
    expect(html).toContain('&lt;b&gt;&amp;&quot;');
    expect(html).toContain('<p class="note">n&lt;1&gt;</p>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });
});
