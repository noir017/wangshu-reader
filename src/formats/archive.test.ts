import './testing/dom-shim';
import { describe, expect, it } from 'vitest';
import type { FixedBook, FormatParser, ReflowableBook } from '@/core/book';
import { selectEntry } from './archive';
import { ArchiveChoiceError, UnsupportedFormatError } from './errors';
import { detectFormat, openBook, probeBook } from './index';
import { asFile, buildEpub, makePng, u8, zipBlob } from './testing/builders';

const opts = { fileName: 'a.zip' };
const parsers = ['epub', 'txt', 'pdf', 'fb2'].map((f) => ({ format: f, extensions: f === 'fb2' ? ['fb2', 'fb2.zip'] : [f] }) as FormatParser);

describe('selectEntry：压缩包里该打开哪一个', () => {
  it('一本书 + 说明文件 → 那一本', () => {
    expect(selectEntry(['说明.txt', 'readme.txt', 'x/书.epub', 'cover.jpg'], opts, parsers)).toEqual({ entry: 'x/书.epub' });
  });
  it('只有说明类 txt 时仍当书（总比没有强）', () => {
    expect(selectEntry(['readme.txt'], opts, parsers)).toEqual({ entry: 'readme.txt' });
  });
  it('多本 → ArchiveChoiceError（按自然序）', () => {
    expect(() => selectEntry(['b10.epub', 'b2.epub'], opts, parsers)).toThrow(ArchiveChoiceError);
    try {
      selectEntry(['b10.epub', 'b2.epub'], opts, parsers);
    } catch (e) {
      expect((e as ArchiveChoiceError).entries).toEqual(['b2.epub', 'b10.epub']);
    }
  });
  it('图片包：没有书、或只有 txt 说明 → 整包当漫画；图片太少的不算', () => {
    expect(selectEntry(['1.jpg', '2.jpg'], opts, parsers)).toEqual({});
    expect(selectEntry(['1.jpg', '2.jpg', '3.png', 'info.txt'], opts, parsers)).toEqual({});
    expect(selectEntry(['1.jpg', 'book.epub'], opts, parsers)).toEqual({ entry: 'book.epub' });
  });
  it('隐藏文件与 __MACOSX 忽略；指定 entry 优先（大小写不敏感）', () => {
    expect(selectEntry(['__MACOSX/._a.epub', '.hidden.epub', 'real.epub'], opts, parsers)).toEqual({ entry: 'real.epub' });
    expect(selectEntry(['A.epub', 'b.epub'], { ...opts, extra: { entry: 'a.EPUB' } }, parsers)).toEqual({ entry: 'A.epub' });
    expect(() => selectEntry(['a.epub'], { ...opts, extra: { entry: 'zzz' } }, parsers)).toThrow(UnsupportedFormatError);
  });
  it('什么都没有 → emptyArchive', () => {
    expect(() => selectEntry(['a.dat', 'sub/'], opts, parsers)).toThrow(UnsupportedFormatError);
    expect(() => selectEntry([], opts, parsers)).toThrow(UnsupportedFormatError);
  });
  it('嵌套的 .fb2.zip 算书，嵌套的 .zip 不算', () => {
    expect(selectEntry(['x.fb2.zip', 'y.zip'], opts, parsers)).toEqual({ entry: 'x.fb2.zip' });
  });
});

const zipFile = async (files: Record<string, string | Uint8Array>, name = 'pack.zip') => asFile(await zipBlob(files), name);
const epub = async (title = '内部之书') => new Uint8Array(await (await buildEpub({ title, chapters: [{ id: 'c', file: 'c.xhtml', body: '<p>内容</p>' }] })).arrayBuffer());

describe('ZIP 里只有一本书（FMT-001）', () => {
  it('识别 .zip；打开内部 EPUB（文件名按「压缩包?内部路径」，含书名-作者规则）', async () => {
    expect(detectFormat('a.zip')?.format).toBe('zip');
    expect(detectFormat('a.fb2.zip')?.format).toBe('fb2');
    const f = await zipFile({ '说明.txt': 'hi', '书名 - 作者.epub': await epub('') });
    const b = await openBook(f, { fileName: 'pack.zip' });
    expect(b.format).toBe('epub');
    expect(b.metadata).toMatchObject({ title: '书名', authors: ['作者'] });
  });

  it('里面是 TXT（含 GBK 编码）', async () => {
    const f = await zipFile({ 'x.txt': u8('第一章\n内容') });
    const b = (await openBook(f, { fileName: 'pack.zip' })) as ReflowableBook;
    expect(b.format).toBe('txt');
    expect(b.metadata.title).toBe('x');
  });

  it('多本书：ArchiveChoiceError，选中后 extra.entry 重试成功；probe 只记名字', async () => {
    const f = await zipFile({ 'a.epub': await epub('甲'), 'b.epub': await epub('乙') });
    const err = await openBook(f, { fileName: 'pack.zip' }).catch((e) => e);
    expect(err).toBeInstanceOf(ArchiveChoiceError);
    expect(err.entries).toEqual(['a.epub', 'b.epub']);
    const b = await openBook(f, { fileName: 'pack.zip', extra: { entry: 'b.epub' } });
    expect(b.metadata.title).toBe('乙');
    expect(await probeBook(f, { fileName: 'pack.zip' })).toMatchObject({ format: 'zip', metadata: { title: 'pack' }, cover: null });
  });

  it('全是图片：整个 zip 当 CBZ 漫画', async () => {
    const f = await zipFile({ '1.png': makePng(5, 5), '2.png': makePng(5, 5), '3.png': makePng(5, 5) });
    const b = (await openBook(f, { fileName: 'pack.zip' })) as FixedBook;
    expect(b).toMatchObject({ kind: 'fixed', format: 'cbz', pageCount: 3 });
    expect(await probeBook(f, { fileName: 'pack.zip' })).toMatchObject({ format: 'cbz', size: { pages: 3 } });
  });

  it('扩展名被改成 .zip 的 EPUB/DOCX 直接按本来的格式打开', async () => {
    const f = asFile(new Blob([(await epub('伪装的书')) as BlobPart]), 'disguised.zip');
    expect((await openBook(f, { fileName: 'disguised.zip' })).metadata.title).toBe('伪装的书');
  });

  it('probe 取内部书的元数据', async () => {
    const f = await zipFile({ 'x.epub': await epub('内部之书') });
    expect(await probeBook(f, { fileName: 'pack.zip' })).toMatchObject({ format: 'epub', metadata: { title: '内部之书' } });
  });

  it('空包 / 只有无关文件 → emptyArchive 错误；损坏的 zip → corrupt', async () => {
    await expect(openBook(await zipFile({ 'a.dat': 'x' }), { fileName: 'pack.zip' })).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expect(openBook(asFile(new Blob(['PK\u0003\u0004 broken']), 'bad.zip'), { fileName: 'bad.zip' })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('文件名没有 UTF-8 标志位时整包猜 GBK（FMT-001）', async () => {
    // 手工拼：zip 的本地头与中央目录里的文件名字节替换成 GBK
    const gbk = new Uint8Array([0xba, 0xec, 0xc2, 0xa5, 0xc3, 0xce, 0x2e, 0x74, 0x78, 0x74]); // 红楼梦.txt
    const placeholder = 'XXXXXXXXXX';
    const raw = new Uint8Array(await (await zipBlob({ [`${placeholder}`]: u8('内容') })).arrayBuffer());
    const text = new TextDecoder('latin1').decode(raw);
    const patched = new Uint8Array(raw);
    for (let i = text.indexOf(placeholder); i >= 0; i = text.indexOf(placeholder, i + 1)) patched.set(gbk, i);
    // JSZip 写入时对非 ASCII 名字置了 UTF-8 位；占位名是 ASCII，所以没有置位——正好模拟旧压缩软件
    const b = await openBook(asFile(new Blob([patched]), 'old.zip'), { fileName: 'old.zip' });
    expect(b.metadata.title).toBe('红楼梦');
  });
});
