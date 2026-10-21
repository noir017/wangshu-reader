import './testing/dom-shim';
import { describe, expect, it } from 'vitest';
import type { ReflowableBook } from '@/core/book';
import { textOfHtml } from '@/core/text';
import { BookOpenError } from './errors';
import { detectFormat, openBook, probeBook } from './index';
import { asFile, buildUmd, PNG_1PX, type UmdSpec } from './testing/builders';

const spec: UmdSpec = {
  title: '测试小说',
  author: '某作者',
  year: '2008',
  month: '5',
  day: '1',
  gender: '科幻',
  publisher: '某出版社',
  chapters: [
    { title: '第一章 开始', text: '第一章 开始\n这是第一章的正文。\n第二段。' },
    { title: '第二章 继续', text: '第二章 继续\n这是第二章。' },
    { title: '尾声', text: '完。' },
  ],
};

const file = (s = spec) => asFile(new Blob([buildUmd(s) as BlobPart]), '测试小说.umd');

describe('UMD', () => {
  it('识别格式（扩展名与文件头）', async () => {
    expect(detectFormat('a.umd')?.format).toBe('umd');
    expect(detectFormat('noext', buildUmd(spec).subarray(0, 64))?.format).toBe('umd');
  });

  it('元数据、章节、目录', async () => {
    const b = (await openBook(file(), { fileName: '测试小说.umd' })) as ReflowableBook;
    expect(b.format).toBe('umd');
    expect(b.metadata).toMatchObject({ title: '测试小说', authors: ['某作者'], publisher: '某出版社', subjects: ['科幻'], published: '2008-5-1' });
    expect(b.sections).toHaveLength(3);
    expect(b.toc.map((t) => t.title)).toEqual(['第一章 开始', '第二章 继续', '尾声']);
    const c0 = await b.sections[0].load();
    expect(textOfHtml(c0.bodyHtml)).toBe('第一章 开始这是第一章的正文。第二段。');
    expect(c0.bodyHtml).toContain('mr-title');
    // charCount 与引擎看到的纯文本长度一致
    for (const s of b.sections) expect(textOfHtml((await s.load()).bodyHtml).length).toBe(s.charCount);
  });

  it('章节正文里没有标题行时补上标题行', async () => {
    const b = (await openBook(file({ ...spec, chapters: [{ title: '独立标题', text: '只有正文。' }] }), { fileName: 'a.umd' })) as ReflowableBook;
    expect(textOfHtml((await b.sections[0].load()).bodyHtml)).toBe('独立标题只有正文。');
  });

  it('封面（UMD 虽然解出了封面，原版不用；这里提供给书架）', async () => {
    const b = (await openBook(file({ ...spec, cover: PNG_1PX }), { fileName: 'a.umd' })) as ReflowableBook;
    expect((await b.getCover())?.size).toBe(PNG_1PX.length);
    const p = await probeBook(file({ ...spec, cover: PNG_1PX }), { fileName: 'a.umd' });
    expect(p.cover).not.toBeNull();
  });

  it('probe：元数据与字数', async () => {
    const p = await probeBook(file(), { fileName: '测试小说.umd' });
    expect(p.format).toBe('umd');
    expect(p.metadata.title).toBe('测试小说');
    expect(p.size?.chars).toBeGreaterThan(20);
  });

  it('没有元数据时用「书名 - 作者」文件名', async () => {
    const b = await openBook(file({ chapters: [{ title: '一', text: '内容' }] }), { fileName: '书名 - 作者名.umd' });
    expect(b.metadata).toMatchObject({ title: '书名', authors: ['作者名'] });
  });

  it('漫画 UMD 给出可识别的错误', async () => {
    await expect(openBook(file({ ...spec, type: 2 }), { fileName: 'a.umd' })).rejects.toBeInstanceOf(BookOpenError);
  });

  it('损坏/截断的文件不崩：用已解出的部分', async () => {
    const bytes = buildUmd(spec);
    const b = (await openBook(asFile(new Blob([bytes.subarray(0, bytes.length - 5) as BlobPart]), 'a.umd'), { fileName: 'a.umd' })) as ReflowableBook;
    expect(b.sections.length).toBeGreaterThan(0);
    await expect(openBook(asFile(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]), 'a.umd'), { fileName: 'a.umd' })).rejects.toBeInstanceOf(BookOpenError);
  });
});
