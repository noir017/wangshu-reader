import { describe, expect, it } from 'vitest';
import type { Book, TocEntry } from '@/core/book';
import { ancestorKeys, chapterTitleOf, cleanChapterTitle, currentTocIndex, fallbackToc, flattenToc, progressOf, visibleRows } from './toc-utils';

const toc: TocEntry[] = [
  { title: '卷一', level: 1, section: 0, children: [
    { title: '第一章', level: 2, section: 1 },
    { title: '第二章', level: 2, section: 2, anchor: 'a' },
    { title: '第二章 小节', level: 2, section: 2, anchor: 'b' },
  ] },
  { title: '卷二', level: 1, section: 4 },
];

function bookOf(sections: { charCount: number; title?: string; linear?: boolean }[], t: TocEntry[] = []): Book {
  return {
    kind: 'reflowable', format: 'txt', metadata: { title: 't', authors: [] }, toc: t,
    sections: sections.map((s, i) => ({ id: 's' + i, title: s.title, linear: s.linear ?? true, charCount: s.charCount, load: async () => ({ bodyHtml: '', styles: [] }) })),
    resolveHref: () => null, getCover: async () => null, destroy() {},
  };
}

describe('toc-utils', () => {
  it('标题清洗：折叠空白；过长且条目多才截断', () => {
    expect(cleanChapterTitle('  第一章　 开始\n ')).toBe('第一章 开始');
    const long = '长'.repeat(200);
    expect(cleanChapterTitle(long, 5)).toHaveLength(200);
    const cut = cleanChapterTitle(long, 30);
    expect(cut).toHaveLength(150);
    expect(cut.endsWith('...')).toBe(true);
  });

  it('扁平化、折叠与祖先', () => {
    const flat = flattenToc(toc);
    expect(flat.map((r) => [r.entry.title, r.depth, r.hasChildren])).toEqual([
      ['卷一', 0, true], ['第一章', 1, false], ['第二章', 1, false], ['第二章 小节', 1, false], ['卷二', 0, false],
    ]);
    expect(visibleRows(flat, new Set()).length).toBe(5);
    expect(visibleRows(flat, new Set(['0'])).map((r) => r.entry.title)).toEqual(['卷一', '卷二']);
    expect(ancestorKeys(flat, 2)).toEqual(['0']);
  });

  it('当前章：按章号；同章多条目靠锚点偏移 / 标题提示', () => {
    const flat = flattenToc(toc);
    expect(currentTocIndex(flat, { section: 1, offset: 0 })).toBe(1);
    expect(currentTocIndex(flat, { section: 3, offset: 0 })).toBe(3); // 第 3 章没有条目：落在之前最近的一条
    expect(currentTocIndex(flat, { section: 9, offset: 0 })).toBe(4);
    expect(currentTocIndex(flat, { section: 2, offset: 500 })).toBe(2);
    expect(currentTocIndex(flat, { section: 2, offset: 500 }, new Map([[2, 0], [3, 300]]))).toBe(3);
    expect(currentTocIndex(flat, { section: 2, offset: 100 }, new Map([[2, 0], [3, 300]]))).toBe(2);
    expect(currentTocIndex(flat, { section: 2, offset: 0 }, undefined, '第二章 小节')).toBe(3);
    expect(currentTocIndex(flat, { section: 0, offset: 0 })).toBe(0);
    expect(currentTocIndex([], { section: 0, offset: 0 })).toBe(-1);
  });

  it('目录为空时用章节标题兜底', () => {
    const b = bookOf([{ charCount: 1, title: '序' }, { charCount: 1 }, { charCount: 1, title: '终', linear: false }, { charCount: 1, title: '尾' }]);
    expect(fallbackToc(b).map((e) => e.title)).toEqual(['序', '尾']);
    expect(chapterTitleOf(b, 3)).toBe('尾');
    expect(chapterTitleOf(bookOf([{ charCount: 1 }], toc), 3)).toBe('第二章 小节');
  });

  it('全书进度按字数加权', () => {
    const b = bookOf([{ charCount: 100 }, { charCount: 300 }, { charCount: 100 }]);
    expect(progressOf(b, 0, 0)).toBe(0);
    expect(progressOf(b, 1, 150)).toBeCloseTo(250 / 500);
    expect(progressOf(b, 2, 9999)).toBe(1);
  });
});
