import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '@shared/api';
import { breadcrumbs, isBrowsableArchive, joinPath, parentPath, sortEntries, splitPath, upFrom } from './files-model';

const e = (name: string, p: Partial<LibraryEntry> = {}): LibraryEntry => ({ name, path: name, dir: false, size: 0, mtime: 0, ...p });
const isBook = (n: string) => /\.(epub|pdf|txt)$/i.test(n);

describe('路径', () => {
  it('压缩包内路径用 ? 分隔', () => {
    expect(splitPath('a/b.zip?x/y')).toEqual({ fs: 'a/b.zip', inner: 'x/y' });
    expect(splitPath('a/b')).toEqual({ fs: 'a/b' });
    expect(joinPath('a', 'b.epub')).toBe('a/b.epub');
    expect(joinPath('', 'b.epub')).toBe('b.epub');
    expect(joinPath('a/b.zip', 'x')).toBe('a/b.zip/x'); // 压缩包文件自身不是 ? 路径，调用方应先进入压缩包
    expect(joinPath('a/b.zip?', 'x.jpg')).toBe('a/b.zip?x.jpg');
    expect(joinPath('a/b.zip?d', 'x.jpg')).toBe('a/b.zip?d/x.jpg');
  });
  it('上一级', () => {
    expect(parentPath('a/b/c')).toBe('a/b');
    expect(parentPath('a')).toBe('');
    expect(parentPath('a/b.zip?d/e')).toBe('a/b.zip?d');
    expect(upFrom('a/b.zip?d')).toBe('a/b.zip');
    expect(upFrom('a/b.zip?')).toBe('a');
    expect(upFrom('a/b.zip?d/e')).toBe('a/b.zip?d');
  });
  it('面包屑', () => {
    expect(breadcrumbs('a/b', '书库').map((c) => c.path)).toEqual(['', 'a', 'a/b']);
    expect(breadcrumbs('a/b.zip?d/e', '书库').map((c) => c.path)).toEqual(['', 'a', 'a/b.zip', 'a/b.zip?d', 'a/b.zip?d/e']);
  });
});

describe('排序', () => {
  const list = [e('z.epub', { size: 5, mtime: 3 }), e('a.jpg', { size: 9, mtime: 1 }), e('d2', { dir: true }), e('d10', { dir: true }), e('b.pdf', { size: 1, mtime: 2 }), e('B.txt', { size: 7, mtime: 9 })];
  it('目录在前、支持的书在前、其他在后；名称自然序', () => {
    expect(sortEntries(list, 0, isBook).map((x) => x.name)).toEqual(['d2', 'd10', 'b.pdf', 'B.txt', 'z.epub', 'a.jpg']);
    expect(sortEntries(list, 1, isBook).map((x) => x.name)).toEqual(['d10', 'd2', 'z.epub', 'B.txt', 'b.pdf', 'a.jpg']);
  });
  it('按大小与时间', () => {
    expect(sortEntries(list, 2, isBook).filter((x) => !x.dir && isBook(x.name)).map((x) => x.name)).toEqual(['b.pdf', 'z.epub', 'B.txt']);
    expect(sortEntries(list, 5, isBook).filter((x) => isBook(x.name)).map((x) => x.name)).toEqual(['B.txt', 'z.epub', 'b.pdf']);
  });
  it('cbz 当书读，zip 才浏览', () => {
    expect(isBrowsableArchive(e('a.zip', { archive: true }))).toBe(true);
    expect(isBrowsableArchive(e('a.cbz', { archive: true }))).toBe(false);
    expect(isBrowsableArchive(e('a.epub'))).toBe(false);
  });
});
