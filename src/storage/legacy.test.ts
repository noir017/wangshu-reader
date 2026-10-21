import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zlibSync } from 'fflate';
import type { BookRecord } from '@/core/library';
import { closeDbForTests, DB_NAME, getPosition, listAnnotations, putBook } from './db';
import { applyLegacyFile, findLegacyBook, readLegacyFile } from './legacy';

const book = (p: Partial<BookRecord> = {}): BookRecord => ({
  id: 'bk1',
  fileName: 'Dune.epub',
  format: 'epub',
  size: 5000,
  title: 'Dune',
  authors: [],
  tags: [],
  addedAt: 1,
  onShelf: true,
  hasCover: false,
  ...p,
});

const note = (pos: number, bookName = 'Dune.epub') =>
  ['#', '1', bookName, `/sdcard/${bookName}`, `/sdcard/${bookName.toLowerCase()}`, '1', '0', String(pos), '4', String(0x77ffeb3b | 0), '1698000000000', '', '', '沙丘', '0', '0', ''].join('\n');
const an = (size: number, ...notes: string[]) => ['' + size, 'indent:false', 'trim:false', ...notes, ''].join('\n');

beforeEach(async () => {
  await closeDbForTests();
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => r();
  });
});

describe('导入原版 .po / .an / .mrexpt', () => {
  it('认出文件类型：.po、zlib 的 .an、未压缩的 .mrexpt；认不出返回 null', () => {
    expect(readLegacyFile('Dune.epub.po', strToU8('123*1@0#5:1.00%'))).toMatchObject({ kind: 'po', hints: ['Dune.epub'] });
    expect(readLegacyFile('x.po', strToU8('garbage'))).toBeNull();
    const text = an(5000, note(10));
    const packed = readLegacyFile('Dune.epub.an', zlibSync(strToU8(text)))!;
    expect(packed).toMatchObject({ kind: 'an', fileSize: 5000, count: 1 });
    // 提示里有文件名和标注里记录的书名
    expect(packed.hints).toEqual(['Dune.epub']);
    const plain = readLegacyFile('我的笔记.mrexpt', strToU8(text))!;
    expect(plain.hints).toEqual(['我的笔记', 'Dune.epub']);
    expect(readLegacyFile('random.txt', strToU8('hello world'))).toBeNull();
  });

  it('按文件名（不区分大小写）找书；标注文件带大小时优先挑大小相近的', async () => {
    await putBook(book());
    await putBook(book({ id: 'bk2', size: 900000 }));
    expect((await findLegacyBook(['nope', 'dune.EPUB']))?.id).toBeDefined();
    expect((await findLegacyBook(['dune.epub'], 900100))?.id).toBe('bk2');
    expect((await findLegacyBook(['dune.epub'], 5050))?.id).toBe('bk1');
    expect(await findLegacyBook(['absent.epub'])).toBeUndefined();
  });

  it('应用：.po 写进度，.an 合并标注；大小差太多的标注被拒绝', async () => {
    const b = book();
    await putBook(b);
    const po = readLegacyFile('Dune.epub.po', strToU8('123*4@0#77:50.00%'))!;
    expect(await applyLegacyFile(po, b)).toEqual({ kind: 'po', ok: true });
    expect((await getPosition('bk1'))!.locator).toEqual({ section: 4, offset: 77 });

    const good = readLegacyFile('Dune.epub.an', zlibSync(strToU8(an(5000, note(10), note(20)))))!;
    expect(await applyLegacyFile(good, b)).toMatchObject({ kind: 'an', added: 2, changed: true });
    expect((await listAnnotations('bk1')).map((a) => a.range.start).sort()).toEqual([10, 20]);
    // 再导一次：没有变化
    expect(await applyLegacyFile(good, b)).toMatchObject({ kind: 'an', changed: false });

    const other = readLegacyFile('Dune.epub.an', zlibSync(strToU8(an(5_000_000, note(30)))))!;
    expect(await applyLegacyFile(other, b)).toMatchObject({ kind: 'an', rejected: true });
  });
});
