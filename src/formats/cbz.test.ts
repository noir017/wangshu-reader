import './testing/dom-shim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FixedBook } from '@/core/book';
import { UnsupportedFormatError } from './errors';
import { comicPages, readComicInfo } from './cbz';
import { detectFormat, openBook, probeBook } from './index';
import { openZip } from './lib/zip';
import { asFile, makePng, u8, zipBlob } from './testing/builders';

const cbz = async (files: Record<string, string | Uint8Array>, name = 'comic.cbz') => asFile(await zipBlob(files), name);
afterEach(() => vi.unstubAllGlobals());

describe('CBZ 页序与过滤（COMIC-001）', () => {
  it('自然排序：2 在 10 前，忽略隐藏文件/__MACOSX/Thumbs.db/非图片', () => {
    const names = ['p10.png', 'p2.png', 'p1.png', '__MACOSX/._p1.png', '.hidden.png', 'Thumbs.db', 'readme.txt', 'sub/p3.JPG', 'a.xml'];
    expect(comicPages(names)).toEqual(['p1.png', 'p2.png', 'p10.png', 'sub/p3.JPG']);
  });
});

describe('CBZ 打开', () => {
  it('识别格式、页数、页尺寸（不解码）、封面=第一页', async () => {
    const f = await cbz({ '2.png': makePng(30, 40), '10.png': makePng(50, 60), '1.png': makePng(20, 25), 'ComicInfo.xml': '<ComicInfo><Title>标题</Title></ComicInfo>' });
    expect(detectFormat('x.cbz')?.format).toBe('cbz');
    const b = (await openBook(f, { fileName: 'comic.cbz' })) as FixedBook;
    expect(b.kind).toBe('fixed');
    expect(b.format).toBe('cbz');
    expect(b.pageCount).toBe(3);
    expect(await b.getPageSize(0)).toEqual({ width: 20, height: 25 });
    expect(await b.getPageSize(1)).toEqual({ width: 30, height: 40 });
    expect(await b.getPageSize(2)).toEqual({ width: 50, height: 60 });
    const cover = await b.getCover();
    expect(cover?.type).toBe('image/png');
    expect(cover?.size).toBe(makePng(20, 25).length);
    expect(b.toc).toEqual([]);
    expect(b.getPageText).toBeUndefined();
  });

  it('ComicInfo.xml：标题/作者/简介/系列/类别/语言/阅读方向（COMIC-002）', async () => {
    const info = `<?xml version="1.0"?><ComicInfo><Title>第一卷</Title><Series>某系列</Series><Number>3</Number><Volume>1</Volume><Summary>简介文字</Summary><Writer>作者甲, 作者乙</Writer><Genre>动作, 冒险</Genre><Publisher>某社</Publisher><Year>2020</Year><LanguageISO>ja</LanguageISO><Manga>YesAndRightToLeft</Manga></ComicInfo>`;
    const f = await cbz({ '1.png': makePng(2, 2), 'ComicInfo.xml': info });
    const b = await openBook(f, { fileName: 'comic.cbz' });
    expect(b.metadata).toMatchObject({ title: '第一卷', authors: ['作者甲', '作者乙'], description: '简介文字', series: '某系列', seriesIndex: 3, subjects: ['动作', '冒险'], publisher: '某社', published: '2020', language: 'ja', direction: 'rtl' });
  });

  it('Manga=Yes 只表示日漫，不等于右到左', async () => {
    const f = await cbz({ '1.png': makePng(2, 2), 'ComicInfo.xml': '<ComicInfo><Manga>Yes</Manga></ComicInfo>' });
    expect((await openBook(f, { fileName: 'c.cbz' })).metadata.direction).toBeUndefined();
  });

  it('没有 ComicInfo 时用文件名「书名 - 作者」；ComicInfo 缺失字段回退文件名', async () => {
    const f = await cbz({ '1.png': makePng(2, 2) });
    expect((await openBook(f, { fileName: '海贼王 - 尾田.cbz' })).metadata).toMatchObject({ title: '海贼王', authors: ['尾田'] });
    const g = await cbz({ '1.png': makePng(2, 2), 'meta.xml': '<ComicInfo><Writer>某人</Writer></ComicInfo>' });
    expect((await openBook(g, { fileName: '名字.cbz' })).metadata).toMatchObject({ title: '名字', authors: ['某人'] });
  });

  it('readComicInfo：找不到 ComicInfo.xml 时取第一个 .xml；不是 ComicInfo 的 xml 忽略', async () => {
    const z1 = await openZip(await zipBlob({ 'x.xml': '<ComicInfo><Title>T</Title></ComicInfo>' }));
    expect((await readComicInfo(z1))?.title).toBe('T');
    const z2 = await openZip(await zipBlob({ 'x.xml': '<other/>' }));
    expect(await readComicInfo(z2)).toBeNull();
  });

  it('probe：元数据 + 封面 + 页数', async () => {
    const f = await cbz({ '1.png': makePng(4, 4), '2.png': makePng(4, 4) });
    const p = await probeBook(f, { fileName: 'a.cbz' });
    expect(p).toMatchObject({ format: 'cbz', size: { pages: 2 } });
    expect(p.cover?.type).toBe('image/png');
  });

  it('没有图片 → 「压缩包里没有可阅读的文件」', async () => {
    await expect(openBook(await cbz({ 'a.txt': 'x' }), { fileName: 'a.cbz' })).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('扩展名与实际类型不符时按文件头取 MIME（.jpg 里放 PNG）', async () => {
    const f = await cbz({ '1.jpg': makePng(3, 3) });
    const b = (await openBook(f, { fileName: 'a.cbz' })) as FixedBook;
    expect((await b.getCover())?.type).toBe('image/png');
  });

  it('renderPage：用 createImageBitmap 解码，目标比原图小很多时缩一份', async () => {
    const calls: unknown[][] = [];
    const bitmap = (w: number, h: number) => ({ width: w, height: h, close: vi.fn() });
    vi.stubGlobal('createImageBitmap', async (...args: unknown[]) => {
      calls.push(args);
      return args.length > 1 ? bitmap((args[1] as { resizeWidth: number }).resizeWidth, (args[1] as { resizeHeight: number }).resizeHeight) : bitmap(1000, 1500);
    });
    const b = (await openBook(await cbz({ '1.png': makePng(8, 8) }), { fileName: 'a.cbz' })) as FixedBook;
    const img = (await b.renderPage(0, { width: 100, height: 150, dpr: 2 })) as unknown as { width: number };
    expect(img.width).toBe(200);
    expect(calls).toHaveLength(2);
    await expect(b.renderPage(5, { width: 1, height: 1, dpr: 1 })).rejects.toThrow(RangeError);
    const ac = new AbortController();
    ac.abort();
    await expect(b.renderPage(0, { width: 1, height: 1, dpr: 1, signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('没有图片尺寸可读时退回解码取尺寸', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 7, height: 9, close: vi.fn() }));
    const b = (await openBook(await cbz({ '1.png': u8('not really a png') }), { fileName: 'a.cbz' })) as FixedBook;
    expect(await b.getPageSize(0)).toEqual({ width: 7, height: 9 });
  });
});
