import './testing/dom-shim';
import { describe, expect, it } from 'vitest';
import { UnsupportedFormatError } from './errors';
import { detectFormat, openBook, supportedExtensions } from './index';
import { asFile, buildEpub, buildMobi6, buildUmd, buildPdf, makePng, u8, zipBlob } from './testing/builders';

const fmt = (name: string, head?: Uint8Array) => detectFormat(name, head)?.format ?? null;
const headOf = async (b: Blob) => new Uint8Array(await b.slice(0, 4096).arrayBuffer());

describe('detectFormat：按扩展名（FMT-001，忽略大小写）', () => {
  const table: [string, string][] = [
    ['a.epub', 'epub'], ['a.EPUB3', 'epub'], ['a.txt', 'txt'], ['a.text', 'txt'], ['a.log', 'txt'],
    ['a.html', 'html'], ['a.HTM', 'html'], ['a.xhtml', 'html'], ['a.md', 'md'], ['a.markdown', 'md'],
    ['a.fb2', 'fb2'], ['a.fb2.zip', 'fb2'], ['A.FB2.ZIP', 'fb2'],
    ['a.mobi', 'mobi'], ['a.azw', 'mobi'], ['a.azw3', 'mobi'], ['a.prc', 'mobi'],
    ['a.umd', 'umd'], ['a.docx', 'docx'], ['a.odt', 'odt'], ['a.rtf', 'rtf'], ['a.pdf', 'pdf'],
    ['a.cbz', 'cbz'], ['a.cbr', 'cbr'], ['a.cb7', 'cb7'], ['a.chm', 'chm'], ['a.djvu', 'djvu'], ['a.djv', 'djvu'],
    ['a.zip', 'zip'], ['a.rar', 'rar'], ['a.7z', '7z'],
  ];
  for (const [name, format] of table) it(`${name} → ${format}`, () => expect(fmt(name)).toBe(format));

  it('带目录与压缩包内路径：取最后一段（a.zip?inner/b.epub → epub）', () => {
    expect(fmt('/x/y/书.epub')).toBe('epub');
    expect(fmt('C:\\books\\书.PDF')).toBe('pdf');
    expect(fmt('a.zip?inner/b.epub')).toBe('epub');
    expect(fmt('a.zip?b.fb2.zip')).toBe('fb2');
  });

  it('不认识的扩展名且没有文件头 → null', () => {
    expect(fmt('a.xyz')).toBeNull();
    expect(fmt('noext')).toBeNull();
  });
});

describe('detectFormat：扩展名不可信时按文件头嗅探', () => {
  it('各格式的魔数', async () => {
    expect(fmt('x', await headOf(await buildEpub({ chapters: [{ id: 'c', file: 'c.xhtml', body: 'x' }] })))).toBe('epub');
    expect(fmt('x', buildPdf({ pages: [['a']] }).subarray(0, 100))).toBe('pdf');
    expect(fmt('x', buildUmd({ chapters: [{ title: 't', text: 'x' }] }).subarray(0, 64))).toBe('umd');
    expect(fmt('x', buildMobi6({ html: '<p>x</p>' }).subarray(0, 200))).toBe('mobi');
    expect(fmt('x', u8('{\\rtf1\\ansi hi}'))).toBe('rtf');
    expect(fmt('x', u8('<?xml version="1.0"?><FictionBook xmlns="x">'))).toBe('fb2');
    expect(fmt('x', u8('<!DOCTYPE html><html><body>x</body></html>'))).toBe('html');
    expect(fmt('x', u8('ITSF\u0003\u0000\u0000\u0000'))).toBe('chm');
    expect(fmt('x', u8('AT&TFORM\u0000\u0000'))).toBe('djvu');
    expect(fmt('x', u8('Rar!\u001a\u0007\u0000'))).toBe('rar');
    expect(fmt('x', Uint8Array.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]))).toBe('7z');
  });

  it('zip 家族：docx / odt 靠内容，普通 zip 兜底', async () => {
    const docx = await headOf(await zipBlob({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w/>' }));
    const odt = await headOf(await zipBlob({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<x/>' }, { storeFirst: 'mimetype' }));
    const plain = await headOf(await zipBlob({ 'a.txt': 'x' }));
    expect(fmt('x', docx)).toBe('docx');
    expect(fmt('x', odt)).toBe('odt');
    expect(fmt('x', plain)).toBe('zip');
  });

  it('像文本的未知文件当 TXT（原版：未知扩展名一律 TXT），二进制拒绝', () => {
    expect(fmt('x.dat', u8('plain text content\nline two'))).toBe('txt');
    expect(fmt('x', new Uint8Array(0))).toBe('txt');
    const bin = new Uint8Array(512);
    for (let i = 0; i < bin.length; i++) bin[i] = i % 7 === 0 ? 0 : (i * 31) & 255;
    expect(fmt('x.dat', bin)).toBeNull();
    expect(fmt('x', makePng(2, 2))).toBeNull();
  });

  it('扩展名优先于文件头', async () => {
    expect(fmt('a.txt', await headOf(await buildEpub({ chapters: [{ id: 'c', file: 'c.xhtml', body: 'x' }] })))).toBe('txt');
  });
});

describe('supportedExtensions / openBook', () => {
  it('列出全部扩展名（小写、无点、已排序、无重复），覆盖 FMT-001 清单', () => {
    const exts = supportedExtensions();
    expect([...exts].sort()).toEqual(exts);
    expect(new Set(exts).size).toBe(exts.length);
    expect(exts.every((e) => e === e.toLowerCase() && !e.includes('.'))).toBe(true);
    for (const e of ['txt', 'htm', 'html', 'epub', 'epub3', 'mobi', 'azw', 'azw3', 'prc', 'zip', 'rar', 'cbz', 'cbr', 'umd', 'pdf', 'djvu', 'docx', 'odt', 'rtf', 'md', 'fb2', 'chm', '7z', 'cb7']) {
      expect(exts, e).toContain(e);
    }
  });

  it('不支持的文件 → UnsupportedFormatError（中文提示带文件名）', async () => {
    const e = await openBook(asFile(new Blob([new Uint8Array([0, 1, 2, 3, 0, 0, 0, 0])]), 'x.bin'), { fileName: 'x.bin' }).catch((x) => x);
    expect(e).toBeInstanceOf(UnsupportedFormatError);
    expect(e.code).toBe('unsupported');
    expect(e.message).toContain('x.bin');
  });

  it('未知扩展名的文本文件按 TXT 打开', async () => {
    const b = await openBook(asFile(new Blob([u8('第一行\n第二行') as BlobPart]), 'notes.weird'), { fileName: 'notes.weird' });
    expect(b.format).toBe('txt');
  });
});
