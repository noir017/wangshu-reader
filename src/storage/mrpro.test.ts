import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { makeMrpro } from './mrpro-fixture';
import { loadSqlJs } from './sqljs-loader';
import { legacyFileName, parseMrpro, parsePrefsXml, pickLegacyCover, removeSortTag, NotMrproError } from './mrpro';

describe('parsePrefsXml / removeSortTag / legacyFileName', () => {
  it('读 <string> 与 <int value>，还原实体', () => {
    const m = parsePrefsXml(`<?xml version='1.0'?><map><string name="/sdcard/a&amp;b.epub">3@0#12:45.67%</string><int name="k" value="2"/><boolean name="b" value="true"/></map>`);
    expect(m.get('/sdcard/a&b.epub')).toBe('3@0#12:45.67%');
    expect(m.get('k')).toBe('2');
    expect(m.get('b')).toBe('true');
  });
  it('手动排序前缀取最后一个 #@# 之后', () => {
    expect(removeSortTag('abc#@#真书名')).toBe('真书名');
    expect(removeSortTag('a#@#b#@#真')).toBe('真');
    expect(removeSortTag('普通')).toBe('普通');
  });
  it('压缩包内的书取包内文件名', () => {
    expect(legacyFileName('/sdcard/Books/a.zip?/内部/x.epub')).toBe('x.epub');
    expect(legacyFileName('/sdcard/Books/三体.epub')).toBe('三体.epub');
  });
});

describe('parseMrpro', () => {
  it('解析书、标注、统计、进度、历史、手动状态、置顶（按 _names.list 还原路径）', async () => {
    const bytes = await makeMrpro({
      books: [
        { book: '三体', filename: '/sdcard/Books/三体.epub', author: '刘慈欣', description: '科幻', category: '<地球往事>\n#1#\n科幻\n经典\n', favorite: 'default_fav', addTime: '1700000000123' },
        { book: 'zz#@#红楼梦', filename: '/sdcard/Books/红楼梦.txt', author: '(TXT)', category: '(TXT)\n' },
      ],
      notes: [
        { filename: '/sdcard/Books/三体.epub', chapter: 2, position: 100, length: 12, color: -256, original: '你们是虫子', note: '名句' },
        { filename: '/sdcard/Books/三体.epub', chapter: 3, position: 5, length: -65536, bookmark: '书签一' },
        { filename: '/sdcard/Books/三体.epub', chapter: 9, position: 9, length: 1, color: 1, original: 'x', bak: '*DELETED*' },
      ],
      stats: [{ filename: '/sdcard/Books/三体.epub', usedTime: 3600000, readWords: 9000, dates: '19000|1800000@4500\n19001|1800000@4500' }],
      positions: { '/sdcard/books/三体.epub': '2@0#100:45.67%' },
      history: ['/sdcard/Books/红楼梦.txt', '/sdcard/Books/三体.epub'],
      state: { '/sdcard/Books/红楼梦.txt': 3 },
      top: ['/sdcard/Books/三体.epub'],
    });
    const d = await parseMrpro(new Blob([bytes as unknown as BlobPart]), async () => initSqlJs());
    expect(d.books).toHaveLength(2);
    const [b1, b2] = d.books;
    expect(b1).toMatchObject({ title: '三体', authors: ['刘慈欣'], description: '科幻', tags: ['科幻', '经典'], series: { name: '地球往事', index: 1 }, favorite: 'default_fav', addedAt: 1700000000123 });
    expect(b2).toMatchObject({ title: '红楼梦', authors: [], tags: ['(TXT)'], rawTitle: 'zz#@#红楼梦' }); // (TXT) 占位作者被丢掉
    expect(d.notes.map((n) => [n.chapter, n.bookmark || n.original])).toEqual([[2, '你们是虫子'], [3, '书签一']]); // 删除墓碑不导入
    expect(d.stats[0]).toMatchObject({ usedMs: 3600000, words: 9000, days: { 19000: { ms: 1800000, words: 4500 }, 19001: { ms: 1800000, words: 4500 } } });
    expect(d.positions.get('/sdcard/books/三体.epub')).toBe('2@0#100:45.67%');
    expect(d.history).toEqual(['/sdcard/Books/红楼梦.txt', '/sdcard/Books/三体.epub']);
    expect(d.readStates.get('/sdcard/books/红楼梦.txt')).toBe(3);
    expect(d.top).toEqual(['/sdcard/Books/三体.epub']);
    expect(d.hasOptions).toBe(true);
  });

  it('带进来的书籍与封面（? 开头的绝对路径）可读出', async () => {
    const bytes = await makeMrpro({
      books: [{ book: 'A', filename: '/sdcard/Books/a.txt' }],
      outer: { '/sdcard/Books/a.txt': 'hello book', '/sdcard/.MoonReader/a.txt_2.png': new Uint8Array([137, 80, 78, 71]), '/sdcard/.MoonReader/a.txt_3.png': new Uint8Array([1, 2, 3]) },
    });
    const d = await parseMrpro(new Blob([bytes as unknown as BlobPart]), async () => initSqlJs());
    expect(new TextDecoder().decode(await d.bookFiles.get('/sdcard/Books/a.txt')!())).toBe('hello book');
    // 用户编辑过的封面 _3 优先于原图 _2
    expect([...(await pickLegacyCover(d, 'a.txt')!())]).toEqual([1, 2, 3]);
    expect(pickLegacyCover(d, 'none.txt')).toBeUndefined();
  });

  it('没有 _names.list 时按条目原名处理；不是 mrpro 的文件报错', async () => {
    const bytes = await makeMrpro({ books: [{ book: 'A', filename: '/x/a.txt' }], noNamesList: true });
    expect((await parseMrpro(new Blob([bytes as unknown as BlobPart]), async () => initSqlJs())).books).toHaveLength(1);
    await expect(parseMrpro(new Blob(['not a zip']), async () => initSqlJs())).rejects.toBeInstanceOf(NotMrproError);
    const noDb = new JSZip();
    noDb.file('x/readme.txt', 'hi');
    await expect(parseMrpro(new Blob([(await noDb.generateAsync({ type: 'uint8array' })) as unknown as BlobPart]), async () => initSqlJs())).rejects.toThrow('mrbooks.db');
  });

  it('生产用的 sql.js 内联加载器能起来并读到同样的数据（单文件版靠它）', async () => {
    const bytes = await makeMrpro({ books: [{ book: 'B', filename: '/x/b.txt' }] });
    const d = await parseMrpro(new Blob([bytes as unknown as BlobPart]), loadSqlJs);
    expect(d.books[0].title).toBe('B');
  });
});
