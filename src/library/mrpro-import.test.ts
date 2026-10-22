import { beforeEach, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { closeDbForTests, DB_NAME, getBook, getBookFile, getHistory, getPosition, getStats, listAnnotations, listBooks, getAllRaw, putBook } from '@/storage/db';
import { parseMrpro } from '@/storage/mrpro';
import { makeMrpro } from '@/storage/mrpro-fixture';
import { adoptLegacyBook } from './legacy-relink';
import { applyMrpro, isLegacyId, legacyId } from './mrpro-import';

beforeEach(async () => {
  await closeDbForTests();
  await new Promise<void>((res, rej) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
});

const parse = async (bytes: Uint8Array) => parseMrpro(new Blob([bytes as unknown as BlobPart]), async () => initSqlJs());

const BOOK_TXT = Array.from({ length: 30 }, (_, i) => `第${i + 1}章\n这是正文第${i + 1}段，山不在高，有仙则名。`).join('\n\n');

describe('applyMrpro：把原版备份写进本机书库', () => {
  it('没带书籍文件：建「待补文件」记录，元数据/进度/标注/统计/历史/置顶/阅读状态都在', async () => {
    const d = await parse(
      await makeMrpro({
        books: [
          { book: '三体', filename: '/sdcard/Books/三体.epub', author: '刘慈欣\n余杰', description: '科幻', category: '<地球往事>\n#1#\n科幻\n', favorite: '最爱', addTime: '1700000000000' },
          { book: '红楼梦', filename: '/sdcard/Books/红楼梦.txt', author: '(TXT)', category: '(TXT)\n' },
        ],
        notes: [
          { filename: '/sdcard/Books/三体.epub', chapter: 2, position: 100, length: 12, color: -256, original: '你们是虫子', note: '名句' },
          { filename: '/sdcard/Books/三体.epub', chapter: 3, position: 5, length: -65536, bookmark: '书签一' },
        ],
        stats: [{ filename: '/sdcard/Books/三体.epub', usedTime: 7200000, readWords: 10000, dates: '19000|7200000@10000' }],
        positions: { '/sdcard/books/三体.epub': '2@0#100:45.67%' },
        history: ['/sdcard/Books/红楼梦.txt', '/sdcard/Books/三体.epub'],
        state: { '/sdcard/Books/红楼梦.txt': 3 },
        top: ['/sdcard/Books/红楼梦.txt'],
      }),
    );
    const rep = await applyMrpro(d);
    expect(rep).toMatchObject({ books: 2, withFiles: 0, pending: 2, positions: 1, annotations: 2, stats: 1 });
    const id = legacyId('/sdcard/books/三体.epub');
    expect(isLegacyId(id)).toBe(true);
    const b = (await getBook(id))!;
    expect(b).toMatchObject({ title: '三体', authors: ['刘慈欣', '余杰'], description: '科幻', tags: ['科幻'], series: { name: '地球往事', index: 1 }, favorite: '最爱', fileName: '三体.epub', format: 'epub', onShelf: true });
    expect(b.addedAt).toBe(1700000000000);
    const hlm = (await getBook(legacyId('/sdcard/books/红楼梦.txt')))!;
    expect(hlm).toMatchObject({ readState: 3, tags: ['(TXT)'], authors: [], format: 'txt' });
    expect(hlm.pinnedAt).toBeGreaterThan(0);
    expect(await getPosition(id)).toMatchObject({ locator: { section: 2, offset: 100 }, progress: 0.4567 });
    const notes = await listAnnotations(id);
    expect(notes.map((n) => [n.kind, n.range.section, n.text, n.note])).toEqual(expect.arrayContaining([['highlight', 2, '你们是虫子', '名句'], ['bookmark', 3, '书签一', undefined]]));
    expect((await getStats(id))!.usedMs).toBe(7200000);
    expect((await getHistory()).map((h) => h.bookId)).toEqual([legacyId('/sdcard/books/红楼梦.txt'), id]);
    // 再导入一次不会重复建书
    await applyMrpro(d);
    expect(await listBooks()).toHaveLength(2);
  });

  it('备份里带了书籍文件：直接入库成真实 id，手机上改过的书名以备份为准；之后补文件的书可接上进度', async () => {
    const d = await parse(
      await makeMrpro({
        books: [
          { book: '我改过的书名', filename: '/sdcard/Books/红楼梦.txt', author: '曹雪芹' },
          { book: '没带文件的书', filename: '/sdcard/Books/other.txt' },
        ],
        positions: { '/sdcard/books/红楼梦.txt': '1@0#50:10.00%', '/sdcard/books/other.txt': '3@0#7:30.00%' },
        notes: [{ filename: '/sdcard/Books/other.txt', chapter: 1, position: 3, length: 4, color: -256, original: '正文第' }],
        outer: { '/sdcard/Books/红楼梦.txt': BOOK_TXT },
      }),
    );
    const rep = await applyMrpro(d);
    expect(rep).toMatchObject({ books: 2, withFiles: 1, pending: 1 });
    const books = await listBooks();
    const real = books.find((b) => !isLegacyId(b.id))!;
    expect(real.title).toBe('我改过的书名');
    expect(real.authors).toEqual(['曹雪芹']);
    expect(await getBookFile(real.id)).toBeTruthy();
    expect(await getPosition(real.id)).toMatchObject({ locator: { section: 1, offset: 50 } });

    // 补文件：选原文件后按内容正式入库，进度/标注搬到新 id，待补记录消失
    const pending = books.find((b) => isLegacyId(b.id))!;
    const file = new File([BOOK_TXT.slice(0, 2000) + 'OTHER'], 'other.txt');
    const newId = await adoptLegacyBook(pending, file);
    expect(isLegacyId(newId)).toBe(false);
    expect(await getBook(pending.id)).toBeUndefined();
    expect((await getBook(newId))!.title).toBe('没带文件的书');
    expect(await getPosition(newId)).toMatchObject({ locator: { section: 3, offset: 7 } });
    expect((await listAnnotations(newId)).map((n) => n.text)).toEqual(['正文第']);
    expect((await getAllRaw('files')).map((f) => f.bookId)).toContain(newId);
  });
});

void putBook;
